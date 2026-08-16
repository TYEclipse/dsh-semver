/**
 * Core semantic versioning tests — every assertion is a known anchor from the
 * semver 2.0.0 spec or npm's documented range behavior, never a self-roundtrip.
 *
 * @module dsh-semver/test
 */

import { describe, expect, it } from 'vitest'
import { compareVersions, normalizeVersion, parseVersion, relationLabel, satisfiesRange } from '../src/semver.ts'

function parse(input: string) {
  const result = parseVersion(input)
  if (!result.ok) throw new Error(`unexpected invalid: ${result.reason}`)
  return result.value
}

describe('parseVersion', () => {
  it('parses a plain version', () => {
    const v = parse('1.2.3')
    expect(v).toMatchObject({ major: 1, minor: 2, patch: 3 })
    expect(v.prerelease).toBeNull()
    expect(v.build).toBeNull()
    expect(normalizeVersion(v)).toBe('1.2.3')
  })

  it('accepts v and = prefixes', () => {
    expect(normalizeVersion(parse('v2.0.0'))).toBe('2.0.0')
    expect(normalizeVersion(parse('=2.0.0'))).toBe('2.0.0')
  })

  it('parses prerelease and build identifiers', () => {
    const v = parse('1.2.3-beta.1+build.5')
    expect(v.prerelease).toEqual(['beta', '1'])
    expect(v.build).toEqual(['build', '5'])
    expect(normalizeVersion(v)).toBe('1.2.3-beta.1+build.5')
  })

  it('allows hyphens inside prerelease identifiers', () => {
    expect(parse('1.0.0-rc-1').prerelease).toEqual(['rc-1'])
  })

  it('rejects malformed versions with a reason', () => {
    for (const bad of ['', '1.2', '1.2.3.4', '01.2.3', '1.02.3', '1.2.03', '1.2.3-01', '1.2.3-', '1.2.3+', 'abc', '-1.2.3', '1.2.3-beta..1', '1.2.3 beta']) {
      const result = parseVersion(bad)
      expect(result.ok, `expected "${bad}" to be invalid`).toBe(false)
      expect(result.ok ? '' : result.reason.length).toBeGreaterThan(0)
    }
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeVersion(parse('  1.2.3  '))).toBe('1.2.3')
  })
})

describe('compareVersions (spec precedence chain)', () => {
  it('orders the canonical prerelease chain correctly', () => {
    // From the semver 2.0.0 spec §11.
    const chain = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
    ]
    for (let i = 0; i < chain.length - 1; i++) {
      const a = parse(chain[i] ?? '')
      const b = parse(chain[i + 1] ?? '')
      expect(compareVersions(a, b), `${chain[i]} < ${chain[i + 1]}`).toBe(-1)
      expect(relationLabel(a, b)).toBe('lt')
    }
  })

  it('ignores build metadata for precedence', () => {
    expect(compareVersions(parse('1.0.0+build.1'), parse('1.0.0'))).toBe(0)
    expect(compareVersions(parse('1.0.0+build.1'), parse('1.0.0+build.2'))).toBe(0)
    expect(relationLabel(parse('1.0.0+build.1'), parse('1.0.0'))).toBe('eq')
  })

  it('compares numeric fields', () => {
    expect(compareVersions(parse('2.1.0'), parse('2.0.3'))).toBe(1)
    expect(compareVersions(parse('1.2.3'), parse('1.2.4'))).toBe(-1)
    expect(compareVersions(parse('1.2.3'), parse('1.2.3'))).toBe(0)
    expect(relationLabel(parse('2.1.0'), parse('2.0.3'))).toBe('gt')
  })

  it('sorts numeric prerelease identifiers numerically, not lexically', () => {
    expect(compareVersions(parse('1.0.0-alpha.9'), parse('1.0.0-alpha.10'))).toBe(-1)
  })
})

describe('satisfiesRange', () => {
  const sat = (version: string, range: string, includePrerelease = false): boolean => {
    const result = satisfiesRange(parse(version), range, includePrerelease)
    if (!result.ok) throw new Error(`invalid range "${range}": ${result.reason}`)
    return result.satisfied
  }

  it('exact versions', () => {
    expect(sat('1.2.3', '1.2.3')).toBe(true)
    expect(sat('1.2.3', '=1.2.3')).toBe(true)
    expect(sat('1.2.4', '1.2.3')).toBe(false)
    expect(sat('1.2.3+b1', '1.2.3')).toBe(true) // build ignored
  })

  it('comparison operators', () => {
    expect(sat('1.5.0', '>=1.2.0')).toBe(true)
    expect(sat('1.2.0', '>=1.2.0')).toBe(true)
    expect(sat('1.1.9', '>=1.2.0')).toBe(false)
    expect(sat('1.5.0', '<2.0.0')).toBe(true)
    expect(sat('2.0.0', '<2.0.0')).toBe(false)
    expect(sat('2.0.1', '>2.0.0')).toBe(true)
    expect(sat('2.0.0', '>2.0.0')).toBe(false)
    expect(sat('2.0.0', '<=2.0.0')).toBe(true)
  })

  it('caret ranges', () => {
    expect(sat('1.2.3', '^1.2.3')).toBe(true)
    expect(sat('1.9.9', '^1.2.3')).toBe(true)
    expect(sat('2.0.0', '^1.2.3')).toBe(false)
    expect(sat('1.2.2', '^1.2.3')).toBe(false)
    // 0.x caret rules: bump the first non-zero component
    expect(sat('0.2.9', '^0.2.3')).toBe(true)
    expect(sat('0.3.0', '^0.2.3')).toBe(false)
    expect(sat('0.0.3', '^0.0.3')).toBe(true)
    expect(sat('0.0.4', '^0.0.3')).toBe(false)
    // partial caret
    expect(sat('1.9.9', '^1.2')).toBe(true)
    expect(sat('2.0.0', '^1.2')).toBe(false)
    expect(sat('0.2.9', '^0.2')).toBe(true)
    expect(sat('0.3.0', '^0.2')).toBe(false)
    expect(sat('1.9.9', '^1')).toBe(true)
    expect(sat('2.0.0', '^1')).toBe(false)
  })

  it('tilde ranges', () => {
    expect(sat('1.2.9', '~1.2.3')).toBe(true)
    expect(sat('1.3.0', '~1.2.3')).toBe(false)
    expect(sat('1.2.0', '~1.2')).toBe(true)
    expect(sat('1.3.0', '~1.2')).toBe(false)
    expect(sat('1.9.9', '~1')).toBe(true)
    expect(sat('2.0.0', '~1')).toBe(false)
  })

  it('wildcard / x ranges', () => {
    expect(sat('1.2.5', '1.2.x')).toBe(true)
    expect(sat('1.3.0', '1.2.x')).toBe(false)
    expect(sat('1.9.9', '1.x')).toBe(true)
    expect(sat('2.0.0', '1.x')).toBe(false)
    expect(sat('1.2.5', '1.2.*')).toBe(true)
    expect(sat('9.9.9', '*')).toBe(true)
    expect(sat('0.0.1', 'x')).toBe(true)
    // bare partial versions act as x-ranges
    expect(sat('1.2.5', '1.2')).toBe(true)
    expect(sat('1.3.0', '1.2')).toBe(false)
    expect(sat('1.9.9', '1')).toBe(true)
    expect(sat('2.0.0', '1')).toBe(false)
  })

  it('hyphen ranges (inclusive full endpoints, exclusive partial upper)', () => {
    expect(sat('2.3.4', '1.2.3 - 2.3.4')).toBe(true)
    expect(sat('2.3.5', '1.2.3 - 2.3.4')).toBe(false)
    expect(sat('1.2.2', '1.2.3 - 2.3.4')).toBe(false)
    expect(sat('2.3.9', '1.2.3 - 2.3')).toBe(true)
    expect(sat('2.4.0', '1.2.3 - 2.3')).toBe(false)
    expect(sat('1.2.0', '1.2 - 2.3.4')).toBe(true)
    expect(sat('1.1.9', '1.2 - 2.3.4')).toBe(false)
  })

  it('AND and OR composition', () => {
    expect(sat('1.5.0', '>=1.2.0 <2.0.0')).toBe(true)
    expect(sat('2.0.0', '>=1.2.0 <2.0.0')).toBe(false)
    expect(sat('3.5.0', '^1.2.3 || >=3.0.0')).toBe(true)
    expect(sat('2.5.0', '^1.2.3 || >=3.0.0')).toBe(false)
    expect(sat('1.5.0', '^1.2.3 || >=3.0.0')).toBe(true)
  })

  it('npm prerelease tuple-lock', () => {
    // A range with a prerelease lower bound only matches prereleases of the same tuple.
    expect(sat('1.2.3-beta.5', '^1.2.3-beta.2')).toBe(true)
    expect(sat('1.2.3', '^1.2.3-beta.2')).toBe(true) // release still matches
    expect(sat('1.2.4-beta.1', '^1.2.3-beta.2')).toBe(false) // different tuple
    // A plain range never matches prereleases by default…
    expect(sat('1.2.4-beta.1', '^1.2.3')).toBe(false)
    // …unless includePrerelease is set.
    expect(sat('1.2.4-beta.1', '^1.2.3', true)).toBe(true)
    expect(sat('2.0.0-beta.1', '^1.2.3', true)).toBe(true) // prerelease < 2.0.0, still inside the range
  })

  it('rejects malformed ranges with a reason', () => {
    expect(satisfiesRange(parse('1.2.3'), '').ok).toBe(false)
    expect(satisfiesRange(parse('1.2.3'), '>=1.x').ok).toBe(false)
    expect(satisfiesRange(parse('1.2.3'), 'banana').ok).toBe(false)
    expect(satisfiesRange(parse('1.2.3'), '>=1.2.0 - <2.0.0').ok).toBe(false) // hyphen endpoints with operators
  })

  it('returns a normalized range in the report', () => {
    const result = satisfiesRange(parse('1.5.0'), '^1.2.3 || >=3.0.0')
    expect(result.ok && result.satisfied).toBe(true)
    if (result.ok) expect(result.normalized).toContain('>=1.2.3')
  })
})
