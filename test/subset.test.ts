/**
 * v0.6.0 `semver_subset` tests — the whole containment matrix is anchored to npm.
 *
 * ORACLE: test/oracle/range-algebra-oracle.mjs
 *
 * The expectations are **not** `semver.subset()`'s: npm's implementation answers
 * false for genuine subsets (it compares comparator bounds instead of the
 * accepted sets — `subset('>=2.0.0 <3.0.0', '^2')` is false although both accept
 * exactly the same releases). The oracle instead asks npm's own `Range.test`
 * over a probe lattice built from every endpoint either range mentions
 * (`buildSubsetProbes`), so each expectation is still npm's verdict on a
 * concrete version — "does any probe satisfy one range and not the other" —
 * while the answer stays the set answer. `npmSubset` is committed next to it, so
 * the divergence is a measured fact and not a claim in a comment.
 *
 * @module dsh-semver/test
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { rangeSubset, satisfiesRange, parseVersion } from '../src/semver.ts'
import { buildSemverTools } from '../src/tools.ts'
import { resolveConfig } from '../src/index.ts'

interface SubsetAnchor {
  ranges: string[]
  probes: string[]
  verdicts: boolean[]
  witnesses: (string | null)[]
  npmSubset: boolean[]
}

interface Anchors {
  oracle: { name: string; version: string }
  subset: SubsetAnchor
}

const anchors = JSON.parse(
  readFileSync(fileURLToPath(new URL('./anchors/range-algebra.json', import.meta.url)), 'utf8'),
) as Anchors

const tools = buildSemverTools(resolveConfig({}))
const n = anchors.subset.ranges.length

function satisfies(version: string, range: string): boolean {
  const parsed = parseVersion(version)
  if (!parsed.ok) throw new Error(`fixture version ${version} failed to parse: ${parsed.reason}`)
  const result = satisfiesRange(parsed.value, range)
  if (!result.ok) throw new Error(`fixture range ${range} failed to parse: ${result.reason}`)
  return result.satisfied
}

describe('semver_subset — containment matrix against npm Range.test over the probe lattice', () => {
  it('agrees with the oracle on every ordered pair', () => {
    expect(n).toBeGreaterThan(20)
    const mismatch: string[] = []
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        const k = i * n + j
        const result = rangeSubset(anchors.subset.ranges[i] as string, anchors.subset.ranges[j] as string)
        if (!result.ok) {
          mismatch.push(`${anchors.subset.ranges[i]} ⊆ ${anchors.subset.ranges[j]}: ${result.reason}`)
          continue
        }
        if (result.value.subset !== anchors.subset.verdicts[k]) {
          mismatch.push(
            `${anchors.subset.ranges[i]} ⊆ ${anchors.subset.ranges[j]}: got ${result.value.subset}, npm's probes say ${anchors.subset.verdicts[k]}`,
          )
        }
      }
    }
    expect(mismatch).toEqual([])
  })

  it('gives a witness that npm would agree with on every "not a subset" pair', () => {
    let checked = 0
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        const k = i * n + j
        if (anchors.subset.verdicts[k]) continue
        const sub = anchors.subset.ranges[i] as string
        const dom = anchors.subset.ranges[j] as string
        const result = rangeSubset(sub, dom)
        expect(result.ok).toBe(true)
        if (!result.ok) continue
        const witness = result.value.witness
        expect(witness).not.toBeNull()
        // The witness is re-checked through the matcher, i.e. the same code path
        // npm parity is tested against — a witness that only satisfies the
        // interval arithmetic would be worthless.
        expect(`${sub} accepts ${String(witness)}: ${satisfies(String(witness), sub)}`).toBe(`${sub} accepts ${String(witness)}: true`)
        expect(`${dom} accepts ${String(witness)}: ${satisfies(String(witness), dom)}`).toBe(`${dom} accepts ${String(witness)}: false`)
        checked += 1
      }
    }
    expect(checked).toBeGreaterThan(100)
  })

  it('reports reflexivity for every range in the corpus', () => {
    for (let i = 0; i < n; i += 1) {
      const range = anchors.subset.ranges[i] as string
      const result = rangeSubset(range, range)
      expect(`${range} ⊆ ${range}: ${result.ok && result.value.subset}`).toBe(`${range} ⊆ ${range}: true`)
    }
  })

  it('keeps the documented npm divergence real (not a stale comment)', () => {
    const index = anchors.subset.ranges.indexOf('>=2.0.0 <3.0.0')
    const dom = anchors.subset.ranges.indexOf('^2')
    expect(index).toBeGreaterThanOrEqual(0)
    expect(dom).toBeGreaterThanOrEqual(0)
    const k = index * n + dom
    // Both ranges accept exactly the same versions...
    const mine = rangeSubset('>=2.0.0 <3.0.0', '^2')
    expect(mine.ok && mine.value.subset).toBe(true)
    // ...while npm's own subset() says otherwise. If a future npm release fixes
    // this, the anchor flips and this assertion is what tells us to update the
    // tool description with it.
    expect(anchors.subset.npmSubset[k]).toBe(false)
  })
})

describe('semver_subset — the cases worth naming', () => {
  const cases: [string, string, boolean, boolean][] = [
    // sub, dom, subset, emptySubset
    ['^1.2.0', '^1.0.0', true, false], // tightening inside a major is safe
    ['^1.0.0', '^1.2.0', false, false], // and loosening is not
    ['1.2.3', '^1.2.3', true, false],
    ['^1.2.3', '1.2.3', false, false],
    ['<0.0.0-0', '^1.0.0', true, true], // nothing satisfies a sub-zero range
    ['>1.0.0 <1.0.1', '1.0.0', true, true], // one-element gap: no release, and 1.0.1-0 is tuple-locked out
    ['1.2.3-beta', '>=1.2.3-0 <1.2.4', true, false], // dom pins the tuple, so the prerelease is allowed
    ['^1.2.3-beta', '^1.2.3', false, false], // sub admits 1.2.3-beta, dom never admits a prerelease
    ['^1.2.3', '^1.2.3-beta', true, false], // the reverse holds: tighter prerelease pin, same releases
    ['>=1.0.0', '^1.0.0 || ^2.0.0', false, false], // the 3.x branch is the gap
    ['^1.0.0 || ^2.0.0', '>=1.0.0', true, false],
    ['1.x', '>=1.0.0 <2.0.0', true, false],
    ['~1.2.3', '^1.2.0', true, false],
    // Two alternatives pinning the SAME tuple: their prerelease spans must be
    // unioned, not silently dropped after the first one.
    ['>=1.2.3-beta <1.2.4 || >=1.2.3-rc <1.2.4', '>=1.2.3-0 <1.2.4', true, false],
  ]

  it.each(cases)('%s ⊆ %s is %s', (sub, dom, subset, emptySubset) => {
    const result = rangeSubset(sub, dom)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.subset).toBe(subset)
    expect(result.value.emptySubset).toBe(emptySubset)
    expect(result.value.witness === null).toBe(subset)
  })

  it('exposes the normalized comparator sets on both sides', () => {
    const result = rangeSubset('^1.2.3', '>=1.0.0 <2.0.0')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.subSets).toEqual(['<2.0.0 >=1.2.3'])
    expect(result.value.domSets).toEqual(['<2.0.0 >=1.0.0'])
  })

  it('rejects an unparsable range instead of answering', () => {
    const result = rangeSubset('not a range', '^1.0.0')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('invalid range')
  })
})

describe('semver_subset tool surface', () => {
  it('omits witness when the answer is yes (absent, not null)', async () => {
    const out = await tools.semver_subset.execute({ sub: '^1.2.0', dom: '^1.0.0' })
    expect(out.valid).toBe(true)
    expect(out.subset).toBe(true)
    expect('witness' in out).toBe(false)
    expect(JSON.stringify(out)).not.toContain('undefined')
  })

  it('returns the witness when the answer is no', async () => {
    const out = await tools.semver_subset.execute({ sub: '^1.0.0', dom: '^1.2.3' })
    expect(out.valid).toBe(true)
    expect(out.subset).toBe(false)
    expect(typeof out.witness).toBe('string')
    expect(satisfies(String(out.witness), '^1.0.0')).toBe(true)
    expect(satisfies(String(out.witness), '^1.2.3')).toBe(false)
    expect(JSON.stringify(out)).not.toContain('undefined')
  })

  it('renders the verdict in words the model can use', async () => {
    const render = tools.semver_subset.output.render as unknown as (args: { sub: string; dom: string }, value: unknown) => { text: string }[]
    const yesValue = await tools.semver_subset.execute({ sub: '^1.2.0', dom: '^1.0.0' })
    const noValue = await tools.semver_subset.execute({ sub: '^1.0.0', dom: '^1.2.3' })
    const yesText = render({ sub: '^1.2.0', dom: '^1.0.0' }, yesValue)[0]?.text ?? ''
    const noText = render({ sub: '^1.0.0', dom: '^1.2.3' }, noValue)[0]?.text ?? ''
    expect(yesText).toContain('accepted by')
    expect(noText).toContain('rejects')
  })
})
