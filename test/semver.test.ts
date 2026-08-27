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

/* ------------------------------------------------------------------ *
 * v0.2.0 — incVersion / diffKind / sortVersionStrings                  *
 * Every anchor below was generated by npm semver 7.7.4 (the reference *
 * implementation), executed as an independent oracle.                 *
 * ------------------------------------------------------------------ */

import { compareBuildVersions, diffKind, incVersion, sortVersionStrings } from '../src/semver.ts'

function inc(input: string, release: string, identifier?: string): string {
  const result = incVersion(input, release, identifier)
  if (!result.ok) throw new Error(`unexpected inc failure for ${input}/${release}: ${result.reason}`)
  return result.value.next
}

describe('incVersion (npm semver.inc anchors)', () => {
  const anchors: [string, string, string | undefined, string][] = [
    // plain bumps
    ['1.2.3', 'major', undefined, '2.0.0'],
    ['1.2.3', 'minor', undefined, '1.3.0'],
    ['1.2.3', 'patch', undefined, '1.2.4'],
    ['0.1.2', 'minor', undefined, '0.2.0'],
    ['0.0.3', 'patch', undefined, '0.0.4'],
    // pre* bumps with and without identifiers
    ['1.2.3', 'premajor', undefined, '2.0.0-0'],
    ['1.2.3', 'premajor', 'beta', '2.0.0-beta.0'],
    ['1.2.3', 'preminor', 'rc', '1.3.0-rc.0'],
    ['1.2.3', 'prepatch', 'alpha', '1.2.4-alpha.0'],
    ['1.2.3', 'prerelease', undefined, '1.2.4-0'],
    ['1.2.3', 'prerelease', 'beta', '1.2.4-beta.0'],
    ['0.1.5', 'prerelease', 'alpha', '0.1.6-alpha.0'],
    ['1.0.0', 'prerelease', '1', '1.0.1-1.0'],
    // prerelease counter increments
    ['1.2.4-beta.0', 'prerelease', undefined, '1.2.4-beta.1'],
    ['1.2.4-beta.0', 'prerelease', 'beta', '1.2.4-beta.1'],
    ['1.2.4-beta.0', 'prerelease', 'rc', '1.2.4-rc.0'],
    ['1.2.4-beta', 'prerelease', undefined, '1.2.4-beta.0'],
    ['1.2.4-beta.9', 'prerelease', undefined, '1.2.4-beta.10'],
    ['1.2.3-alpha.9', 'prerelease', undefined, '1.2.3-alpha.10'],
    ['1.2.3-alpha.beta', 'prerelease', undefined, '1.2.3-alpha.beta.0'],
    ['1.2.3-alpha.beta', 'prerelease', 'beta', '1.2.3-beta.0'],
    ['1.2.3-0', 'prerelease', undefined, '1.2.3-1'],
    ['1.2.3-10.9', 'prerelease', undefined, '1.2.3-10.10'],
    // pre-major / pre-minor / pre-patch release without incrementing
    ['1.0.0-5', 'major', undefined, '1.0.0'],
    ['1.2.0-5', 'minor', undefined, '1.2.0'],
    ['1.2.0-5', 'patch', undefined, '1.2.0'],
    ['1.2.0-5', 'prerelease', undefined, '1.2.0-6'],
    ['2.0.0-rc.1', 'patch', undefined, '2.0.0'],
    ['1.0.0-beta.11', 'minor', undefined, '1.0.0'],
    ['1.0.0-beta.11', 'major', undefined, '1.0.0'],
    ['0.1.2-rc.1', 'minor', undefined, '0.2.0'],
    // prepatch always bumps patch (npm clears prerelease first)
    ['1.2.3-beta.9', 'prepatch', undefined, '1.2.4-0'],
    ['1.2.3-beta.9', 'prepatch', 'rc', '1.2.4-rc.0'],
    ['1.2.3-beta.9', 'preminor', undefined, '1.3.0-0'],
    ['1.2.3-beta.9', 'premajor', undefined, '2.0.0-0'],
    // dotted identifiers, v-prefix, build metadata dropped
    ['1.2.3', 'premajor', 'beta.1', '2.0.0-beta.1.0'],
    ['v1.4.2', 'patch', undefined, '1.4.3'],
    ['1.2.3+build.5', 'patch', undefined, '1.2.4'],
    ['1.2.3+build.5', 'prerelease', 'beta', '1.2.4-beta.0'],
    ['1.2.3+build.5', 'minor', undefined, '1.3.0'],
    ['0.9.9', 'premajor', undefined, '1.0.0-0'],
    // identifier ignored for non-pre releases
    ['1.2.3', 'patch', 'ignored', '1.2.4'],
    // empty identifier acts like absent (npm parity)
    ['1.2.3', 'premajor', '', '2.0.0-0'],
  ]
  it.each(anchors)('inc(%s, %s, %s) = %s', (input, release, identifier, expected) => {
    expect(identifier === undefined ? inc(input, release) : inc(input, release, identifier)).toBe(expected)
  })

  it('rejects invalid identifiers', () => {
    for (const bad of ['01', 'beta!', '.beta', 'beta..1']) {
      const result = incVersion('1.2.3', 'premajor', bad)
      expect(result.ok, `expected identifier "${bad}" to be invalid`).toBe(false)
      expect(result.ok ? '' : result.reason.length).toBeGreaterThan(0)
    }
  })

  it('rejects unknown release types and invalid versions', () => {
    expect(incVersion('1.2.3', 'sideways').ok).toBe(false)
    expect(incVersion('nope', 'major').ok).toBe(false)
  })

  it('reports from/next/rule on success', () => {
    const result = incVersion('1.2.4-beta.0', 'prerelease', 'beta')
    expect(result.ok && result.value.from).toBe('1.2.4-beta.0')
    expect(result.ok && result.value.next).toBe('1.2.4-beta.1')
    expect(result.ok && result.value.rule).toContain('prerelease')
  })
})

describe('diffKind (npm semver.diff anchors)', () => {
  const anchors: [string, string, string | null][] = [
    ['1.2.3', '1.2.4', 'patch'],
    ['1.2.3', '1.3.0', 'minor'],
    ['1.2.3', '2.0.0', 'major'],
    ['1.2.3', '1.2.3', null],
    ['1.0.0', '1.0.0+build.5', null],
    ['1.2.3', '1.2.3-beta.1', 'patch'], // npm special case: prerelease→release same tuple = patch
    ['1.2.4-beta.1', '1.2.4', 'patch'],
    ['1.2.3-1', '1.2.3', 'patch'],
    ['1.2.0-1', '1.2.0', 'minor'],
    ['1.0.0-1', '1.0.0', 'major'],
    ['1.0.0-1', '1.1.1', 'major'],
    ['1.0.0-1', '2.0.0', 'major'],
    ['1.2.3', '1.2.4-beta.1', 'prepatch'],
    ['1.2.3', '1.3.0-beta.1', 'preminor'],
    ['1.2.3', '2.0.0-beta.1', 'premajor'],
    ['1.2.4-beta.1', '1.2.4-beta.2', 'prerelease'],
    ['1.2.3-alpha', '1.2.3-beta', 'prerelease'],
    ['2.1.0', '1.9.9', 'major'],
    ['0.1.0', '0.2.0', 'minor'],
    ['0.0.1', '0.0.2', 'patch'],
  ]
  it.each(anchors)('diff(%s, %s) = %s', (left, right, expected) => {
    expect(diffKind(parse(left), parse(right))).toBe(expected)
  })
})

describe('sortVersionStrings (npm semver.sort anchors)', () => {
  it('sorts ascending by precedence', () => {
    const result = sortVersionStrings(['1.2.3', '1.2.10', '1.0.0'])
    expect(result.ok && result.value.sorted).toEqual(['1.0.0', '1.2.3', '1.2.10'])
    expect(result.ok && result.value.invalid).toEqual([])
  })

  it('sorts descending', () => {
    const result = sortVersionStrings(['1.2.3', '1.2.10', '1.0.0'], 'desc')
    expect(result.ok && result.value.sorted).toEqual(['1.2.10', '1.2.3', '1.0.0'])
  })

  it('orders prereleases before their release', () => {
    const result = sortVersionStrings(['1.0.0', '1.0.0-rc.1', '1.0.0-alpha', '1.0.0-alpha.1'])
    expect(result.ok && result.value.sorted).toEqual(['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-rc.1', '1.0.0'])
  })

  it('compares 1.10.0 numerically, not lexically', () => {
    const result = sortVersionStrings(['2.0.0', '10.0.0', '1.9.9', '1.10.0'])
    expect(result.ok && result.value.sorted).toEqual(['1.9.9', '1.10.0', '2.0.0', '10.0.0'])
  })

  it('uses build metadata as tie-break (npm compareBuild)', () => {
    const asc = sortVersionStrings(['1.0.0+b.1', '1.0.0+a.2', '1.0.0', '1.0.0+c.0'])
    expect(asc.ok && asc.value.sorted).toEqual(['1.0.0', '1.0.0+a.2', '1.0.0+b.1', '1.0.0+c.0'])
    const desc = sortVersionStrings(['1.0.0+b.1', '1.0.0+a.2', '1.0.0', '1.0.0+c.0'], 'desc')
    expect(desc.ok && desc.value.sorted).toEqual(['1.0.0+c.0', '1.0.0+b.1', '1.0.0+a.2', '1.0.0'])
  })

  it('skips invalid entries and reports their index', () => {
    const result = sortVersionStrings(['2.0.0', 'nope', '1.0.0'])
    expect(result.ok && result.value.sorted).toEqual(['1.0.0', '2.0.0'])
    expect(result.ok && result.value.invalid.map((e) => e.index)).toEqual([1])
  })

  it('handles empty input', () => {
    const result = sortVersionStrings([])
    expect(result.ok && result.value.sorted).toEqual([])
    expect(result.ok && result.value.invalid).toEqual([])
  })
})

describe('compareBuildVersions (npm compareBuild)', () => {
  it('ignores build metadata when precedence differs', () => {
    expect(compareBuildVersions(parse('1.2.3+a'), parse('1.2.4+b'))).toBeLessThan(0)
  })
  it('orders null build before any build metadata', () => {
    expect(compareBuildVersions(parse('1.0.0'), parse('1.0.0+a.2'))).toBeLessThan(0)
    expect(compareBuildVersions(parse('1.0.0+a.2'), parse('1.0.0'))).toBeGreaterThan(0)
  })
  it('compares build identifiers numeric-aware', () => {
    expect(compareBuildVersions(parse('1.0.0+b.2'), parse('1.0.0+b.10'))).toBeLessThan(0)
    expect(compareBuildVersions(parse('1.0.0+b.10'), parse('1.0.0+b.2'))).toBeGreaterThan(0)
  })
})
