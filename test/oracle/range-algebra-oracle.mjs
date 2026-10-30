#!/usr/bin/env node
/**
 * Anchor oracle for dsh-semver — runs against **npm's own semver package** (the
 * independent reference implementation), never against this plugin's code.
 *
 *   node test/oracle/range-algebra-oracle.mjs             # print every anchor (human-readable run)
 *   node test/oracle/range-algebra-oracle.mjs --write     # regenerate test/anchors/range-algebra.json
 *   node test/oracle/range-algebra-oracle.mjs --check     # self-check: re-derive, compare, invariants
 *   node test/oracle/range-algebra-oracle.mjs [path/to/node_modules/semver]
 *
 * The committed test/anchors/range-algebra.json IS this script's output, so no
 * expectation in the test suite is hand-written (the v0.2.x `~1.2.3` bug
 * survived precisely because its expectation was chosen by hand).
 *
 * Why --check exists: `tools/oracle-anchors.py` runs `<oracle> --check` as a
 * gate, because "the marker points at a script that exists" says nothing about
 * whether the anchors in it are still true. This self-check has two tiers —
 * with npm semver resolvable it re-derives every anchor and requires byte
 * equality with the committed file; without it, it still verifies structure and
 * the internal invariants that must hold for any correct oracle output (and
 * says which tier ran).
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const ANCHORS_PATH = join(here, '..', 'anchors', 'range-algebra.json')

const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--')))
const positional = args.filter((a) => !a.startsWith('--'))

/** Locate npm's semver: explicit path → $SEMVER_ORACLE → /tmp scratch → repo → npm's own bundles → resolvable. */
function resolveOracle() {
  const candidates = []
  if (positional[0]) candidates.push(positional[0])
  if (process.env.SEMVER_ORACLE) candidates.push(process.env.SEMVER_ORACLE)
  candidates.push('/tmp/semver-oracle/node_modules/semver')
  candidates.push(join(here, '..', '..', 'node_modules', 'semver'))
  // npm ships semver itself, so any npm installation is a usable oracle. Look
  // next to the running node, at the global npm prefix, and in the toolchain
  // roots this project's machines use.
  const prefixRoots = [
    join(homedir(), '.hermes', 'node', 'lib', 'node_modules'),
    join(dirname(dirname(process.execPath)), 'lib', 'node_modules'),
    '/usr/lib/node_modules',
    '/usr/local/lib/node_modules',
  ]
  try {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    if (globalRoot) prefixRoots.unshift(globalRoot)
  } catch {
    // npm not on PATH — the fixed roots above still apply
  }
  for (const root of prefixRoots) {
    candidates.push(join(root, 'npm', 'node_modules', 'semver'))
    candidates.push(join(root, 'semver'))
  }
  try {
    candidates.push(require.resolve('semver'))
  } catch {
    // not resolvable from here
  }
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      return { root: candidate, semver: require(candidate) }
    } catch {
      // try the next candidate
    }
  }
  return null
}

/** Every range form the plugin claims to parse, plus the npm boundary cases. */
const RANGES = [
  '*', '1.x', '1.2.x', '1', '1.2', '=1.2.3', '1.2.3',
  '^1.2.3', '^1', '^0.2.3', '^0.0.3', '^0', '^0.0', '^0.0.0',
  '~1.2.3', '~1.2', '~1', '~0.2.3', '~0.0.3',
  '>1.2.3', '>=1.2.3', '<1.2.3', '<=1.2.3',
  '>1.2', '<1.3', '<=1.2', '>1', '<=1', '<1', '>=1', '>=1.2',
  '>1.2.x', '<=1.2.x', '>=1.2.x', '<1.2.x', '>*', '<=*', '>=*',
  '>=1.2.0 <2.0.0', '>=1.2.0 <1.3.0', '>=1.0.0 <1.0.0', '>=2.0.0 <2.0.1', '>2.0.0 <=2.0.1', '>2.0.0 <2.0.1',
  '1.2.3 - 2.3.4', '1.2 - 2.3', '1.2.3 - 2.3', '1 - 2',
  '^1.0.0 || ^2.0.0', '^1.0.0 || ^3.0.0', '>=1.0.0 <2.0.0 || >=3.0.0',
  '>=1.9.0 <2.0.0', '<0.1.0', '>=0.0.1',
]

/** Versions used for the matcher (satisfies) sweep. */
const VERSIONS = [
  '0.0.0', '0.0.0-0', '0.0.1', '0.1.0', '0.2.3', '0.2.4', '1.0.0', '1.2.0', '1.2.1',
  '1.2.3', '1.2.4', '1.3.0', '2.0.0', '1.2.3-beta.1', '2.0.0-0', '1.2.3+build.5',
]

/** Ordered pairs taken from the first N ranges (npm.intersects is symmetric, one direction is enough). */
const PAIR_RANGES = RANGES.slice(0, 20)

/** Texts handed to npm semver.coerce — realistic mess first, then the boundaries. */
const COERCE_INPUTS = [
  'node v18.16.1', 'v1.2.3', '1.2.3', '42', '1.2', 'release-1.2', 'version 1.2.3-beta.1',
  '1.2.3-beta.1+build.9', '1.2.3.4', '9.8.7.6.5', '1.2.3.4-beta', 'abc1.2.3def', '  2.0  ',
  'V3.4', 'v2', 'x.y.z', 'no version here', '', '1.2.3-', '-1.2.3', '1.2.3+b', '0.0.0',
  'changelog 2026-10-12: 4.5.6 released', 'v0', '10.20.30.40', 'sha 4b825dc642cb6eb9a060e54bf8d69288fbee4904',
]

/** Inputs whose first number run is beyond what npm can represent (> MAX_SAFE_INTEGER). */
const COERCE_UNREPRESENTABLE_INPUTS = ['v9999999999999999', '9999999999999999.1.1']

/**
 * Pairs whose *explanation* is anchored (v0.5.0 `semver_explain`): the point of
 * the tool is the distinction between "a bound was missed" and "the prerelease
 * tuple-lock rejected it", so the corpus has to contain both, plus OR
 * alternatives and a hyphen range.
 */
const EXPLAIN_CASES = [
  ['1.2.3-beta.1', '>=1.0.0'],
  ['1.2.3-beta.1', '>=1.2.3-0'],
  ['1.2.3', '^1.2.3'],
  ['1.2.0', '^1.2.3'],
  ['0.2.1-rc.2', '>=0.2.1-rc.3 <0.3.0-0'],
  ['2.0.0', '^1.0.0 || ^3.0.0'],
  ['2.0.0', '^1.0.0 || ^2.0.0'],
  ['2.0.0-0', '^1.0.0 || ^2.0.0'],
  ['1.2.3+build.5', '1.2.3 - 2.3.4'],
  ['0.0.0-0', '>=0.0.1'],
  ['1.2.4', '>1.2.3 <1.2.4'],
]

function deriveAnchors(semver, oracleVersion) {
  const minVersions = {}
  for (const range of RANGES) {
    const min = semver.minVersion(range)
    minVersions[range] = min === null ? null : min.version
  }

  const intersects = {}
  for (const a of PAIR_RANGES) {
    for (const b of PAIR_RANGES) intersects[`${a}\u0000${b}`] = semver.intersects(a, b)
  }

  const satisfies = []
  for (const range of RANGES) {
    const parsed = new semver.Range(range)
    for (const version of VERSIONS) satisfies.push([range, version, parsed.test(version)])
  }

  // npm's own comparator shape per range: what outside()/gtr()/ltr() actually
  // walk. Anchoring it means the port can be compared structurally, not only
  // through verdicts ("1.2.3" → bare "1.2.3", "^1.2.3" → ">=1.2.3 <2.0.0-0").
  const rangeSets = {}
  for (const range of RANGES) {
    rangeSets[range] = new semver.Range(range).set.map((set) =>
      set.map((c) => (c.semver === semver.Comparator.ANY ? 'ANY' : `${c.operator}${c.semver.version}`)),
    )
  }

  const coerce = []
  for (const input of [...COERCE_INPUTS, ...COERCE_UNREPRESENTABLE_INPUTS]) {
    const result = semver.coerce(input)
    coerce.push([input, result === null ? null : result.version])
  }

  const outside = []
  for (const range of RANGES) {
    for (const version of VERSIONS) {
      outside.push([range, version, semver.gtr(version, range), semver.ltr(version, range)])
    }
  }

  // v0.5.0: the explanation anchors. Comparator verdicts come from npm's own
  // Comparator.test (which applies NO prerelease rule), and the tuple-lock is
  // derived from npm's comparator objects — so `satisfied` here is npm's
  // Range.test and the per-comparator truth is npm's, independently of how the
  // plugin splits the two. Labels are sorted so both sides read one order.
  const explain = []
  for (const [version, range] of EXPLAIN_CASES) {
    const candidate = new semver.SemVer(version)
    const tuple = `${candidate.major}.${candidate.minor}.${candidate.patch}`
    const parsedRange = new semver.Range(range)
    const sets = parsedRange.set.map((comparators) => {
      const verdicts = []
      let pinnedTuple = null
      for (const comparator of comparators) {
        if (comparator.semver === semver.Comparator.ANY) continue
        const label = `${comparator.operator}${comparator.semver.version}`
        verdicts.push([label, comparator.test(version)])
        const sameTuple = `${comparator.semver.major}.${comparator.semver.minor}.${comparator.semver.patch}` === tuple
        if (sameTuple && comparator.semver.prerelease.length > 0 && pinnedTuple === null) pinnedTuple = tuple
      }
      verdicts.sort((a, b) => (a[0] < b[0] ? -1 : 1))
      return {
        label: verdicts.length === 0 ? '*' : verdicts.map(([label]) => label).join(' '),
        comparators: verdicts,
        prereleaseAllowed: candidate.prerelease.length === 0 || pinnedTuple !== null,
        pinnedTuple,
      }
    })
    explain.push([version, range, parsedRange.test(version), sets])
  }

  return {
    oracle: { name: 'semver', version: oracleVersion, source: 'npm semver (independent reference implementation)' },
    corpus: {
      rangeCount: RANGES.length,
      pairRangeCount: PAIR_RANGES.length,
      versionCount: VERSIONS.length,
      coerceCount: coerce.length,
      outsideCount: outside.length,
      explainCount: explain.length,
    },
    minVersions,
    rangeSets,
    intersects,
    satisfies,
    coerce,
    outside,
    explain,
  }
}

function printAnchors(anchors) {
  console.log(`# oracle: npm semver ${anchors.oracle.version} (${anchors.oracle.source})`)
  for (const [range, min] of Object.entries(anchors.minVersions)) {
    console.log(`minVersion ${JSON.stringify(range)} -> ${min === null ? 'null' : min}`)
  }
  for (const [range, sets] of Object.entries(anchors.rangeSets)) {
    console.log(`rangeSet ${JSON.stringify(range)} -> ${sets.map((set) => set.join(' ')).join(' || ')}`)
  }
  for (const [key, value] of Object.entries(anchors.intersects)) {
    const [a, b] = key.split('\u0000')
    console.log(`intersects ${JSON.stringify(a)} ${JSON.stringify(b)} -> ${value}`)
  }
  for (const [range, version, value] of anchors.satisfies) {
    console.log(`satisfies ${JSON.stringify(version)} ${JSON.stringify(range)} -> ${value}`)
  }
  for (const [input, value] of anchors.coerce) {
    console.log(`coerce ${JSON.stringify(input)} -> ${value === null ? 'null (npm finds no representable version)' : value}`)
  }
  for (const [range, version, above, below] of anchors.outside) {
    console.log(`outside ${JSON.stringify(version)} ${JSON.stringify(range)} -> above=${above} below=${below}`)
  }
  for (const [version, range, satisfied, sets] of anchors.explain) {
    const shapes = sets
      .map((set) => `${set.label}${set.prereleaseAllowed ? '' : ' [tuple-lock]'}${set.comparators.every(([, ok]) => ok) ? '' : ' [bound missed]'}`)
      .join(' || ')
    console.log(`explain ${JSON.stringify(version)} ${JSON.stringify(range)} -> satisfied=${satisfied} ${shapes}`)
  }
  console.log(`# corpus: ${JSON.stringify(anchors.corpus)}`)
}

/** Invariants that must hold for any correct oracle output — checked without npm too. */
function invariantProblems(anchors) {
  const problems = []
  const satisfied = new Set(anchors.satisfies.filter(([, , value]) => value).map(([range, version]) => `${range}\u0000${version}`))
  const nonNullMin = Object.values(anchors.minVersions).filter((m) => m !== null)
  if (nonNullMin.length === 0) problems.push('minVersions: every range reports null — the corpus proves nothing')
  if (new Set(Object.values(anchors.intersects)).size < 2) problems.push('intersects: the corpus only contains one outcome')
  if (new Set(anchors.satisfies.map(([, , value]) => value)).size < 2) problems.push('satisfies: the corpus only contains one outcome')
  const versionPattern = /^\d+\.\d+\.\d+$/
  const emptyInput = anchors.coerce.find(([input]) => input === '')
  if (!emptyInput || emptyInput[1] !== null) problems.push('coerce("") must be recorded as null')
  if (!anchors.coerce.some(([, value]) => value === null)) problems.push('coerce: no null outcome in the corpus')
  for (const [input, value] of anchors.coerce) {
    if (value === null) continue
    if (!versionPattern.test(value)) {
      problems.push(`coerce(${JSON.stringify(input)}) = ${value} is not a MAJOR.MINOR.PATCH string`)
    }
  }
  // The comparator shape is what outside() walks: every range needs a non-empty
  // set, and an exact version must stay a *bare* comparator (npm semantics).
  for (const [range, sets] of Object.entries(anchors.rangeSets)) {
    if (sets.length === 0 || sets.some((set) => set.length === 0)) {
      problems.push(`rangeSets: ${JSON.stringify(range)} has an empty AND-set (npm never returns one)`)
    }
  }
  if ((anchors.rangeSets['1.2.3'] ?? []).flat().join(' ') !== '1.2.3') {
    problems.push('rangeSets: an exact version must be a bare comparator ("1.2.3"), which is what npm reports')
  }
  if ((anchors.rangeSets['^1.2.3'] ?? []).flat().join(' ') !== '>=1.2.3 <2.0.0-0') {
    problems.push('rangeSets: npm compiles ^1.2.3 to ">=1.2.3 <2.0.0-0" (the -0 upper bound is load-bearing)')
  }
  // All four npm outcomes must appear, otherwise the corpus cannot discriminate.
  const outcomes = new Set()
  for (const [range, version, above, below] of anchors.outside) {
    const isSatisfied = satisfied.has(`${range}\u0000${version}`)
    if (above && isSatisfied) problems.push(`outside: ${version} @ ${range} is above the range yet satisfies it`)
    if (below && isSatisfied) problems.push(`outside: ${version} @ ${range} is below the range yet satisfies it`)
    // npm's outside() really can report both directions for one version: a
    // prerelease never satisfies a plain range (tuple-lock), so both "above
    // everything" and "below everything" come back true. Verified over the
    // whole corpus: that only ever happens for a prerelease, so anything else
    // is a real defect.
    if (above && below && !version.includes('-')) {
      problems.push(`outside: ${version} @ ${range} is reported both above and below without being a prerelease`)
    }
    outcomes.add(isSatisfied ? 'inside' : above && below ? 'gap' : above ? 'above' : below ? 'below' : 'gap')
  }
  for (const expected of ['inside', 'above', 'below', 'gap']) {
    if (!outcomes.has(expected)) problems.push(`outside: the corpus never produces the "${expected}" outcome`)
  }
  for (const [key, value] of Object.entries(anchors.intersects)) {
    const [a, b] = key.split('\u0000')
    const reverse = anchors.intersects[`${b}\u0000${a}`]
    if (reverse !== undefined && reverse !== value) {
      problems.push(`intersects: ${a} ∩ ${b} = ${value} but ${b} ∩ ${a} = ${reverse} (not symmetric)`)
    }
  }
  // The explanation model must reproduce npm's verdict from its own parts:
  // satisfied ⟺ some alternative has every comparator passing AND the
  // prerelease rule letting the candidate through. If npm ever disagrees, the
  // split this tool exposes would be a fiction.
  let lockOnlyRejections = 0
  let multiSetCases = 0
  for (const [version, range, satisfied, sets] of anchors.explain) {
    if (sets.length > 1) multiSetCases += 1
    const predicted = sets.some((set) => set.prereleaseAllowed && set.comparators.every(([, ok]) => ok))
    if (predicted !== satisfied) {
      problems.push(`explain: ${version} @ ${JSON.stringify(range)} — comparator verdicts + tuple-lock predict ${predicted}, npm says ${satisfied}`)
    }
    if (!satisfied && sets.some((set) => !set.prereleaseAllowed && set.comparators.every(([, ok]) => ok))) {
      lockOnlyRejections += 1
    }
    const tupleLockSeen = new Set()
    for (const set of sets) {
      const key = set.pinnedTuple
      if (key !== null && tupleLockSeen.has(key)) problems.push(`explain: ${version} @ ${JSON.stringify(range)} pins ${key} twice`)
      if (key !== null) tupleLockSeen.add(key)
    }
  }
  if (lockOnlyRejections === 0) {
    problems.push('explain: the corpus never contains a rejection where every comparator passes (the tuple-lock distinction is the whole tool)')
  }
  if (multiSetCases === 0) problems.push('explain: the corpus never contains an OR alternative')
  return problems
}

function main() {
  const resolved = resolveOracle()
  if (!resolved) {
    console.error('cannot find npm semver (pass a path, or `npm i semver@7` into /tmp/semver-oracle)')
    return 1
  }
  const oracleVersion = require(join(resolved.root, 'package.json')).version

  if (flags.has('--check')) {
    let committed
    try {
      committed = JSON.parse(readFileSync(ANCHORS_PATH, 'utf8'))
    } catch (error) {
      console.error(`--check: cannot read ${ANCHORS_PATH}: ${error.message}`)
      return 1
    }
    if (committed.oracle?.version !== oracleVersion) {
      console.error(`--check: anchors were generated by npm semver ${committed.oracle?.version}, oracle here is ${oracleVersion}`)
      return 1
    }
    const fresh = deriveAnchors(resolved.semver, oracleVersion)
    const problems = invariantProblems(committed)
    if (JSON.stringify(fresh) !== JSON.stringify(committed)) {
      const sections = Object.keys(fresh)
      const drifted = sections.filter((s) => JSON.stringify(fresh[s]) !== JSON.stringify(committed[s]))
      problems.push(`anchors differ from a fresh npm derivation (sections: ${drifted.join(', ')}) — run --write if npm changed, otherwise the committed file was edited by hand`)
    }
    if (problems.length > 0) {
      for (const problem of problems) console.error(`❌ ${problem}`)
      return 1
    }
    console.log(`✅ self-check: ${Object.keys(committed.minVersions).length} minVersion, ${Object.keys(committed.intersects).length} intersects, ${committed.satisfies.length} satisfies, ${committed.coerce.length} coerce, ${committed.outside.length} outside, ${committed.explain.length} explain anchors re-derived from npm semver ${oracleVersion} and byte-identical`)
    return 0
  }

  const anchors = deriveAnchors(resolved.semver, oracleVersion)
  if (flags.has('--write')) {
    writeFileSync(ANCHORS_PATH, `${JSON.stringify(anchors, null, 1)}\n`)
    console.log(`wrote ${ANCHORS_PATH} — oracle semver ${anchors.oracle.version}`)
    console.log(`ranges ${RANGES.length}, pairs ${Object.keys(anchors.intersects).length}, satisfies cases ${anchors.satisfies.length}, coerce cases ${anchors.coerce.length}, outside cases ${anchors.outside.length}`)
    const problems = invariantProblems(anchors)
    if (problems.length > 0) {
      for (const problem of problems) console.error(`❌ ${problem}`)
      return 1
    }
    return 0
  }

  printAnchors(anchors)
  const problems = invariantProblems(anchors)
  if (problems.length > 0) {
    for (const problem of problems) console.error(`❌ ${problem}`)
    return 1
  }
  return 0
}

process.exit(main())
