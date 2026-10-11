/**
 * v0.3.0 range-algebra tests — driven by an independent oracle.
 *
 * ORACLE: test/oracle/range-algebra-oracle.mjs
 *
 * Every expectation in this file comes from `test/anchors/range-algebra.json`,
 * which is raw output of **npm's own semver package** (see
 * test/oracle/range-algebra-oracle.mjs). No expected value here is hand-written:
 * the v0.2.x `~1.2.3` bug existed precisely because its expectation was picked
 * by hand and happened to sit outside the wrong lower bound.
 *
 * @module dsh-semver/test
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  minVersionOfRange,
  parseVersion,
  rangesIntersect,
  satisfiesRange,
  type ParsedVersion,
} from '../src/semver.ts'

interface Anchors {
  oracle: { name: string; version: string }
  minVersions: Record<string, string | null>
  intersects: Record<string, boolean>
  satisfies: [string, string, boolean][]
}

const anchors = JSON.parse(
  readFileSync(fileURLToPath(new URL('./anchors/range-algebra.json', import.meta.url)), 'utf8'),
) as Anchors

const parse = (input: string): ParsedVersion => {
  const parsed = parseVersion(input)
  if (!parsed.ok) throw new Error(`fixture version did not parse: ${input}`)
  return parsed.value
}

describe(`range algebra vs npm semver ${anchors.oracle.version} (oracle anchors)`, () => {
  it('covers a meaningful corpus', () => {
    expect(Object.keys(anchors.minVersions).length).toBeGreaterThanOrEqual(50)
    expect(Object.keys(anchors.intersects).length).toBeGreaterThanOrEqual(400)
    expect(anchors.satisfies.length).toBeGreaterThanOrEqual(800)
    // The corpus must contain both outcomes, otherwise the sweep proves nothing.
    expect(new Set(Object.values(anchors.intersects)).size).toBe(2)
    expect(new Set(anchors.satisfies.map(([, , expected]) => expected)).size).toBe(2)
  })

  it('reproduces npm minVersion for every corpus range', () => {
    const mismatches: string[] = []
    for (const [range, expected] of Object.entries(anchors.minVersions)) {
      const got = minVersionOfRange(range)
      if (!got.ok) mismatches.push(`${range}: error ${got.reason}`)
      else if (got.value.min !== expected) mismatches.push(`${range}: ${got.value.min} vs npm ${expected}`)
    }
    expect(mismatches).toEqual([])
  })

  it('reproduces npm intersects for every corpus pair', () => {
    const mismatches: string[] = []
    for (const [key, expected] of Object.entries(anchors.intersects)) {
      const [a, b] = key.split('\u0000') as [string, string]
      const got = rangesIntersect(a, b)
      if (!got.ok) mismatches.push(`${a} ∩ ${b}: error ${got.reason}`)
      else if (got.value.intersects !== expected) mismatches.push(`${a} ∩ ${b}: ${got.value.intersects} vs npm ${expected}`)
    }
    expect(mismatches).toEqual([])
  })

  it('reproduces npm satisfies for every corpus range/version pair', () => {
    const mismatches: string[] = []
    for (const [range, version, expected] of anchors.satisfies) {
      const got = satisfiesRange(parse(version), range)
      if (!got.ok) mismatches.push(`${version} @ ${range}: error ${got.reason}`)
      else if (got.satisfied !== expected) mismatches.push(`${version} @ ${range}: ${got.satisfied} vs npm ${expected}`)
    }
    expect(mismatches).toEqual([])
  })

  it('never reports a witness that does not satisfy both ranges', () => {
    let checked = 0
    for (const [key, expected] of Object.entries(anchors.intersects)) {
      if (!expected) continue
      const [a, b] = key.split('\u0000') as [string, string]
      const got = rangesIntersect(a, b)
      if (!got.ok || got.value.witness === null) continue
      checked++
      const witness = got.value.witness
      expect(sat(witness, a), `${witness} @ ${a}`).toBe(true)
      expect(sat(witness, b), `${witness} @ ${b}`).toBe(true)
    }
    expect(checked).toBeGreaterThan(100) // the witness path is actually exercised
  })
})

describe('range parsing regressions (v0.3.0 fixes)', () => {
  it('honours the patch in a tilde range instead of widening it', () => {
    // v0.2.x bug: "~1.2.3" was parsed as >=1.2.0 <1.3.0, so 1.2.0/1.2.1 matched.
    expect(sat('1.2.0', '~1.2.3')).toBe(false)
    expect(sat('1.2.1', '~1.2.3')).toBe(false)
    expect(sat('1.2.3', '~1.2.3')).toBe(true)
    expect(sat('1.2.9', '~1.2.3')).toBe(true)
    expect(sat('1.3.0', '~1.2.3')).toBe(false)
    // Partial tilde keeps the npm behaviour (~1.2 → >=1.2.0 <1.3.0).
    expect(sat('1.2.0', '~1.2')).toBe(true)
    expect(sat('1.1.9', '~1.2')).toBe(false)
    const min = minVersionOfRange('~1.2.3')
    expect(min.ok && min.value.min).toBe('1.2.3')
  })

  it('supports partial versions combined with comparison operators (npm x-range rewrite)', () => {
    // ">1.2" means ">=1.3.0" in npm — before v0.3.0 this was rejected as invalid.
    expect(sat('1.2.9', '>1.2')).toBe(false)
    expect(sat('1.3.0', '>1.2')).toBe(true)
    expect(sat('1.2.99', '<=1.2')).toBe(true)
    expect(sat('1.3.0', '<=1.2')).toBe(false)
    expect(sat('1.1.0', '<1.2')).toBe(true)
    expect(sat('1.2.0', '<1.2')).toBe(false)
    expect(sat('1.2.0', '>=1.2')).toBe(true)
    expect(sat('0.9.9', '>=1.2')).toBe(false)
    expect(sat('1.2.9', '>1.2.x')).toBe(false)
    expect(sat('1.3.0', '>1.2.x')).toBe(true)
    const min = minVersionOfRange('>1.2')
    expect(min.ok && min.value.min).toBe('1.3.0')
    const minPartial = minVersionOfRange('>=1.2.x')
    expect(minPartial.ok && minPartial.value.min).toBe('1.2.0')
  })

  it('reports unsatisfiable ranges as unsatisfiable instead of guessing a bound', () => {
    for (const range of ['^0.1.4 ~3.0.2', '>=1.0.0 <1.0.0', '>2.0.0 <2.0.1']) {
      const got = minVersionOfRange(range)
      expect(got.ok && got.value.min, range).toBeNull()
    }
    // A wildcard-only range has the floor 0.0.0, and 0.0.0-0 only when the range can want prereleases.
    const wildcard = minVersionOfRange('*')
    expect(wildcard.ok && wildcard.value.min).toBe('0.0.0')
    const isEmpty = minVersionOfRange('>*')
    expect(isEmpty.ok && isEmpty.value.min).toBeNull()
  })

  it('rejects unparseable ranges instead of silently matching everything', () => {
    for (const range of ['', '   ', 'not-a-range', '>=1.2.3.4', '1.2.3 - ']) {
      const got = minVersionOfRange(range)
      if (got.ok) expect(got.value.min, range).toBeNull()
      else expect(got.reason.length).toBeGreaterThan(0)
    }
    const bad = rangesIntersect('^1.2.3', 'nope')
    expect(bad.ok).toBe(false)
  })
})

function sat(version: string, range: string): boolean {
  const result = satisfiesRange(parse(version), range)
  if (!result.ok) throw new Error(`range did not parse: ${range} (${result.reason})`)
  return result.satisfied
}
