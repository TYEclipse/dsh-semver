#!/usr/bin/env node
/**
 * Anchor generator for the v0.3.0 range-algebra tools — runs against **npm's own
 * semver package** (the independent oracle), never against this plugin's code.
 *
 *   mkdir -p /tmp/semver-oracle && cd /tmp/semver-oracle && npm i semver@7
 *   node test/oracle/range-algebra-oracle.mjs            # uses /tmp/semver-oracle/node_modules/semver
 *   node test/oracle/range-algebra-oracle.mjs /path/to/node_modules/semver
 *
 * Writes test/anchors/range-algebra.json. The committed file is the oracle
 * output, so the test expectations are never hand-written (the ~1.2.3 bug of
 * v0.2.x survived precisely because its expectation was chosen by hand).
 */
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const oracleRoot = process.argv[2] ?? '/tmp/semver-oracle/node_modules/semver'
const semver = require(oracleRoot)

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

const anchors = {
  oracle: { name: 'semver', version: require(join(oracleRoot, 'package.json')).version, source: 'npm semver (independent reference implementation)' },
  corpus: { rangeCount: RANGES.length, pairRangeCount: PAIR_RANGES.length, versionCount: VERSIONS.length },
  minVersions,
  intersects,
  satisfies,
}

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, '..', 'anchors', 'range-algebra.json')
writeFileSync(out, `${JSON.stringify(anchors, null, 1)}\n`)
console.log(`wrote ${out} — oracle semver ${anchors.oracle.version}`)
console.log(`ranges ${RANGES.length}, pairs ${Object.keys(intersects).length}, satisfies cases ${satisfies.length}`)
