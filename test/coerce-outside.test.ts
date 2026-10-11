/**
 * v0.4.0 coerce / outside tests — driven by an independent oracle.
 *
 * ORACLE: test/oracle/range-algebra-oracle.mjs
 *
 * Every expectation below comes from `test/anchors/range-algebra.json`, which is
 * raw output of **npm's own semver package** for `coerce`, `gtr`, `ltr` and the
 * comparator sets `Range.set` builds. The corpus deliberately includes npm's
 * awkward cases: the trailing boundary `coerce` consumes ("1.2.3.4" → 1.2.3),
 * the numbers npm cannot represent, the date that a changelog puts before the
 * version, and the prereleases no plain range can ever match — which is what
 * makes `gtr` and `ltr` both true for the same version.
 *
 * @module dsh-semver/test
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { coerceVersion, npmRangeSets, outsideRange } from '../src/semver.ts'

interface Anchors {
  oracle: { name: string; version: string }
  coerce: [string, string | null][]
  rangeSets: Record<string, string[][]>
  satisfies: [string, string, boolean][]
  outside: [string, string, boolean, boolean][]
}

const anchors = JSON.parse(
  readFileSync(fileURLToPath(new URL('./anchors/range-algebra.json', import.meta.url)), 'utf8'),
) as Anchors

const satisfiedFor = (range: string, version: string): boolean =>
  anchors.satisfies.some(([r, v, value]) => r === range && v === version && value)

/** npm's four outcomes, derived from the anchor booleans exactly like the tool does. */
function relationOf(range: string, version: string, above: boolean, below: boolean): string {
  if (satisfiedFor(range, version)) return 'inside'
  if (above && below) return 'gap'
  if (above) return 'above'
  if (below) return 'below'
  return 'gap'
}

describe(`coerce vs npm semver ${anchors.oracle.version} (oracle anchors)`, () => {
  it('covers a corpus that includes both a version and a no-version outcome', () => {
    expect(anchors.coerce.length).toBeGreaterThanOrEqual(25)
    expect(anchors.coerce.filter(([, value]) => value === null).length).toBeGreaterThan(0)
    expect(anchors.coerce.filter(([, value]) => value !== null).length).toBeGreaterThan(0)
  })

  it('reproduces npm coerce for every corpus input', () => {
    const mismatches: string[] = []
    for (const [input, expected] of anchors.coerce) {
      const got = coerceVersion(input)
      if (!got.ok) mismatches.push(`${JSON.stringify(input)}: error ${got.reason}`)
      else if (got.value.version !== expected) {
        mismatches.push(`${JSON.stringify(input)}: ${got.value.version} vs npm ${expected}`)
      }
    }
    expect(mismatches).toEqual([])
  })

  it('reports the unrepresentable number as "no version", with the reason (npm returns null)', () => {
    // npm's parse() swallows "Invalid major version" and returns null, so a
    // 16-digit component is simply not a version — reported, never rounded.
    for (const input of ['v9999999999999999', '9999999999999999.1.1']) {
      expect(anchors.coerce).toContainEqual([input, null])
      const got = coerceVersion(input)
      expect(got.ok && got.value.version, input).toBeNull()
      expect(got.ok && got.value.note, input).toContain('MAX_SAFE_INTEGER')
    }
    // A plain "no number in the text" case has no note to give.
    const plain = coerceVersion('x.y.z')
    expect(plain.ok && plain.value.version).toBeNull()
    expect(plain.ok && plain.value.note).toBeNull()
  })

  it('drops prerelease and build metadata exactly like npm\'s default', () => {
    // npm's default coerce keeps only the numeric triple; keeping the suffix
    // would silently disagree with the oracle on "1.2.3-beta.1+build.9".
    expect(anchors.coerce).toContainEqual(['1.2.3-beta.1+build.9', '1.2.3'])
    const got = coerceVersion('version 1.2.3-beta.1')
    expect(got.ok && got.value.version).toBe('1.2.3')
  })

  it('anchors the surprising "first number wins" cases', () => {
    // A changelog line coerces to its DATE, not to the version it mentions.
    expect(anchors.coerce).toContainEqual(['changelog 2026-10-12: 4.5.6 released', '2026.0.0'])
    expect(coerceVersion('changelog 2026-10-12: 4.5.6 released').ok).toBe(true)
    const date = coerceVersion('changelog 2026-10-12: 4.5.6 released')
    expect(date.ok && date.value.version).toBe('2026.0.0')
    // A commit sha is a number run too.
    const sha = coerceVersion('sha 4b825dc642cb6eb9a060e54bf8d69288fbee4904')
    expect(sha.ok && sha.value.version).toBe('4.0.0')
  })
})

describe(`npm comparator shape vs npm semver ${anchors.oracle.version} (oracle anchors)`, () => {
  it('reproduces Range.set for every corpus range, comparator for comparator', () => {
    const mismatches: string[] = []
    for (const [range, expected] of Object.entries(anchors.rangeSets)) {
      const got = npmRangeSets(range)
      if (!got.ok) mismatches.push(`${range}: error ${got.reason}`)
      else if (JSON.stringify(got.sets) !== JSON.stringify(expected)) {
        mismatches.push(`${range}: ${JSON.stringify(got.sets)} vs npm ${JSON.stringify(expected)}`)
      }
    }
    expect(mismatches).toEqual([])
  })

  it('keeps the load-bearing details: bare exact versions, -0 upper bounds, dropped >=0.0.0', () => {
    // npm's outside() reads comparator.operator, so the shape itself is the contract.
    expect(anchors.rangeSets['1.2.3']).toEqual([['1.2.3']])
    expect(anchors.rangeSets['^1.2.3']).toEqual([['>=1.2.3', '<2.0.0-0']])
    expect(anchors.rangeSets['<=1.2']).toEqual([['<1.3.0-0']])
    expect(anchors.rangeSets['^0']).toEqual([['<1.0.0-0']])
    expect(anchors.rangeSets['*']).toEqual([['ANY']])
    const got = npmRangeSets('1.2.3 - 2.3')
    expect(got.ok && got.sets).toEqual([['>=1.2.3', '<2.4.0-0']])
  })
})

describe(`outside (gtr / ltr) vs npm semver ${anchors.oracle.version} (oracle anchors)`, () => {
  it('covers every npm outcome, so the sweep can discriminate', () => {
    expect(anchors.outside.length).toBeGreaterThanOrEqual(800)
    const outcomes = new Set(anchors.outside.map(([range, version, above, below]) => relationOf(range, version, above, below)))
    expect([...outcomes].sort()).toEqual(['above', 'below', 'gap', 'inside'])
  })

  it('reproduces npm gtr, npm ltr and npm satisfies for every corpus pair', () => {
    const mismatches: string[] = []
    for (const [range, version, above, below] of anchors.outside) {
      const got = outsideRange(version, range)
      if (!got.ok) {
        mismatches.push(`${version} @ ${range}: error ${got.reason}`)
        continue
      }
      const satisfied = satisfiedFor(range, version)
      if (got.value.above !== above) mismatches.push(`${version} @ ${range}: gtr ${got.value.above} vs npm ${above}`)
      if (got.value.below !== below) mismatches.push(`${version} @ ${range}: ltr ${got.value.below} vs npm ${below}`)
      if (got.value.satisfies !== satisfied) mismatches.push(`${version} @ ${range}: satisfies ${got.value.satisfies} vs npm ${satisfied}`)
    }
    expect(mismatches).toEqual([])
  })

  it('keeps a version that sits between two alternatives out of both above and below', () => {
    // npm: gtr("2.0.0", "^1.0.0 || ^3.0.0") === false && ltr(...) === false, and
    // it does not satisfy the range either — the "gap" case the tool names.
    expect(anchors.outside).toContainEqual(['^1.0.0 || ^3.0.0', '2.0.0', false, false])
    const got = outsideRange('2.0.0', '^1.0.0 || ^3.0.0')
    expect(got.ok && got.value.satisfies).toBe(false)
    expect(got.ok && got.value.above).toBe(false)
    expect(got.ok && got.value.below).toBe(false)
  })

  it('surfaces npm\'s tuple-lock quirk instead of hiding it (both directions true)', () => {
    // A prerelease never satisfies a plain range, so npm's outside() calls it
    // both "above" and "below" the range. The corpus pins that npm really does
    // this; our port must reproduce it, and no non-prerelease may ever do it.
    const both = anchors.outside.filter(([, , above, below]) => above && below)
    expect(both.length).toBeGreaterThan(0)
    for (const [range, version] of both) {
      expect(version, `${version} @ ${range} is a prerelease`).toContain('-')
      const got = outsideRange(version, range)
      expect(got.ok && got.value.satisfies).toBe(false)
      expect(got.ok && got.value.above).toBe(true)
      expect(got.ok && got.value.below).toBe(true)
    }
  })

  it('rejects unparseable versions and ranges explicitly', () => {
    expect(outsideRange('not-a-version', '^1.2.3').ok).toBe(false)
    expect(outsideRange('1.2.3', 'not-a-range').ok).toBe(false)
    expect(outsideRange('1.2.3', '   ').ok).toBe(false)
  })

  it('normalizes the range the way npm compiles it and answers with npm verdicts', () => {
    const got = outsideRange('2.0.0', '^1.2.3')
    // `normalized` is the comparator set the verdicts were computed from — npm's
    // own shape, `-0` upper bound included (the anchored shape above).
    expect(got.ok && got.value.normalized).toBe('<2.0.0-0 >=1.2.3')
    expect(got.ok && got.value.above).toBe(true)
  })
})
