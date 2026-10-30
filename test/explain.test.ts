/**
 * v0.5.0 `semver_explain` tests — every expectation is anchored to npm.
 *
 * ORACLE: test/oracle/range-algebra-oracle.mjs
 *
 * Two layers, both fed by `test/anchors/range-algebra.json` (raw output of
 * **npm's own semver package**, re-derived by `--check`):
 *   1. corpus sweep — `explainRange(...).satisfied` must equal npm's `Range.test`
 *      for all 54 ranges × 16 versions (the same table `semver_satisfies` uses);
 *   2. structural anchors — the `explain` region carries, per case, npm's own
 *      comparators (from `Range.set`) with npm's per-comparator verdict
 *      (`Comparator.test`, which applies no prerelease rule) and whether the
 *      tuple-lock let the candidate through. The plugin must agree on the parts,
 *      not only on the final boolean — a tool that "explains" a rejection by
 *      guessing would pass layer 1 and fail layer 2.
 *
 * @module dsh-semver/test
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { explainRange, parseVersion } from '../src/semver.ts'
import { buildSemverTools } from '../src/tools.ts'
import { resolveConfig } from '../src/index.ts'

interface ExplainSetAnchor {
  label: string
  comparators: [string, boolean][]
  prereleaseAllowed: boolean
  pinnedTuple: string | null
}

interface Anchors {
  oracle: { name: string; version: string }
  satisfies: [string, string, boolean][]
  explain: [string, string, boolean, ExplainSetAnchor[]][]
}

const anchors = JSON.parse(
  readFileSync(fileURLToPath(new URL('./anchors/range-algebra.json', import.meta.url)), 'utf8'),
) as Anchors

const tools = buildSemverTools(resolveConfig({}))

function explain(version: string, range: string, includePrerelease = false) {
  const parsed = parseVersion(version)
  if (!parsed.ok) throw new Error(`fixture version ${version} failed to parse: ${parsed.reason}`)
  const result = explainRange(parsed.value, range, includePrerelease)
  if (!result.ok) throw new Error(`fixture range ${range} failed to parse: ${result.reason}`)
  return result.value
}

describe('semver_explain — corpus sweep against npm Range.test', () => {
  it('agrees with npm on all anchored (range, version) pairs', () => {
    expect(anchors.satisfies.length).toBeGreaterThan(0)
    for (const [range, version, expected] of anchors.satisfies) {
      const value = explain(version, range)
      expect(`${version} @ ${JSON.stringify(range)} → ${value.satisfied}`).toBe(
        `${version} @ ${JSON.stringify(range)} → ${expected}`,
      )
    }
  })
})

describe('semver_explain — structural anchors from npm Comparator.test', () => {
  it('has an explain region with both rejection kinds in it', () => {
    expect(anchors.explain.length).toBeGreaterThan(0)
    expect(anchors.explain.some(([version, range, satisfied, sets]) =>
      !satisfied && sets.some((set) => !set.prereleaseAllowed && set.comparators.every(([, ok]) => ok)))).toBe(true)
    expect(anchors.explain.some(([, , , sets]) => sets.length > 1)).toBe(true)
    expect(anchors.explain.some(([version]) => version.includes('-'))).toBe(true)
  })

  for (const [version, range, satisfied, sets] of anchors.explain) {
    it(`explains ${version} against ${JSON.stringify(range)} the way npm does`, () => {
      const value = explain(version, range)
      expect(value.satisfied).toBe(satisfied)
      expect(value.sets.length).toBe(sets.length)
      value.sets.forEach((set, index) => {
        const anchor = sets[index] as ExplainSetAnchor
        expect(set.label).toBe(anchor.label)
        // Per-comparator truth, including the precedence that decided it.
        expect(set.comparators.map((c) => c.comparator)).toEqual(anchor.comparators.map(([label]) => label))
        expect(set.comparators.map((c) => c.ok)).toEqual(anchor.comparators.map(([, ok]) => ok))
        expect(set.rejectedBy).toEqual(anchor.comparators.filter(([, ok]) => !ok).map(([label]) => label))
        expect(set.prereleaseAllowed).toBe(anchor.prereleaseAllowed)
        expect(set.pinnedTuple).toBe(anchor.pinnedTuple)
        // A set passes exactly when every comparator passes AND the lock allows it.
        expect(set.ok).toBe(anchor.prereleaseAllowed && anchor.comparators.every(([, ok]) => ok))
      })
      expect(value.normalized).toBe(sets.map((set) => set.label).join(' || '))
      expect(value.because.length).toBeGreaterThan(0)
    })
  }
})

describe('semver_explain — the distinction the tool exists for', () => {
  it('names the tuple-lock when every comparator passes but the candidate is a prerelease', () => {
    const value = explain('1.2.3-beta.1', '>=1.0.0')
    expect(value.satisfied).toBe(false)
    expect(value.sets[0]?.rejectedBy).toEqual([])
    expect(value.sets[0]?.tupleLockActive).toBe(true)
    expect(value.sets[0]?.prereleaseAllowed).toBe(false)
    expect(value.because).toContain('prerelease rule')
  })

  it('names the missed bound when a stable version is simply too old', () => {
    const value = explain('1.2.0', '^1.2.3')
    expect(value.satisfied).toBe(false)
    expect(value.sets[0]?.tupleLockActive).toBe(false)
    expect(value.because).toContain('rejects 1 of 2 comparators')
  })

  it('lets the prerelease through when a comparator pins its own tuple', () => {
    const value = explain('1.2.3-beta.1', '>=1.2.3-0')
    expect(value.satisfied).toBe(true)
    expect(value.sets[0]?.pinnedTuple).toBe('1.2.3')
  })

  it('reports the closest of several OR alternatives', () => {
    const value = explain('2.0.0', '^1.0.0 || ^3.0.0')
    expect(value.satisfied).toBe(false)
    expect(value.sets.length).toBe(2)
    expect(value.because).toContain('closest alternative')
  })

  it('honours includePrerelease as a switch, not as a guess', () => {
    expect(explain('1.2.3-beta.1', '>=1.0.0').satisfied).toBe(false)
    const relaxed = explain('1.2.3-beta.1', '>=1.0.0', true)
    expect(relaxed.satisfied).toBe(true)
    expect(relaxed.sets[0]?.tupleLockActive).toBe(false)
  })
})

describe('semver_explain tool surface', () => {
  it('returns a lossless JSON result for the tuple-lock case', async () => {
    const out = await tools.semver_explain.execute({ version: '1.2.3-beta.1', range: '>=1.0.0' })
    expect(out.valid).toBe(true)
    expect(out.satisfied).toBe(false)
    expect(out.setCount).toBe(1)
    const set = out.sets[0] as { rejectedBy: string[]; tupleLockActive: boolean; comparators: string[] }
    expect(set.rejectedBy).toEqual([])
    expect(set.tupleLockActive).toBe(true)
    expect(set.comparators).toEqual(['>=1.0.0 → accepted (candidate is greater than 1.0.0)'])
    // No undefined active keys: what a strict JSON round-trip would drop.
    expect(JSON.parse(JSON.stringify(out))).toEqual(out)
  })

  it('keeps a failing alternative honest about how many comparators rejected', async () => {
    const out = await tools.semver_explain.execute({ version: '0.2.1-rc.2', range: '>=0.2.1-rc.3 <0.3.0-0' })
    expect(out.valid).toBe(true)
    expect(out.satisfied).toBe(false)
    const set = out.sets[0] as { rejectedBy: string[] }
    expect(set.rejectedBy).toEqual(['>=0.2.1-rc.3'])
    expect(out.because).toContain('0.2.1-rc.2 is lower than 0.2.1-rc.3')
  })

  it('renders the explanation instead of a bare verdict', () => {
    const definition = tools.semver_explain as unknown as {
      output: { render: (args: unknown, value: unknown) => { text: string }[] }
    }
    const value = {
      valid: true,
      version: '1.2.3-beta.1',
      range: '>=1.0.0',
      satisfied: false,
      because: 'tuple-lock',
      sets: [{ label: '>=1.0.0', ok: false, rejectedBy: [], comparators: ['>=1.0.0 → accepted'] }],
    }
    const text = definition.output.render({ version: '1.2.3-beta.1', range: '>=1.0.0' }, value)[0]?.text ?? ''
    expect(text).toContain('does NOT satisfy')
    expect(text).toContain('tuple-lock rejected the candidate')
  })

  it('rejects an unparsable version and an empty range without inventing an explanation', async () => {
    const badVersion = await tools.semver_explain.execute({ version: 'not-a-version', range: '^1.0.0' })
    expect(badVersion.valid).toBe(false)
    expect(badVersion.reason).toBeTruthy()
    const badRange = await tools.semver_explain.execute({ version: '1.2.3', range: '   ' })
    expect(badRange.valid).toBe(false)
    expect(badRange.reason).toBeTruthy()
  })
})
