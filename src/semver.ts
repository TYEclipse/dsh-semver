/**
 * dsh-semver — semantic versioning toolbox for DeepSeek Harness.
 *
 * Six deterministic tools, zero runtime dependencies (pure logic):
 *   semver_parse      — parse a version string into major/minor/patch/prerelease/build
 *   semver_compare    — compare two versions (lt / eq / gt) with a human verdict
 *   semver_satisfies  — check a version against an npm-style range (^ ~ >= <= > < = x-ranges, hyphen, ||, AND)
 *   semver_inc        — increment a version (major/minor/premajor/... with prerelease identifier)
 *   semver_diff       — release-type difference between two versions
 *   semver_sort       — sort a list of versions by precedence (build-metadata tie-break)
 *
 * Semantics follow the Semantic Versioning 2.0.0 spec and npm's range behavior:
 * prerelease identifiers sort numerically before alphanumerically, build metadata
 * is ignored for precedence, and ranges with a prerelease lower bound only match
 * prereleases of the same [major, minor, patch] tuple (npm's tuple-lock rule).
 *
 * @module dsh-semver
 */

/** A parsed semver 2.0.0 version. */
export interface ParsedVersion {
  major: number
  minor: number
  patch: number
  /** Prerelease identifiers (e.g. ["beta", "2"]), or null when absent. */
  prerelease: readonly string[] | null
  /** Build metadata identifiers (e.g. ["build", "5"]), or null when absent. */
  build: readonly string[] | null
}

const VERSION_RE =
  /^[v=]?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

const IDENT_RE = /^[0-9A-Za-z-]+$/

function leadingZeroError(part: string, label: string): string {
  return `invalid semver: ${label} "${part}" must not have leading zeros`
}

/** Parse a semver string. Returns ok:false with a reason for invalid input. */
export function parseVersion(
  input: string,
): { ok: true; value: ParsedVersion } | { ok: false; reason: string } {
  const trimmed = input.trim()
  if (trimmed === '') return { ok: false, reason: 'invalid semver: empty string' }
  const m = VERSION_RE.exec(trimmed)
  if (m === null) {
    return { ok: false, reason: `invalid semver: "${trimmed}" is not a MAJOR.MINOR.PATCH version` }
  }
  const majorRaw = m[1] ?? ''
  const minorRaw = m[2] ?? ''
  const patchRaw = m[3] ?? ''
  if (majorRaw.length > 1 && majorRaw.startsWith('0')) {
    return { ok: false, reason: leadingZeroError(majorRaw, 'major') }
  }
  if (minorRaw.length > 1 && minorRaw.startsWith('0')) {
    return { ok: false, reason: leadingZeroError(minorRaw, 'minor') }
  }
  if (patchRaw.length > 1 && patchRaw.startsWith('0')) {
    return { ok: false, reason: leadingZeroError(patchRaw, 'patch') }
  }

  const prereleaseRaw = m[4]
  let prerelease: readonly string[] | null = null
  if (prereleaseRaw !== undefined) {
    const ids = prereleaseRaw.split('.')
    for (const id of ids) {
      if (!IDENT_RE.test(id)) {
        return { ok: false, reason: `invalid semver: prerelease identifier "${id}" contains invalid characters` }
      }
      if (id.length > 1 && id.startsWith('0') && /^\d+$/.test(id)) {
        return { ok: false, reason: leadingZeroError(id, 'prerelease numeric identifier') }
      }
    }
    prerelease = ids
  }

  const buildRaw = m[5]
  let build: readonly string[] | null = null
  if (buildRaw !== undefined) {
    const ids = buildRaw.split('.')
    for (const id of ids) {
      if (!IDENT_RE.test(id)) {
        return { ok: false, reason: `invalid semver: build identifier "${id}" contains invalid characters` }
      }
    }
    build = ids
  }

  return {
    ok: true,
    value: {
      major: Number(majorRaw),
      minor: Number(minorRaw),
      patch: Number(patchRaw),
      prerelease,
      build,
    },
  }
}

/** Normalize a parsed version back to a canonical string (build metadata preserved). */
export function normalizeVersion(value: ParsedVersion): string {
  let out = `${value.major}.${value.minor}.${value.patch}`
  if (value.prerelease !== null) out += `-${value.prerelease.join('.')}`
  if (value.build !== null) out += `+${value.build.join('.')}`
  return out
}

/** Compare two prerelease identifier lists per the semver spec. */
function comparePrerelease(a: readonly string[], b: readonly string[]): number {
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? ''
    const y = b[i] ?? ''
    const xNum = /^\d+$/.test(x)
    const yNum = /^\d+$/.test(y)
    if (xNum && yNum) {
      const diff = Number(x) - Number(y)
      if (diff !== 0) return diff < 0 ? -1 : 1
    } else if (xNum !== yNum) {
      // Numeric identifiers always have lower precedence than alphanumeric ones.
      return xNum ? -1 : 1
    } else {
      const diff = x < y ? -1 : x > y ? 1 : 0
      if (diff !== 0) return diff
    }
  }
  return a.length - b.length
}

/**
 * Compare two parsed versions per semver 2.0.0 precedence.
 * Returns -1 (a < b), 0 (equal precedence), or 1 (a > b). Build metadata is ignored.
 */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1
  const aPre = a.prerelease
  const bPre = b.prerelease
  if (aPre === null && bPre === null) return 0
  if (aPre === null) return 1 // release > prerelease
  if (bPre === null) return -1
  return comparePrerelease(aPre, bPre)
}

/** [major, minor, patch] tuple of a version. */
function tupleOf(v: ParsedVersion): string {
  return `${v.major}.${v.minor}.${v.patch}`
}

/** A single range comparator (e.g. >= 1.2.0). */
interface Comparator {
  op: '>' | '>=' | '<' | '<='
  version: ParsedVersion
}

function cmp(version: ParsedVersion, c: Comparator): boolean {
  const d = compareVersions(version, c.version)
  switch (c.op) {
    case '>':
      return d > 0
    case '>=':
      return d >= 0
    case '<':
      return d < 0
    case '<=':
      return d <= 0
  }
}

const PARTIAL_RE =
  /^(?<op><=|>=|<|>|=|\^|~)?\s*[v=]?(?<major>\d+|\*|x|X)(?:\.(?<minor>\d+|\*|x|X)(?:\.(?<patch>\d+|\*|x|X))?)?(?:-(?<pre>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/
const HYPHEN_RE = /^(\S+)\s+-\s+(\S+)$/

const isX = (s: string | undefined): boolean => s === undefined || s === '*' || s === 'x' || s === 'X'

/** Build a version from numeric parts and an optional prerelease string. */
function makeVersion(
  major: number,
  minor: number,
  patch: number,
  pre: string | null,
): ParsedVersion {
  return {
    major,
    minor,
    patch,
    prerelease: pre === null ? null : pre.split('.'),
    build: null,
  }
}

/** Split "1.2.3-beta+b1" into its prerelease part; build metadata is stripped (ignored for matching). */
function stripBuild(token: string): string {
  const plus = token.indexOf('+')
  return plus >= 0 ? token.slice(0, plus) : token
}

/** Parse a single comparator token into [lower, upper] comparators. */
function parseToken(token: string): { ok: true; comparators: Comparator[] } | { ok: false; reason: string } {
  const t = stripBuild(token.trim())
  if (t === '') return { ok: true, comparators: [] }

  const m = PARTIAL_RE.exec(t)
  if (m === null) return { ok: false, reason: `invalid range: cannot parse comparator "${t}"` }
  const op = m.groups?.op ?? ''
  const rawMajor = m.groups?.major ?? ''
  const rawMinor = m.groups?.minor
  const rawPatch = m.groups?.patch
  const preRaw = m.groups?.pre ?? null

  const lower = (v: ParsedVersion): Comparator => ({ op: '>=', version: v })
  const upper = (v: ParsedVersion): Comparator => ({ op: '<', version: v })
  const upperInc = (v: ParsedVersion): Comparator => ({ op: '<=', version: v })

  if (op === '' || op === '=') {
    // Exact version or partial / wildcard (no operator).
    if (isX(rawMajor)) return { ok: true, comparators: [] } // "*" / "x" matches everything
    const major = Number(rawMajor)
    if (isX(rawMinor)) {
      return { ok: true, comparators: [lower(makeVersion(major, 0, 0, null)), upper(makeVersion(major + 1, 0, 0, null))] }
    }
    const minor = Number(rawMinor)
    if (isX(rawPatch)) {
      return { ok: true, comparators: [lower(makeVersion(major, minor, 0, null)), upper(makeVersion(major, minor + 1, 0, null))] }
    }
    const patch = Number(rawPatch)
    const v = makeVersion(major, minor, patch, preRaw)
    return { ok: true, comparators: [upperInc(v), lower(v)] }
  }

  if (op === '>=' || op === '<=' || op === '>' || op === '<') {
    if (isX(rawMajor) || isX(rawMinor) || isX(rawPatch)) {
      return { ok: false, reason: `invalid range: "${op}" cannot be combined with wildcard versions` }
    }
    const v = makeVersion(Number(rawMajor), Number(rawMinor), Number(rawPatch), preRaw)
    return { ok: true, comparators: [{ op, version: v }] }
  }

  if (op === '^') {
    if (isX(rawMajor)) return { ok: true, comparators: [] } // ^* matches everything
    const major = Number(rawMajor)
    const minor = isX(rawMinor) ? undefined : Number(rawMinor)
    const patch = isX(rawPatch) ? undefined : Number(rawPatch)
    const base = makeVersion(major, minor ?? 0, patch ?? 0, preRaw)
    let upperBound: ParsedVersion
    if (major > 0) {
      upperBound = makeVersion(major + 1, 0, 0, null)
    } else if ((minor ?? 0) > 0) {
      upperBound = makeVersion(0, (minor ?? 0) + 1, 0, null)
    } else if ((patch ?? 0) > 0) {
      upperBound = makeVersion(0, 0, (patch ?? 0) + 1, null)
    } else {
      // ^0 / ^0.0 — bump the last specified component.
      upperBound = patch !== undefined
        ? makeVersion(0, 0, 1, null)
        : minor !== undefined
          ? makeVersion(0, 1, 0, null)
          : makeVersion(1, 0, 0, null)
    }
    return { ok: true, comparators: [lower(base), upper(upperBound)] }
  }

  // op === '~'
  if (isX(rawMajor)) return { ok: true, comparators: [] }
  const major = Number(rawMajor)
  const minor = isX(rawMinor) ? undefined : Number(rawMinor)
  const base = makeVersion(major, minor ?? 0, 0, preRaw)
  const upperBound = minor !== undefined ? makeVersion(major, minor + 1, 0, null) : makeVersion(major + 1, 0, 0, null)
  return { ok: true, comparators: [lower(base), upper(upperBound)] }
}

/** Expand one range alternative (a space-separated comparator set) into comparators. */
function expandAlternative(alt: string): { ok: true; comparators: Comparator[] } | { ok: false; reason: string } {
  const trimmed = alt.trim()
  if (trimmed === '') return { ok: true, comparators: [] }

  const hyphen = HYPHEN_RE.exec(trimmed)
  if (hyphen !== null) {
    // Hyphen ranges must stand alone in their alternative.
    const loToken = (hyphen[1] ?? '').trim()
    const hiToken = (hyphen[2] ?? '').trim()
    const lo = parseToken(loToken)
    if (!lo.ok) return lo
    const hi = parseToken(hiToken)
    if (!hi.ok) return hi
    const loV = lo.comparators[0]?.version
    if (loV === undefined || lo.comparators.length !== 2 || hi.comparators.length === 0) {
      return { ok: false, reason: `invalid range: hyphen endpoints "${loToken}" / "${hiToken}" must be plain versions` }
    }
    const comparators: Comparator[] = [{ op: '>=', version: loV }]
    const hiFirst = hi.comparators[0]
    if (hiFirst === undefined) {
      return { ok: false, reason: `invalid range: cannot parse upper endpoint "${hiToken}"` }
    }
    if (hiFirst.op === '<=') {
      // Full version upper endpoint → inclusive (parseToken exact branch yields [<=, >=]).
      comparators.push({ op: '<=', version: hiFirst.version })
    } else if (hiFirst.op === '>=' && hi.comparators.length === 2) {
      // Partial upper endpoint → exclusive, one unit past the last specified component.
      const hiUpper = hi.comparators[1]
      if (hiUpper === undefined) return { ok: false, reason: `invalid range: cannot parse upper endpoint "${hiToken}"` }
      comparators.push({ op: '<', version: hiUpper.version })
    } else {
      return { ok: false, reason: `invalid range: hyphen endpoints "${loToken}" / "${hiToken}" must be plain versions` }
    }
    return { ok: true, comparators }
  }

  const tokens = trimmed.split(/\s+/)
  const comparators: Comparator[] = []
  for (const token of tokens) {
    const parsed = parseToken(token)
    if (!parsed.ok) return parsed
    comparators.push(...parsed.comparators)
  }
  return { ok: true, comparators }
}

/** Render a comparator set as a compact normalized label. */
function renderComparators(comparators: Comparator[]): string {
  if (comparators.length === 0) return '*'
  return comparators
    .map((c) => `${c.op}${normalizeVersion(c.version)}`)
    .sort((a, b) => (a < b ? -1 : 1))
    .join(' ')
}

/**
 * Check whether a version satisfies an npm-style range.
 * Supports: exact, =, >, >=, <, <=, ^, ~, wildcards (1.2.x, 1.x, *), hyphen
 * ranges (1.2.3 - 2.3.4), AND (space) and OR (||). Build metadata in range
 * tokens is ignored.
 */
export function satisfiesRange(
  version: ParsedVersion,
  range: string,
  includePrerelease = false,
): { ok: true; satisfied: boolean; normalized: string } | { ok: false; reason: string } {
  const trimmed = range.trim()
  if (trimmed === '') return { ok: false, reason: 'invalid range: empty string' }

  const alternatives = trimmed.split('||')
  const matchedAlts: string[] = []
  for (const alt of alternatives) {
    const expanded = expandAlternative(alt)
    if (!expanded.ok) return expanded
    const comparators = expanded.comparators
    // npm tuple-lock: a prerelease candidate only matches when at least one
    // comparator has a prerelease of the SAME [major, minor, patch] tuple.
    const lockActive = version.prerelease !== null && !includePrerelease
    const prereleaseAllowed =
      !lockActive || comparators.some((c) => c.version.prerelease !== null && tupleOf(c.version) === tupleOf(version))
    const ok = prereleaseAllowed && comparators.every((c) => cmp(version, c))
    if (ok) matchedAlts.push(renderComparators(comparators))
  }

  if (matchedAlts.length > 0) {
    return { ok: true, satisfied: true, normalized: matchedAlts.join(' || ') }
  }
  const allAlts: string[] = []
  for (const alt of alternatives) {
    const expanded = expandAlternative(alt)
    if (expanded.ok) allAlts.push(renderComparators(expanded.comparators))
  }
  return { ok: true, satisfied: false, normalized: allAlts.join(' || ') }
}

/** Human-readable relation between two versions. */
export function relationLabel(a: ParsedVersion, b: ParsedVersion): 'lt' | 'eq' | 'gt' {
  const d = compareVersions(a, b)
  return d < 0 ? 'lt' : d > 0 ? 'gt' : 'eq'
}

/* ------------------------------------------------------------------ *
 * v0.2.0 — increment / difference / sort (npm semver 7.x parity)      *
 * ------------------------------------------------------------------ */

/** Release types supported by semver_inc (npm semver.inc). */
export const INC_RELEASES = ['major', 'minor', 'patch', 'premajor', 'preminor', 'prepatch', 'prerelease'] as const
export type IncRelease = (typeof INC_RELEASES)[number]

/** Release-type difference between two versions (npm semver.diff). */
export type DiffKind = 'major' | 'minor' | 'patch' | 'premajor' | 'preminor' | 'prepatch' | 'prerelease'

/** A single prerelease/build identifier (dot-separated body per npm's identifier validation). */
const IDENTIFIER_RE = /^(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*$/
const NUMERIC_RE = /^\d+$/

/** Compare two identifiers, numeric before alphanumeric (npm compareIdentifiers). */
export function compareIdentifiers(a: string, b: string): number {
  const aNum = NUMERIC_RE.test(a)
  const bNum = NUMERIC_RE.test(b)
  if (aNum && bNum) {
    const an = Number(a)
    const bn = Number(b)
    return an === bn ? 0 : an < bn ? -1 : 1
  }
  if (aNum !== bNum) return aNum ? -1 : 1
  return a === b ? 0 : a < b ? -1 : 1
}

/** Precedence comparison with build-metadata tie-break (npm compareBuild). */
export function compareBuildVersions(a: ParsedVersion, b: ParsedVersion): number {
  const precedence = compareVersions(a, b)
  if (precedence !== 0) return precedence
  const ab = a.build
  const bb = b.build
  if (ab === null && bb === null) return 0
  if (ab === null) return -1
  if (bb === null) return 1
  const len = Math.max(ab.length, bb.length)
  for (let i = 0; i < len; i++) {
    const x = ab[i]
    const y = bb[i]
    if (x === undefined && y === undefined) return 0
    if (x === undefined) return -1
    if (y === undefined) return 1
    const d = compareIdentifiers(x, y)
    if (d !== 0) return d
  }
  return 0
}

export type IncResult =
  | { ok: true; value: { from: string; next: string; rule: string } }
  | { ok: false; reason: string }

/**
 * Increment a version following npm semver.inc semantics (semver 7.x):
 * - premajor/preminor/prepatch clear the prerelease and bump the component,
 *   then attach [identifier.]0; prepatch always bumps patch.
 * - prerelease acts like prepatch for plain releases, otherwise bumps the
 *   last numeric prerelease identifier (or appends 0 when none is numeric).
 * - major/minor/patch on a pre-major/pre-minor/pre-patch version release it
 *   without incrementing ("1.0.0-5" + major → "1.0.0").
 * - build metadata is dropped from the result (npm parity).
 */
export function incVersion(input: string, release: string, identifier?: string): IncResult {
  if (!(INC_RELEASES as readonly string[]).includes(release)) {
    return { ok: false, reason: `invalid release type: "${release}" (expected one of ${INC_RELEASES.join('/')})` }
  }
  const id = identifier !== undefined && identifier !== '' ? identifier : undefined
  if (id !== undefined && release.startsWith('pre') && !IDENTIFIER_RE.test(id)) {
    return { ok: false, reason: `invalid identifier: "${id}" (dot-separated [0-9A-Za-z-] tokens, no leading zeros)` }
  }
  const parsed = parseVersion(input)
  if (!parsed.ok) return parsed
  const v = parsed.value
  let major = v.major
  let minor = v.minor
  let patch = v.patch
  let pre: string[] = v.prerelease === null ? [] : [...v.prerelease]
  const hasPre = pre.length > 0

  switch (release) {
    case 'premajor':
      pre = []
      patch = 0
      minor = 0
      major++
      pre = bumpPre(pre, id)
      break
    case 'preminor':
      pre = []
      patch = 0
      minor++
      pre = bumpPre(pre, id)
      break
    case 'prepatch':
      pre = [] // npm clears the prerelease first, so patch always increments
      patch++
      pre = bumpPre(pre, id)
      break
    case 'prerelease':
      if (!hasPre) patch++ // acts like prepatch when the input is a plain release
      pre = bumpPre(pre, id)
      break
    case 'major':
      if (minor !== 0 || patch !== 0 || !hasPre) major++
      minor = 0
      patch = 0
      pre = []
      break
    case 'minor':
      if (patch !== 0 || !hasPre) minor++
      patch = 0
      pre = []
      break
    case 'patch':
      if (!hasPre) patch++
      pre = []
      break
  }

  const next = normalizeVersion({ major, minor, patch, prerelease: pre.length > 0 ? pre : null, build: null })
  const from = normalizeVersion(v)
  return { ok: true, value: { from, next, rule: `bump ${release}${id !== undefined ? ` (identifier ${id})` : ''}: ${from} → ${next}` } }
}

/** npm's internal "pre" increment (base identifier 0). */
function bumpPre(pre: string[], identifier: string | undefined): string[] {
  if (pre.length === 0) {
    pre = ['0']
  } else {
    let bumped = false
    for (let i = pre.length - 1; i >= 0; i--) {
      const token = pre[i] ?? ''
      if (NUMERIC_RE.test(token)) {
        pre[i] = String(Number(token) + 1)
        bumped = true
        break
      }
    }
    if (!bumped) pre.push('0')
  }
  if (identifier !== undefined) {
    const candidate = [...identifier.split('.'), '0']
    if (compareIdentifiers(pre[0] ?? '', identifier) === 0) {
      const second = pre[1]
      if (second === undefined || Number.isNaN(Number(second))) {
        pre = candidate
      }
    } else {
      pre = candidate
    }
  }
  return pre
}

/**
 * Release-type difference between two versions (npm semver.diff semantics).
 * Returns null when precedence is equal (build metadata ignored). npm special
 * cases: prerelease → release of the same main version is patch (or minor when
 * the low version is a pre-minor, or major when it is a pre-major), and a
 * difference whose higher side is a prerelease gets the "pre" prefix.
 */
export function diffKind(a: ParsedVersion, b: ParsedVersion): DiffKind | null {
  const comparison = compareVersions(a, b)
  if (comparison === 0) return null
  const aHigher = comparison > 0
  const high = aHigher ? a : b
  const low = aHigher ? b : a
  const highHasPre = high.prerelease !== null && high.prerelease.length > 0
  const lowHasPre = low.prerelease !== null && low.prerelease.length > 0
  if (lowHasPre && !highHasPre) {
    if (low.patch === 0 && low.minor === 0) return 'major'
    if (low.major === high.major && low.minor === high.minor && low.patch === high.patch) {
      if (low.minor !== 0 && low.patch === 0) return 'minor'
      return 'patch'
    }
  }
  const prefix = highHasPre ? 'pre' : ''
  if (a.major !== b.major) return (prefix + 'major') as DiffKind
  if (a.minor !== b.minor) return (prefix + 'minor') as DiffKind
  if (a.patch !== b.patch) return (prefix + 'patch') as DiffKind
  return 'prerelease'
}

export type SortResult = {
  ok: true
  value: { sorted: string[]; invalid: { index: number; input: string; reason: string }[] }
} | { ok: false; reason: string }

/**
 * Sort version strings by precedence (npm semver.sort / rsort), using build
 * metadata as tie-break (npm compareBuild). Invalid entries are skipped and
 * reported with their input index; valid entries are still sorted.
 */
export function sortVersionStrings(inputs: readonly string[], order: 'asc' | 'desc' = 'asc'): SortResult {
  if (inputs.length === 0) return { ok: true, value: { sorted: [], invalid: [] } }
  const entries: { value: ParsedVersion; normalized: string }[] = []
  const invalid: { index: number; input: string; reason: string }[] = []
  inputs.forEach((input, index) => {
    const result = parseVersion(input)
    if (!result.ok) invalid.push({ index, input, reason: result.reason })
    else entries.push({ value: result.value, normalized: normalizeVersion(result.value) })
  })
  entries.sort((x, y) => {
    const d = compareBuildVersions(x.value, y.value)
    return order === 'desc' ? -d : d
  })
  return { ok: true, value: { sorted: entries.map((e) => e.normalized), invalid } }
}
