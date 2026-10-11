/**
 * Tool-level tests for dsh-semver — exercises each defineTool surface through
 * the built ToolSet, including invalid input paths and output shape stability.
 *
 * ORACLE: test/oracle/range-algebra-oracle.mjs
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
    const out = await tools.semver_satisfies.execute({ version: '1.2.3', range: 'not-a-range' })
    expect(out.valid).toBe(false)
    expect(typeof out.reason).toBe('string')
  })

  it('accepts npm partial-version comparators (">1.2" means ">=1.3.0")', async () => {
    const out = await tools.semver_satisfies.execute({ version: '1.2.9', range: '>1.2' })
    expect(out.valid).toBe(true)
    expect(out.satisfied).toBe(false)
    const inside = await tools.semver_satisfies.execute({ version: '1.3.0', range: '>1.2' })
    expect(inside.satisfied).toBe(true)
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

describe('semver_min_version tool', () => {
  it('reports the lowest satisfying version (npm anchor)', async () => {
    const out = await tools.semver_min_version.execute({ range: '^1.2.3' })
    expect(out.valid).toBe(true)
    expect(out.satisfiable).toBe(true)
    expect(out.min).toBe('1.2.3')
    expect(out.explanation).toContain('1.2.3')
    assertNoUndefined(out)
  })

  it('applies the npm ">" rule and the partial-range rewrite (npm anchors)', async () => {
    expect((await tools.semver_min_version.execute({ range: '>1.2.3' })).min).toBe('1.2.4')
    expect((await tools.semver_min_version.execute({ range: '>1.2' })).min).toBe('1.3.0')
    expect((await tools.semver_min_version.execute({ range: '~1.2.3' })).min).toBe('1.2.3')
    expect((await tools.semver_min_version.execute({ range: '<=1.2.3' })).min).toBe('0.0.0')
  })

  it('flags unsatisfiable ranges without a min key', async () => {
    const out = await tools.semver_min_version.execute({ range: '>2.0.0 <2.0.1' })
    expect(out.valid).toBe(true)
    expect(out.satisfiable).toBe(false)
    expect('min' in out).toBe(false)
    expect(out.explanation).toContain('no version satisfies')
    assertNoUndefined(out)
  })

  it('reports invalid ranges', async () => {
    const out = await tools.semver_min_version.execute({ range: '' })
    expect(out.valid).toBe(false)
    expect(out.reason?.length).toBeGreaterThan(0)
    assertNoUndefined(out)
  })
})

describe('semver_intersects tool', () => {
  it('detects overlapping ranges and returns a verified witness (npm anchor)', async () => {
    const out = await tools.semver_intersects.execute({ range1: '^1.2.3', range2: '^1.3.0' })
    expect(out.valid).toBe(true)
    expect(out.intersects).toBe(true)
    expect(out.witness).toBeTypeOf('string')
    const witness = out.witness ?? ''
    expect((await tools.semver_satisfies.execute({ version: witness, range: '^1.2.3' })).satisfied).toBe(true)
    expect((await tools.semver_satisfies.execute({ version: witness, range: '^1.3.0' })).satisfied).toBe(true)
    // The rendered text is all the model sees — it must carry the witness too (found in the
    // v0.3.0 headless e2e: the structured field had it, the rendered line did not).
    const render = tools.semver_intersects.output.render as unknown as
      (args: Record<string, never> | { range1: string; range2: string }, value: unknown) => { text?: string }[]
    const rendered = render({ range1: '^1.2.3', range2: '^1.3.0' }, out)[0]?.text ?? ''
    expect(rendered).toContain(witness)
    assertNoUndefined(out)
  })

  it('detects disjoint ranges and omits the witness (npm anchor)', async () => {
    const out = await tools.semver_intersects.execute({ range1: '^1.0.0', range2: '^2.0.0' })
    expect(out.intersects).toBe(false)
    expect('witness' in out).toBe(false)
    expect(out.explanation).toContain('do not overlap')
    assertNoUndefined(out)
  })

  it('handles alternations and unsatisfiable sets (npm anchors)', async () => {
    expect((await tools.semver_intersects.execute({ range1: '^1.0.0 || ^2.0.0', range2: '^2.5.0' })).intersects).toBe(true)
    expect((await tools.semver_intersects.execute({ range1: '^1.0.0 || ^3.0.0', range2: '^2.0.0' })).intersects).toBe(false)
    expect((await tools.semver_intersects.execute({ range1: '>=1.0.0 <1.0.0', range2: '*' })).intersects).toBe(false)
  })

  it('reports invalid ranges', async () => {
    const out = await tools.semver_intersects.execute({ range1: '^1.2.3', range2: 'not-a-range' })
    expect(out.valid).toBe(false)
    expect(out.intersects).toBe(false)
    expect(out.reason?.length).toBeGreaterThan(0)
    assertNoUndefined(out)
  })
})

describe('semver_coerce tool', () => {
  it('pulls a version out of a sentence (npm anchor)', async () => {
    const out = await tools.semver_coerce.execute({ text: 'expected node v18.16.1, found 20.11' })
    expect(out.valid).toBe(true)
    expect(out.coerced).toBe('18.16.1')
    expect(out.major).toBe(18)
    expect(out.minor).toBe(16)
    expect(out.patch).toBe(1)
    assertNoUndefined(out)
  })

  it('fills missing components with zeros and drops what npm drops (npm anchors)', async () => {
    expect((await tools.semver_coerce.execute({ text: 'v2' })).coerced).toBe('2.0.0')
    expect((await tools.semver_coerce.execute({ text: 'release-1.2' })).coerced).toBe('1.2.0')
    expect((await tools.semver_coerce.execute({ text: '1.2.3-beta.1+build.9' })).coerced).toBe('1.2.3')
    // npm consumes the digits that follow the match, so a fourth component is dropped.
    expect((await tools.semver_coerce.execute({ text: '1.2.3.4' })).coerced).toBe('1.2.3')
  })

  it('reports "no version" without inventing one, and never an undefined key', async () => {
    const out = await tools.semver_coerce.execute({ text: 'x.y.z' })
    expect(out.valid).toBe(true)
    expect('coerced' in out).toBe(false)
    assertNoUndefined(out)
    const render = tools.semver_coerce.output.render as unknown as
      (args: { text: string }, value: unknown) => { text?: string }[]
    expect(render({ text: 'x.y.z' }, out)[0]?.text).toContain('no version-like number')
  })

  it('reports an unrepresentable number as no-version with the reason (npm returns null)', async () => {
    const out = await tools.semver_coerce.execute({ text: 'v9999999999999999' })
    expect(out.valid).toBe(true)
    expect('coerced' in out).toBe(false)
    expect(out.note).toContain('MAX_SAFE_INTEGER')
    const render = tools.semver_coerce.output.render as unknown as
      (args: { text: string }, value: unknown) => { text?: string }[]
    expect(render({ text: 'v9999999999999999' }, out)[0]?.text).toContain('MAX_SAFE_INTEGER')
    assertNoUndefined(out)
  })
})

describe('semver_outside tool', () => {
  it('says "above" for a version newer than everything the range accepts (npm gtr anchor)', async () => {
    const out = await tools.semver_outside.execute({ version: '2.0.0', range: '^1.2.3' })
    expect(out.valid).toBe(true)
    expect(out.relation).toBe('above')
    expect(out.above).toBe(true)
    expect(out.below).toBe(false)
    expect(out.satisfies).toBe(false)
    assertNoUndefined(out)
  })

  it('says "below" for an older version and "inside" for a matching one (npm ltr anchor)', async () => {
    const below = await tools.semver_outside.execute({ version: '1.0.0', range: '^1.2.3' })
    expect(below.relation).toBe('below')
    const inside = await tools.semver_outside.execute({ version: '1.4.0', range: '^1.2.3' })
    expect(inside.relation).toBe('inside')
    expect(inside.satisfies).toBe(true)
    assertNoUndefined(below)
    assertNoUndefined(inside)
  })

  it('names the gap between alternatives instead of forcing a direction (npm anchor)', async () => {
    // npm: gtr("2.0.0", "^1.0.0 || ^3.0.0") === false && ltr(...) === false.
    const out = await tools.semver_outside.execute({ version: '2.0.0', range: '^1.0.0 || ^3.0.0' })
    expect(out.relation).toBe('gap')
    expect(out.satisfies).toBe(false)
    expect(out.above).toBe(false)
    expect(out.below).toBe(false)
    const render = tools.semver_outside.output.render as unknown as
      (args: { version: string; range: string }, value: unknown) => { text?: string }[]
    expect(render({ version: '2.0.0', range: '^1.0.0 || ^3.0.0' }, out)[0]?.text).toContain('neither above nor below')
    assertNoUndefined(out)
  })

  it('surfaces npm\'s tuple-lock quirk rather than smoothing it over (npm anchor)', async () => {
    // A prerelease cannot satisfy a plain range, so npm reports gtr AND ltr true
    // here (npm grid: ">=1.2.0 <2.0.0" vs 1.2.3-beta.1 is in both lists).
    const out = await tools.semver_outside.execute({ version: '1.2.3-beta.1', range: '>=1.2.0 <2.0.0' })
    expect(out.satisfies).toBe(false)
    expect(out.above).toBe(true)
    expect(out.below).toBe(true)
    assertNoUndefined(out)
  })

  it('reports invalid versions and ranges', async () => {
    const bad = await tools.semver_outside.execute({ version: 'not-a-version', range: '^1.2.3' })
    expect(bad.valid).toBe(false)
    expect(bad.reason?.length).toBeGreaterThan(0)
    const badRange = await tools.semver_outside.execute({ version: '1.2.3', range: 'not-a-range' })
    expect(badRange.valid).toBe(false)
    assertNoUndefined(bad)
    assertNoUndefined(badRange)
  })
})
