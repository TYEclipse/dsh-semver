/**
 * Tool-level tests for dsh-semver — exercises each defineTool surface through
 * the built ToolSet, including invalid input paths and output shape stability.
 *
 * @module dsh-semver/test
 */

import { describe, expect, it } from 'vitest'
import { buildSemverTools } from '../src/tools.ts'
import { resolveConfig } from '../src/index.ts'

const tools = buildSemverTools(resolveConfig({}))

describe('semver_parse tool', () => {
  it('parses a full version', async () => {
    const out = await tools.semver_parse.execute({ version: '2.1.0-rc.1+build.42' })
    expect(out.valid).toBe(true)
    expect(out.major).toBe(2)
    expect(out.prerelease).toEqual(['rc', '1'])
    expect(out.build).toEqual(['build', '42'])
  })

  it('reports invalid input with a reason', async () => {
    const out = await tools.semver_parse.execute({ version: '1.2' })
    expect(out.valid).toBe(false)
    expect(typeof out.reason).toBe('string')
    expect(out.reason?.length).toBeGreaterThan(0)
  })
})

describe('semver_compare tool', () => {
  it('returns lt/eq/gt with a verdict', async () => {
    const out = await tools.semver_compare.execute({ left: '2.1.0', right: '2.0.3' })
    expect(out.valid).toBe(true)
    expect(out.relation).toBe('gt')
    expect(out.equal).toBe(false)
    expect(out.verdict).toBe('2.1.0 > 2.0.3')
  })

  it('handles build metadata as equal precedence', async () => {
    const out = await tools.semver_compare.execute({ left: '1.0.0+build.1', right: '1.0.0' })
    expect(out.relation).toBe('eq')
    expect(out.equal).toBe(true)
  })

  it('reports which side is invalid', async () => {
    const out = await tools.semver_compare.execute({ left: '1.2.3', right: 'nope' })
    expect(out.valid).toBe(false)
    expect(out.reason).toContain('right')
  })
})

describe('semver_satisfies tool', () => {
  it('checks a range', async () => {
    const out = await tools.semver_satisfies.execute({ version: '1.5.0', range: '^1.2.3' })
    expect(out.valid).toBe(true)
    expect(out.satisfied).toBe(true)
    expect(out.explanation).toContain('satisfies')
  })

  it('respects includePrerelease override', async () => {
    const no = await tools.semver_satisfies.execute({ version: '1.2.4-beta.1', range: '^1.2.3' })
    expect(no.satisfied).toBe(false)
    const yes = await tools.semver_satisfies.execute({ version: '1.2.4-beta.1', range: '^1.2.3', includePrerelease: true })
    expect(yes.satisfied).toBe(true)
  })

  it('reports invalid ranges', async () => {
    const out = await tools.semver_satisfies.execute({ version: '1.2.3', range: '>=1.x' })
    expect(out.valid).toBe(false)
    expect(typeof out.reason).toBe('string')
  })
})

/**
 * Lossless-JSON discipline (R7/R18/R19): the dsh-tools output gate rejects any
 * object that has a key with an undefined value. Recursively assert that every
 * tool result tree is free of such "live" keys.
 */
function assertNoUndefined(value: unknown, path = '$'): void {
  if (value === null || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoUndefined(item, `${path}[${index}]`))
    return
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    expect(item, `lossless-JSON gate: ${path}.${key} is undefined`).not.toBeUndefined()
    assertNoUndefined(item, `${path}.${key}`)
  }
}

describe('semver_inc tool', () => {
  it('bumps a prerelease counter (npm anchor)', async () => {
    const out = await tools.semver_inc.execute({ version: '1.2.4-beta.0', release: 'prerelease', identifier: 'beta' })
    expect(out.valid).toBe(true)
    expect(out.next).toBe('1.2.4-beta.1')
    expect(out.rule).toContain('prerelease')
    assertNoUndefined(out)
  })

  it('bumps a plain version to a named prerelease (npm anchor)', async () => {
    const out = await tools.semver_inc.execute({ version: '1.2.3', release: 'preminor', identifier: 'rc' })
    expect(out.next).toBe('1.3.0-rc.0')
    assertNoUndefined(out)
  })

  it('reports invalid versions and identifiers', async () => {
    const badVersion = await tools.semver_inc.execute({ version: '1.2', release: 'major' })
    expect(badVersion.valid).toBe(false)
    expect(badVersion.reason?.length).toBeGreaterThan(0)
    assertNoUndefined(badVersion)
    const badIdentifier = await tools.semver_inc.execute({ version: '1.2.3', release: 'premajor', identifier: 'beta!' })
    expect(badIdentifier.valid).toBe(false)
    expect(badIdentifier.reason).toContain('identifier')
    assertNoUndefined(badIdentifier)
  })

  it('rejects unknown release types at the schema layer', async () => {
    // enum validation happens in the defineTool wrapper (R9/R11) — a rejection, not valid:false.
    await expect(
      tools.semver_inc.execute({ version: '1.2.3', release: 'sideways' } as { version: string; release: string }),
    ).rejects.toThrow()
  })
})

describe('semver_diff tool', () => {
  it('reports the release-type difference (npm anchor)', async () => {
    const out = await tools.semver_diff.execute({ left: '1.2.3', right: '2.0.0-beta.1' })
    expect(out.valid).toBe(true)
    expect(out.equal).toBe(false)
    expect(out.difference).toBe('premajor')
    assertNoUndefined(out)
  })

  it('reports equal precedence without a difference key', async () => {
    const out = await tools.semver_diff.execute({ left: '1.0.0+build.1', right: '1.0.0' })
    expect(out.valid).toBe(true)
    expect(out.equal).toBe(true)
    expect('difference' in out).toBe(false)
    assertNoUndefined(out)
  })

  it('reports which side is invalid', async () => {
    const out = await tools.semver_diff.execute({ left: '1.2.3', right: 'nope' })
    expect(out.valid).toBe(false)
    expect(out.reason).toContain('right')
  })
})

describe('semver_sort tool', () => {
  it('sorts ascending and descending (npm anchors)', async () => {
    const asc = await tools.semver_sort.execute({ versions: ['1.2.3', '1.2.10', '1.0.0'] })
    expect(asc.valid).toBe(true)
    expect(asc.sorted).toEqual(['1.0.0', '1.2.3', '1.2.10'])
    expect(asc.order).toBe('asc')
    assertNoUndefined(asc)
    const desc = await tools.semver_sort.execute({ versions: ['1.2.3', '1.2.10', '1.0.0'], order: 'desc' })
    expect(desc.sorted).toEqual(['1.2.10', '1.2.3', '1.0.0'])
    assertNoUndefined(desc)
  })

  it('skips invalid entries and reports them', async () => {
    const out = await tools.semver_sort.execute({ versions: ['2.0.0', 'nope', '1.0.0'] })
    expect(out.valid).toBe(false) // not every input was valid
    expect(out.count).toBe(2)
    expect(out.sorted).toEqual(['1.0.0', '2.0.0'])
    expect(out.invalidCount).toBe(1)
    expect(out.invalid?.[0]).toContain('index 1')
    assertNoUndefined(out)
  })

  it('rejects unknown order at the schema layer', async () => {
    await expect(
      tools.semver_sort.execute({ versions: ['1.0.0'], order: 'sideways' } as { versions: string[]; order?: string }),
    ).rejects.toThrow()
  })
})
