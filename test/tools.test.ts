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
