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
const VERSION_RE = /^[v=]?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const IDENT_RE = /^[0-9A-Za-z-]+$/;
function leadingZeroError(part, label) {
    return `invalid semver: ${label} "${part}" must not have leading zeros`;
}
/** Parse a semver string. Returns ok:false with a reason for invalid input. */
export function parseVersion(input) {
    const trimmed = input.trim();
    if (trimmed === '')
        return { ok: false, reason: 'invalid semver: empty string' };
    const m = VERSION_RE.exec(trimmed);
    if (m === null) {
        return { ok: false, reason: `invalid semver: "${trimmed}" is not a MAJOR.MINOR.PATCH version` };
    }
    const majorRaw = m[1] ?? '';
    const minorRaw = m[2] ?? '';
    const patchRaw = m[3] ?? '';
    if (majorRaw.length > 1 && majorRaw.startsWith('0')) {
        return { ok: false, reason: leadingZeroError(majorRaw, 'major') };
    }
    if (minorRaw.length > 1 && minorRaw.startsWith('0')) {
        return { ok: false, reason: leadingZeroError(minorRaw, 'minor') };
    }
    if (patchRaw.length > 1 && patchRaw.startsWith('0')) {
        return { ok: false, reason: leadingZeroError(patchRaw, 'patch') };
    }
    const prereleaseRaw = m[4];
    let prerelease = null;
    if (prereleaseRaw !== undefined) {
        const ids = prereleaseRaw.split('.');
        for (const id of ids) {
            if (!IDENT_RE.test(id)) {
                return { ok: false, reason: `invalid semver: prerelease identifier "${id}" contains invalid characters` };
            }
            if (id.length > 1 && id.startsWith('0') && /^\d+$/.test(id)) {
                return { ok: false, reason: leadingZeroError(id, 'prerelease numeric identifier') };
            }
        }
        prerelease = ids;
    }
    const buildRaw = m[5];
    let build = null;
    if (buildRaw !== undefined) {
        const ids = buildRaw.split('.');
        for (const id of ids) {
            if (!IDENT_RE.test(id)) {
                return { ok: false, reason: `invalid semver: build identifier "${id}" contains invalid characters` };
            }
        }
        build = ids;
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
    };
}
/** Normalize a parsed version back to a canonical string (build metadata preserved). */
export function normalizeVersion(value) {
    let out = `${value.major}.${value.minor}.${value.patch}`;
    if (value.prerelease !== null)
        out += `-${value.prerelease.join('.')}`;
    if (value.build !== null)
        out += `+${value.build.join('.')}`;
    return out;
}
/** Compare two prerelease identifier lists per the semver spec. */
function comparePrerelease(a, b) {
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
        const x = a[i] ?? '';
        const y = b[i] ?? '';
        const xNum = /^\d+$/.test(x);
        const yNum = /^\d+$/.test(y);
        if (xNum && yNum) {
            const diff = Number(x) - Number(y);
            if (diff !== 0)
                return diff < 0 ? -1 : 1;
        }
        else if (xNum !== yNum) {
            // Numeric identifiers always have lower precedence than alphanumeric ones.
            return xNum ? -1 : 1;
        }
        else {
            const diff = x < y ? -1 : x > y ? 1 : 0;
            if (diff !== 0)
                return diff;
        }
    }
    return a.length - b.length;
}
/**
 * Compare two parsed versions per semver 2.0.0 precedence.
 * Returns -1 (a < b), 0 (equal precedence), or 1 (a > b). Build metadata is ignored.
 */
export function compareVersions(a, b) {
    if (a.major !== b.major)
        return a.major < b.major ? -1 : 1;
    if (a.minor !== b.minor)
        return a.minor < b.minor ? -1 : 1;
    if (a.patch !== b.patch)
        return a.patch < b.patch ? -1 : 1;
    const aPre = a.prerelease;
    const bPre = b.prerelease;
    if (aPre === null && bPre === null)
        return 0;
    if (aPre === null)
        return 1; // release > prerelease
    if (bPre === null)
        return -1;
    return comparePrerelease(aPre, bPre);
}
/** [major, minor, patch] tuple of a version. */
function tupleOf(v) {
    return `${v.major}.${v.minor}.${v.patch}`;
}
function cmp(version, c) {
    const d = compareVersions(version, c.version);
    switch (c.op) {
        case '':
            return d === 0;
        case '>':
            return d > 0;
        case '>=':
            return d >= 0;
        case '<':
            return d < 0;
        case '<=':
            return d <= 0;
    }
}
const PARTIAL_RE = /^(?<op><=|>=|<|>|=|\^|~)?\s*[v=]?(?<major>\d+|\*|x|X)(?:\.(?<minor>\d+|\*|x|X)(?:\.(?<patch>\d+|\*|x|X))?)?(?:-(?<pre>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const HYPHEN_RE = /^(\S+)\s+-\s+(\S+)$/;
const isX = (s) => s === undefined || s === '*' || s === 'x' || s === 'X';
/** Build a version from numeric parts and an optional prerelease string. */
function makeVersion(major, minor, patch, pre) {
    return {
        major,
        minor,
        patch,
        prerelease: pre === null ? null : pre.split('.'),
        build: null,
    };
}
/** Split "1.2.3-beta+b1" into its prerelease part; build metadata is stripped (ignored for matching). */
function stripBuild(token) {
    const plus = token.indexOf('+');
    return plus >= 0 ? token.slice(0, plus) : token;
}
/** Parse a single comparator token into [lower, upper] comparators.
 *
 * `npmShape` reproduces npm's own `Range.set` comparator shape instead of the
 * `[<=, >=]` pair this plugin's matcher uses — `outsideRange` reads
 * `comparator.op` the way npm does. Three npm behaviours are reproduced:
 *   ① an exact version stays a *bare* comparator (`{op: '', version}`);
 *   ② every exclusive upper bound npm **generates** (x-ranges, caret, tilde,
 *      partial comparisons, hyphen upper endpoints) gets a `-0` prerelease
 *      (`^1.2.3` → `<2.0.0-0`, `<=1.2` → `<1.3.0-0`) — bound arithmetic in
 *      npm's `outside()` depends on it;
 *   ③ a bare `>=0.0.0` comparator is dropped (npm's `replaceGTE0`), which is
 *      why npm compiles `^0` to just `<1.0.0-0`.
 */
function parseToken(token, npmShape = false) {
    const t = stripBuild(token.trim());
    if (t === '')
        return { ok: true, comparators: [] };
    const m = PARTIAL_RE.exec(t);
    if (m === null)
        return { ok: false, reason: `invalid range: cannot parse comparator "${t}"` };
    const op = m.groups?.op ?? '';
    const rawMajor = m.groups?.major ?? '';
    const rawMinor = m.groups?.minor;
    const rawPatch = m.groups?.patch;
    const preRaw = m.groups?.pre ?? null;
    const lower = (v) => ({ op: '>=', version: v });
    /** An exclusive upper bound. npm appends `-0` to every bound it generates (see above). */
    const upper = (v) => npmShape ? { op: '<', version: { ...v, prerelease: ['0'] } } : { op: '<', version: v };
    const upperInc = (v) => ({ op: '<=', version: v });
    if (op === '' || op === '=') {
        // Exact version or partial / wildcard (no operator).
        if (isX(rawMajor))
            return { ok: true, comparators: [] }; // "*" / "x" matches everything
        const major = Number(rawMajor);
        if (isX(rawMinor)) {
            return { ok: true, comparators: [lower(makeVersion(major, 0, 0, null)), upper(makeVersion(major + 1, 0, 0, null))] };
        }
        const minor = Number(rawMinor);
        if (isX(rawPatch)) {
            return { ok: true, comparators: [lower(makeVersion(major, minor, 0, null)), upper(makeVersion(major, minor + 1, 0, null))] };
        }
        const patch = Number(rawPatch);
        const v = makeVersion(major, minor, patch, preRaw);
        return { ok: true, comparators: npmShape ? [{ op: '', version: v }] : [upperInc(v), lower(v)] };
    }
    if (op === '>=' || op === '<=' || op === '>' || op === '<') {
        // Partial versions combined with a comparison operator follow npm's x-range
        // rewrite: ">1.2" → ">=1.3.0", "<=1.2" → "<1.3.0", "<1.2" → "<1.2.0",
        // ">=1.2" → ">=1.2.0" (and the same one level deeper for "1.2.x").
        if (isX(rawMajor)) {
            // ">*" / "<*" / ">x": npm compiles these to "<0.0.0-0", which nothing satisfies.
            if (op === '>' || op === '<')
                return { ok: true, comparators: [upper(makeVersion(0, 0, 0, '0'))] };
            return { ok: true, comparators: [] }; // ">=*" / "<=*" match everything
        }
        const major = Number(rawMajor);
        if (isX(rawMinor)) {
            if (op === '>')
                return { ok: true, comparators: [lower(makeVersion(major + 1, 0, 0, null))] };
            if (op === '<=')
                return { ok: true, comparators: [upper(makeVersion(major + 1, 0, 0, null))] };
            if (op === '>=')
                return { ok: true, comparators: [lower(makeVersion(major, 0, 0, null))] };
            return { ok: true, comparators: [upper(makeVersion(major, 0, 0, null))] };
        }
        const minor = Number(rawMinor);
        if (isX(rawPatch)) {
            if (op === '>')
                return { ok: true, comparators: [lower(makeVersion(major, minor + 1, 0, null))] };
            if (op === '<=')
                return { ok: true, comparators: [upper(makeVersion(major, minor + 1, 0, null))] };
            if (op === '>=')
                return { ok: true, comparators: [lower(makeVersion(major, minor, 0, null))] };
            return { ok: true, comparators: [upper(makeVersion(major, minor, 0, null))] };
        }
        const v = makeVersion(major, minor, Number(rawPatch), preRaw);
        return { ok: true, comparators: [{ op, version: v }] };
    }
    if (op === '^') {
        if (isX(rawMajor))
            return { ok: true, comparators: [] }; // ^* matches everything
        const major = Number(rawMajor);
        const minor = isX(rawMinor) ? undefined : Number(rawMinor);
        const patch = isX(rawPatch) ? undefined : Number(rawPatch);
        const base = makeVersion(major, minor ?? 0, patch ?? 0, preRaw);
        let upperBound;
        if (major > 0) {
            upperBound = makeVersion(major + 1, 0, 0, null);
        }
        else if ((minor ?? 0) > 0) {
            upperBound = makeVersion(0, (minor ?? 0) + 1, 0, null);
        }
        else if ((patch ?? 0) > 0) {
            upperBound = makeVersion(0, 0, (patch ?? 0) + 1, null);
        }
        else {
            // ^0 / ^0.0 — bump the last specified component.
            upperBound = patch !== undefined
                ? makeVersion(0, 0, 1, null)
                : minor !== undefined
                    ? makeVersion(0, 1, 0, null)
                    : makeVersion(1, 0, 0, null);
        }
        return { ok: true, comparators: [lower(base), upper(upperBound)] };
    }
    // op === '~'
    if (isX(rawMajor))
        return { ok: true, comparators: [] };
    const major = Number(rawMajor);
    const minor = isX(rawMinor) ? undefined : Number(rawMinor);
    const patch = isX(rawPatch) ? undefined : Number(rawPatch);
    // npm: "~1.2.3" → >=1.2.3 <1.3.0; a missing patch only fills in for the lower bound
    // ("~1.2" → >=1.2.0 <1.3.0). Dropping a specified patch here would silently widen the
    // range (the v0.3.0 oracle sweep caught exactly that: ~1.2.3 used to match 1.2.0).
    const base = makeVersion(major, minor ?? 0, patch ?? 0, preRaw);
    const upperBound = minor !== undefined ? makeVersion(major, minor + 1, 0, null) : makeVersion(major + 1, 0, 0, null);
    return { ok: true, comparators: [lower(base), upper(upperBound)] };
}
/** Expand one range alternative (a space-separated comparator set) into comparators. */
function expandAlternative(alt, npmShape = false) {
    const trimmed = alt.trim();
    if (trimmed === '')
        return { ok: true, comparators: [] };
    const hyphen = HYPHEN_RE.exec(trimmed);
    if (hyphen !== null) {
        // Hyphen ranges must stand alone in their alternative. Endpoints go through
        // the default (paired) parsing: npm compiles "1.2.3 - 2.3.4" into
        // ">=1.2.3 <=2.3.4", never into bare comparators.
        const loToken = (hyphen[1] ?? '').trim();
        const hiToken = (hyphen[2] ?? '').trim();
        const lo = parseToken(loToken);
        if (!lo.ok)
            return lo;
        const hi = parseToken(hiToken);
        if (!hi.ok)
            return hi;
        const loV = lo.comparators[0]?.version;
        if (loV === undefined || lo.comparators.length !== 2 || hi.comparators.length === 0) {
            return { ok: false, reason: `invalid range: hyphen endpoints "${loToken}" / "${hiToken}" must be plain versions` };
        }
        const comparators = [{ op: '>=', version: loV }];
        const hiFirst = hi.comparators[0];
        if (hiFirst === undefined) {
            return { ok: false, reason: `invalid range: cannot parse upper endpoint "${hiToken}"` };
        }
        if (hiFirst.op === '<=') {
            // Full version upper endpoint → inclusive (parseToken exact branch yields [<=, >=]).
            comparators.push({ op: '<=', version: hiFirst.version });
        }
        else if (hiFirst.op === '>=' && hi.comparators.length === 2) {
            // Partial upper endpoint → exclusive, one unit past the last specified
            // component (npm: "1.2.3 - 2.3" → ">=1.2.3 <2.4.0-0").
            const hiUpper = hi.comparators[1];
            if (hiUpper === undefined)
                return { ok: false, reason: `invalid range: cannot parse upper endpoint "${hiToken}"` };
            comparators.push(npmShape ? { op: '<', version: { ...hiUpper.version, prerelease: ['0'] } } : { op: '<', version: hiUpper.version });
        }
        else {
            return { ok: false, reason: `invalid range: hyphen endpoints "${loToken}" / "${hiToken}" must be plain versions` };
        }
        return { ok: true, comparators };
    }
    const tokens = trimmed.split(/\s+/);
    const comparators = [];
    for (const token of tokens) {
        const parsed = parseToken(token, npmShape);
        if (!parsed.ok)
            return parsed;
        comparators.push(...parsed.comparators);
    }
    return { ok: true, comparators: npmShape ? dropRedundantLowerBound(comparators) : comparators };
}
/**
 * npm's `replaceGTE0`: a bare `>=0.0.0` comparator is dropped from a range.
 * It is why npm compiles `^0` to `<1.0.0-0` alone, and the outside() port has to
 * see the same set (a `>=0.0.0` bound would change which comparator is `low`).
 */
function dropRedundantLowerBound(comparators) {
    return comparators.filter((c) => !(c.op === '>=' && c.version.major === 0 && c.version.minor === 0 && c.version.patch === 0 && c.version.prerelease === null));
}
/** Render a comparator set as a compact normalized label. */
function renderComparators(comparators) {
    if (comparators.length === 0)
        return '*';
    return comparators
        .map((c) => `${c.op}${normalizeVersion(c.version)}`)
        .sort((a, b) => (a < b ? -1 : 1))
        .join(' ');
}
/**
 * Check whether a version satisfies an npm-style range.
 * Supports: exact, =, >, >=, <, <=, ^, ~, wildcards (1.2.x, 1.x, *), hyphen
 * ranges (1.2.3 - 2.3.4), AND (space) and OR (||). Build metadata in range
 * tokens is ignored.
 */
export function satisfiesRange(version, range, includePrerelease = false) {
    const trimmed = range.trim();
    if (trimmed === '')
        return { ok: false, reason: 'invalid range: empty string' };
    const alternatives = trimmed.split('||');
    const matchedAlts = [];
    for (const alt of alternatives) {
        const expanded = expandAlternative(alt);
        if (!expanded.ok)
            return expanded;
        const comparators = expanded.comparators;
        // npm tuple-lock: a prerelease candidate only matches when at least one
        // comparator has a prerelease of the SAME [major, minor, patch] tuple.
        const lockActive = version.prerelease !== null && !includePrerelease;
        const prereleaseAllowed = !lockActive || comparators.some((c) => c.version.prerelease !== null && tupleOf(c.version) === tupleOf(version));
        const ok = prereleaseAllowed && comparators.every((c) => cmp(version, c));
        if (ok)
            matchedAlts.push(renderComparators(comparators));
    }
    if (matchedAlts.length > 0) {
        return { ok: true, satisfied: true, normalized: matchedAlts.join(' || ') };
    }
    const allAlts = [];
    for (const alt of alternatives) {
        const expanded = expandAlternative(alt);
        if (expanded.ok)
            allAlts.push(renderComparators(expanded.comparators));
    }
    return { ok: true, satisfied: false, normalized: allAlts.join(' || ') };
}
/** Human-readable relation between two versions. */
export function relationLabel(a, b) {
    const d = compareVersions(a, b);
    return d < 0 ? 'lt' : d > 0 ? 'gt' : 'eq';
}
/* ------------------------------------------------------------------ *
 * v0.3.0 — range algebra: minimum version / range intersection        *
 * ------------------------------------------------------------------ */
/** Parse a range into its alternatives (each an AND-set of comparators). */
function parseRangeSets(range, npmShape = false) {
    const trimmed = range.trim();
    if (trimmed === '')
        return { ok: false, reason: 'invalid range: empty string' };
    const sets = [];
    for (const alt of trimmed.split('||')) {
        const expanded = expandAlternative(alt, npmShape);
        if (!expanded.ok)
            return expanded;
        sets.push(expanded.comparators);
    }
    return { ok: true, sets };
}
/**
 * npm's own comparator shape for a range, as strings (`"npmRangeSets('^1.2.3')"`
 * → `[['>=1.2.3', '<2.0.0-0']]`, a wildcard set → `[['ANY']]`). Exposed for the
 * oracle sweep: it lets the test compare this parser against
 * `new (require('semver').Range)(range).set` comparator for comparator instead
 * of only through verdicts — the shape is what `outsideRange` walks.
 */
export function npmRangeSets(range) {
    const parsed = parseRangeSets(range, true);
    if (!parsed.ok)
        return parsed;
    return {
        ok: true,
        sets: parsed.sets.map((set) => (set.length === 0 ? ['ANY'] : set.map((c) => `${c.op}${normalizeVersion(c.version)}`))),
    };
}
/**
 * Lowest version that satisfies a range (npm semver.minVersion parity).
 *
 * npm algorithm, ported exactly: if 0.0.0 satisfies the range it is the answer,
 * then 0.0.0-0, then per alternative set the highest lower bound (a ">" bound
 * with no prerelease becomes patch+1, a prerelease bound gets ".0" appended) and
 * the smallest of those across alternatives. The candidate is only returned when
 * it actually satisfies the range, otherwise null — so unsatisfiable ranges
 * ("^0.1.4 ~3.0.2", ">2.0.0 <2.0.1") report null instead of a plausible-looking
 * bound.
 */
export function minVersionOfRange(range, includePrerelease = false) {
    const parsed = parseRangeSets(range);
    if (!parsed.ok)
        return parsed;
    const normalized = parsed.sets.map((set) => renderComparators(set)).join(' || ');
    const satisfies = (v) => {
        const result = satisfiesRange(v, range, includePrerelease);
        return result.ok && result.satisfied;
    };
    const zero = makeVersion(0, 0, 0, null);
    if (satisfies(zero))
        return { ok: true, value: { min: '0.0.0', normalized } };
    const zeroPre = makeVersion(0, 0, 0, '0');
    if (satisfies(zeroPre))
        return { ok: true, value: { min: '0.0.0-0', normalized } };
    let best = null;
    for (const comparators of parsed.sets) {
        let setMin = null;
        for (const comparator of comparators) {
            let candidate = null;
            if (comparator.op === '>') {
                // npm: a ">" bound with no prerelease bumps patch, a prerelease bound gains a ".0".
                const pre = comparator.version.prerelease;
                candidate = {
                    major: comparator.version.major,
                    minor: comparator.version.minor,
                    patch: pre === null || pre.length === 0 ? comparator.version.patch + 1 : comparator.version.patch,
                    prerelease: pre === null ? null : [...pre, '0'],
                    build: null,
                };
            }
            else if (comparator.op === '>=') {
                candidate = comparator.version;
            }
            if (candidate !== null && (setMin === null || compareVersions(candidate, setMin) > 0))
                setMin = candidate;
        }
        if (setMin !== null && (best === null || compareVersions(best, setMin) > 0))
            best = setMin;
    }
    if (best !== null && satisfies(best))
        return { ok: true, value: { min: normalizeVersion(best), normalized } };
    return { ok: true, value: { min: null, normalized } };
}
/** The comparator rendered the way npm writes it (e.g. ">=1.2.3"), for boundary special cases. */
function comparatorText(c) {
    return `${c.op}${normalizeVersion(c.version)}`;
}
/**
 * npm's Comparator.intersects — the pairwise rule Range.intersects is built on.
 * Exact comparators never appear here (this parser rewrites "1.2.3" into
 * ">=1.2.3 <=1.2.3"), so npm's empty-operator branch has no counterpart; an
 * empty AND-set (a bare wildcard) intersects with everything.
 */
function comparatorIntersects(a, b, includePrerelease) {
    const av = comparatorText(a);
    const bv = comparatorText(b);
    if (includePrerelease && (av === '<0.0.0-0' || bv === '<0.0.0-0'))
        return false;
    if (!includePrerelease && (av.startsWith('<0.0.0') || bv.startsWith('<0.0.0')))
        return false;
    if (a.op.startsWith('>') && b.op.startsWith('>'))
        return true;
    if (a.op.startsWith('<') && b.op.startsWith('<'))
        return true;
    const order = compareVersions(a.version, b.version);
    if (order === 0 && a.op.includes('=') && b.op.includes('='))
        return true;
    if (order < 0 && a.op.startsWith('>') && b.op.startsWith('<'))
        return true;
    if (order > 0 && a.op.startsWith('<') && b.op.startsWith('>'))
        return true;
    return false;
}
/** Every comparator of one AND-set intersects every comparator of the other (npm isSatisfiable + every/every). */
function setsIntersect(a, b, includePrerelease) {
    return a.every((x) => b.every((y) => comparatorIntersects(x, y, includePrerelease)));
}
/** npm's isSatisfiable: pairwise-intersect a set with itself. An empty set is satisfiable (wildcard). */
function isSatisfiableSet(set, includePrerelease) {
    const remaining = [...set];
    let test = remaining.pop();
    let result = true;
    while (result && remaining.length > 0 && test !== undefined) {
        const current = test;
        result = remaining.every((other) => comparatorIntersects(current, other, includePrerelease));
        test = remaining.pop();
    }
    return result;
}
/**
 * Whether any version satisfies both ranges (npm semver.intersects parity):
 * alternative sets are compared pairwise, and a pair only counts when both sets
 * are individually satisfiable.
 *
 * `witness` is best-effort, not minimal: boundary versions of the two ranges are
 * probed and each candidate is verified against BOTH ranges with this plugin's
 * own range matcher before it is reported (so a witness is never wrong, it can
 * only be absent).
 */
export function rangesIntersect(range1, range2, includePrerelease = false) {
    const first = parseRangeSets(range1);
    if (!first.ok)
        return first;
    const second = parseRangeSets(range2);
    if (!second.ok)
        return second;
    const normalized1 = first.sets.map((set) => renderComparators(set)).join(' || ');
    const normalized2 = second.sets.map((set) => renderComparators(set)).join(' || ');
    const intersects = first.sets.some((a) => isSatisfiableSet(a, includePrerelease) && second.sets.some((b) => isSatisfiableSet(b, includePrerelease) && setsIntersect(a, b, includePrerelease)));
    if (!intersects)
        return { ok: true, value: { intersects: false, normalized1, normalized2, witness: null } };
    const candidates = [];
    const push = (v) => {
        if (!candidates.some((c) => compareBuildVersions(c, v) === 0))
            candidates.push(v);
    };
    push(makeVersion(0, 0, 0, null));
    for (const sets of [first.sets, second.sets]) {
        for (const set of sets) {
            for (const comparator of set) {
                push(comparator.version);
                push({ ...comparator.version, patch: comparator.version.patch + 1 });
            }
        }
    }
    const min1 = minVersionOfRange(range1, includePrerelease);
    if (min1.ok && min1.value.min !== null) {
        const parsedMin = parseVersion(min1.value.min);
        if (parsedMin.ok)
            push(parsedMin.value);
    }
    const min2 = minVersionOfRange(range2, includePrerelease);
    if (min2.ok && min2.value.min !== null) {
        const parsedMin = parseVersion(min2.value.min);
        if (parsedMin.ok)
            push(parsedMin.value);
    }
    let witness = null;
    for (const candidate of candidates) {
        const inFirst = satisfiesRange(candidate, range1, includePrerelease);
        const inSecond = satisfiesRange(candidate, range2, includePrerelease);
        if (inFirst.ok && inFirst.satisfied && inSecond.ok && inSecond.satisfied) {
            witness = normalizeVersion(candidate);
            break;
        }
    }
    return { ok: true, value: { intersects: true, normalized1, normalized2, witness } };
}
/* ------------------------------------------------------------------ *
 * v0.4.0 — coerce (version out of messy text) / outside (gtr & ltr)    *
 * ------------------------------------------------------------------ */
/**
 * npm's coerce() pattern, ported verbatim: a non-digit boundary, then 1–16
 * digits for each of up to three components, then a trailing non-digit or the
 * end of the string. The trailing boundary is *consumed* by the match, exactly
 * as in npm — which is why "1.2.3.4" coerces to "1.2.3" and "9.8.7.6.5" to
 * "9.8.7".
 */
const COERCE_CORE = String.raw `(^|[^\d])(\d{1,16})(?:\.(\d{1,16}))?(?:\.(\d{1,16}))?`;
const COERCE_RE = new RegExp(`${COERCE_CORE}(?:$|[^\\d])`);
/**
 * Pull a version out of arbitrary text (npm `semver.coerce`, default options).
 *
 * `"node v18.16.1"` → 18.16.1, `"42"` → 42.0.0, `"1.2"` → 1.2.0,
 * `"1.2.3-beta.1"` → 1.2.3 (npm's default drops prerelease/build metadata),
 * `"x.y.z"` → no version at all, and `"changelog 2026-10-12: 4.5.6"` → 2026.0.0
 * (the date comes first — coerced numbers are not "the version you meant").
 *
 * Two npm behaviours are surfaced rather than papered over: when the text has no
 * version-like number the result is `version: null` (npm returns null too), and
 * a matched number above `Number.MAX_SAFE_INTEGER` is *also* null to npm — its
 * `parse()` swallows the `Invalid major version` error — so this returns null
 * plus a `note` saying why, instead of inventing a rounded number.
 */
export function coerceVersion(input) {
    const match = COERCE_RE.exec(input);
    if (match === null)
        return { ok: true, value: { version: null, major: null, minor: null, patch: null, note: null } };
    const majorRaw = match[2] ?? '0';
    const minorRaw = match[3] ?? '0';
    const patchRaw = match[4] ?? '0';
    const coerced = `${majorRaw}.${minorRaw}.${patchRaw}`;
    const parsed = parseVersion(coerced);
    const outOfRange = (value) => value > Number.MAX_SAFE_INTEGER;
    if (!parsed.ok || outOfRange(Number(majorRaw)) || outOfRange(Number(minorRaw)) || outOfRange(Number(patchRaw))) {
        // npm: `parse()` returns null when the SemVer constructor throws, so a
        // 16-digit component is simply "not a version" — report that, with the why.
        return {
            ok: true,
            value: {
                version: null,
                major: null,
                minor: null,
                patch: null,
                note: `the first version-like number in the input ("${coerced}") is not a version npm can represent (${parsed.ok ? 'a component is above Number.MAX_SAFE_INTEGER' : parsed.reason})`,
            },
        };
    }
    return {
        ok: true,
        value: {
            version: normalizeVersion(parsed.value),
            major: parsed.value.major,
            minor: parsed.value.minor,
            patch: parsed.value.patch,
            note: null,
        },
    };
}
/** npm substitutes this for a wildcard comparator inside outside(): `>=0.0.0`. */
const ANY_COMPARATOR = { op: '>=', version: { major: 0, minor: 0, patch: 0, prerelease: null, build: null } };
/**
 * npm's `outside(version, range, hilo)` — "is this version above (or below)
 * every version the range accepts?" — ported comparator by comparator.
 *
 * Reads `comparator.op` the way npm does, so it needs npm's comparator shape
 * (`npmShape`) rather than the `[<=, >=]` pair the matcher uses; a wildcard
 * AND-set (this parser's empty set) stands in for npm's `ANY` comparator.
 */
function outsideOneWay(version, sets, hilo) {
    const gtfn = (a, b) => hilo === '>' ? compareVersions(a, b) > 0 : compareVersions(a, b) < 0;
    const ltfn = (a, b) => hilo === '>' ? compareVersions(a, b) < 0 : compareVersions(a, b) > 0;
    const ltefn = (a, b) => hilo === '>' ? compareVersions(a, b) <= 0 : compareVersions(a, b) >= 0;
    const comp = hilo;
    const ecomp = hilo === '>' ? '>=' : '<=';
    for (const rawSet of sets) {
        const set = rawSet.length === 0 ? [ANY_COMPARATOR] : rawSet;
        let high = null;
        let low = null;
        for (const comparator of set) {
            if (high === null)
                high = comparator;
            if (low === null)
                low = comparator;
            if (high !== null && gtfn(comparator.version, high.version))
                high = comparator;
            else if (low !== null && ltfn(comparator.version, low.version))
                low = comparator;
        }
        if (high === null || low === null)
            continue;
        if (high.op === comp || high.op === ecomp)
            return false;
        if ((low.op === '' || low.op === comp) && ltefn(version, low.version))
            return false;
        else if (low.op === ecomp && ltfn(version, low.version))
            return false;
    }
    return true;
}
/**
 * npm `semver.gtr` / `semver.ltr` in one call: a version sits **above** all the
 * versions a range accepts, **below** all of them, **inside** the range, or in
 * a **gap** between alternatives (`^1.0.0 || ^3.0.0` with 2.0.0: not inside,
 * yet neither above nor below — npm reports false for both directions).
 *
 * npm's own quirks are preserved and surfaced rather than hidden: a prerelease
 * is never matched by a plain range (tuple-lock), so `outside()` classifies it
 * as above/below even though it is neither semantically (e.g. npm reports
 * `gtr("1.2.3-beta.1", "<=1.2.3") === true`). The caller can tell that apart
 * from an ordinary answer because `satisfies`, `above` and `below` are all
 * reported — this function invents no verdict of its own.
 */
export function outsideRange(version, range, includePrerelease = false) {
    const parsedVersion = parseVersion(version);
    if (!parsedVersion.ok)
        return parsedVersion;
    const parsedSets = parseRangeSets(range, true);
    if (!parsedSets.ok)
        return parsedSets;
    const value = parsedVersion.value;
    const satisfied = satisfiesRange(value, range, includePrerelease);
    if (!satisfied.ok)
        return satisfied;
    const normalized = parsedSets.sets.map((set) => renderComparators(set)).join(' || ');
    if (satisfied.satisfied) {
        return { ok: true, value: { satisfies: true, above: false, below: false, normalized } };
    }
    return {
        ok: true,
        value: {
            satisfies: false,
            above: outsideOneWay(value, parsedSets.sets, '>'),
            below: outsideOneWay(value, parsedSets.sets, '<'),
            normalized,
        },
    };
}
/* ------------------------------------------------------------------ *
 * v0.2.0 — increment / difference / sort (npm semver 7.x parity)      *
 * ------------------------------------------------------------------ */
/** Release types supported by semver_inc (npm semver.inc). */
export const INC_RELEASES = ['major', 'minor', 'patch', 'premajor', 'preminor', 'prepatch', 'prerelease'];
/** A single prerelease/build identifier (dot-separated body per npm's identifier validation). */
const IDENTIFIER_RE = /^(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*$/;
const NUMERIC_RE = /^\d+$/;
/** Compare two identifiers, numeric before alphanumeric (npm compareIdentifiers). */
export function compareIdentifiers(a, b) {
    const aNum = NUMERIC_RE.test(a);
    const bNum = NUMERIC_RE.test(b);
    if (aNum && bNum) {
        const an = Number(a);
        const bn = Number(b);
        return an === bn ? 0 : an < bn ? -1 : 1;
    }
    if (aNum !== bNum)
        return aNum ? -1 : 1;
    return a === b ? 0 : a < b ? -1 : 1;
}
/** Precedence comparison with build-metadata tie-break (npm compareBuild). */
export function compareBuildVersions(a, b) {
    const precedence = compareVersions(a, b);
    if (precedence !== 0)
        return precedence;
    const ab = a.build;
    const bb = b.build;
    if (ab === null && bb === null)
        return 0;
    if (ab === null)
        return -1;
    if (bb === null)
        return 1;
    const len = Math.max(ab.length, bb.length);
    for (let i = 0; i < len; i++) {
        const x = ab[i];
        const y = bb[i];
        if (x === undefined && y === undefined)
            return 0;
        if (x === undefined)
            return -1;
        if (y === undefined)
            return 1;
        const d = compareIdentifiers(x, y);
        if (d !== 0)
            return d;
    }
    return 0;
}
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
export function incVersion(input, release, identifier) {
    if (!INC_RELEASES.includes(release)) {
        return { ok: false, reason: `invalid release type: "${release}" (expected one of ${INC_RELEASES.join('/')})` };
    }
    const id = identifier !== undefined && identifier !== '' ? identifier : undefined;
    if (id !== undefined && release.startsWith('pre') && !IDENTIFIER_RE.test(id)) {
        return { ok: false, reason: `invalid identifier: "${id}" (dot-separated [0-9A-Za-z-] tokens, no leading zeros)` };
    }
    const parsed = parseVersion(input);
    if (!parsed.ok)
        return parsed;
    const v = parsed.value;
    let major = v.major;
    let minor = v.minor;
    let patch = v.patch;
    let pre = v.prerelease === null ? [] : [...v.prerelease];
    const hasPre = pre.length > 0;
    switch (release) {
        case 'premajor':
            pre = [];
            patch = 0;
            minor = 0;
            major++;
            pre = bumpPre(pre, id);
            break;
        case 'preminor':
            pre = [];
            patch = 0;
            minor++;
            pre = bumpPre(pre, id);
            break;
        case 'prepatch':
            pre = []; // npm clears the prerelease first, so patch always increments
            patch++;
            pre = bumpPre(pre, id);
            break;
        case 'prerelease':
            if (!hasPre)
                patch++; // acts like prepatch when the input is a plain release
            pre = bumpPre(pre, id);
            break;
        case 'major':
            if (minor !== 0 || patch !== 0 || !hasPre)
                major++;
            minor = 0;
            patch = 0;
            pre = [];
            break;
        case 'minor':
            if (patch !== 0 || !hasPre)
                minor++;
            patch = 0;
            pre = [];
            break;
        case 'patch':
            if (!hasPre)
                patch++;
            pre = [];
            break;
    }
    const next = normalizeVersion({ major, minor, patch, prerelease: pre.length > 0 ? pre : null, build: null });
    const from = normalizeVersion(v);
    return { ok: true, value: { from, next, rule: `bump ${release}${id !== undefined ? ` (identifier ${id})` : ''}: ${from} → ${next}` } };
}
/** npm's internal "pre" increment (base identifier 0). */
function bumpPre(pre, identifier) {
    if (pre.length === 0) {
        pre = ['0'];
    }
    else {
        let bumped = false;
        for (let i = pre.length - 1; i >= 0; i--) {
            const token = pre[i] ?? '';
            if (NUMERIC_RE.test(token)) {
                pre[i] = String(Number(token) + 1);
                bumped = true;
                break;
            }
        }
        if (!bumped)
            pre.push('0');
    }
    if (identifier !== undefined) {
        const candidate = [...identifier.split('.'), '0'];
        if (compareIdentifiers(pre[0] ?? '', identifier) === 0) {
            const second = pre[1];
            if (second === undefined || Number.isNaN(Number(second))) {
                pre = candidate;
            }
        }
        else {
            pre = candidate;
        }
    }
    return pre;
}
/**
 * Release-type difference between two versions (npm semver.diff semantics).
 * Returns null when precedence is equal (build metadata ignored). npm special
 * cases: prerelease → release of the same main version is patch (or minor when
 * the low version is a pre-minor, or major when it is a pre-major), and a
 * difference whose higher side is a prerelease gets the "pre" prefix.
 */
export function diffKind(a, b) {
    const comparison = compareVersions(a, b);
    if (comparison === 0)
        return null;
    const aHigher = comparison > 0;
    const high = aHigher ? a : b;
    const low = aHigher ? b : a;
    const highHasPre = high.prerelease !== null && high.prerelease.length > 0;
    const lowHasPre = low.prerelease !== null && low.prerelease.length > 0;
    if (lowHasPre && !highHasPre) {
        if (low.patch === 0 && low.minor === 0)
            return 'major';
        if (low.major === high.major && low.minor === high.minor && low.patch === high.patch) {
            if (low.minor !== 0 && low.patch === 0)
                return 'minor';
            return 'patch';
        }
    }
    const prefix = highHasPre ? 'pre' : '';
    if (a.major !== b.major)
        return (prefix + 'major');
    if (a.minor !== b.minor)
        return (prefix + 'minor');
    if (a.patch !== b.patch)
        return (prefix + 'patch');
    return 'prerelease';
}
/**
 * Sort version strings by precedence (npm semver.sort / rsort), using build
 * metadata as tie-break (npm compareBuild). Invalid entries are skipped and
 * reported with their input index; valid entries are still sorted.
 */
export function sortVersionStrings(inputs, order = 'asc') {
    if (inputs.length === 0)
        return { ok: true, value: { sorted: [], invalid: [] } };
    const entries = [];
    const invalid = [];
    inputs.forEach((input, index) => {
        const result = parseVersion(input);
        if (!result.ok)
            invalid.push({ index, input, reason: result.reason });
        else
            entries.push({ value: result.value, normalized: normalizeVersion(result.value) });
    });
    entries.sort((x, y) => {
        const d = compareBuildVersions(x.value, y.value);
        return order === 'desc' ? -d : d;
    });
    return { ok: true, value: { sorted: entries.map((e) => e.normalized), invalid } };
}
const RELATION_WORD = {
    lt: 'lower than',
    eq: 'equal to',
    gt: 'greater than',
};
/**
 * Explain why a version does or does not satisfy an npm-style range: every
 * alternative (`||` branch) is broken down into its comparators, each one
 * resolved to accepted/rejected plus the precedence that decided it, and the
 * prerelease tuple-lock is reported separately from comparator failures.
 *
 * This is the diagnostic `satisfiesRange` cannot give: "does not satisfy" is
 * the same answer whether a bound was missed by one patch or the candidate is
 * a prerelease that no plain range can ever match.
 */
export function explainRange(version, range, includePrerelease = false) {
    const trimmed = range.trim();
    if (trimmed === '')
        return { ok: false, reason: 'invalid range: empty string' };
    const sets = [];
    for (const alt of trimmed.split('||')) {
        // Explain with **npm's** comparator shape (`npmShape`), so the labels match
        // what a resolver actually builds: `^1.2.3` → `>=1.2.3 <2.0.0-0`. The
        // matcher itself uses the `<2.0.0` form and relies on the tuple-lock, which
        // is why reporting the matcher's shape here would misdescribe npm.
        const expanded = expandAlternative(alt, true);
        if (!expanded.ok)
            return expanded;
        const comparators = expanded.comparators;
        const verdicts = comparators.map((c) => ({
            comparator: `${c.op}${normalizeVersion(c.version)}`,
            bound: normalizeVersion(c.version),
            relation: relationLabel(version, c.version),
            ok: cmp(version, c),
        }));
        const candidateIsPrerelease = version.prerelease !== null && version.prerelease.length > 0;
        const tupleLockActive = candidateIsPrerelease && !includePrerelease;
        // Comparators are reported in the same canonical order the label uses.
        verdicts.sort((a, b) => (a.comparator < b.comparator ? -1 : 1));
        const pinning = comparators.find((c) => c.version.prerelease !== null && tupleOf(c.version) === tupleOf(version));
        const prereleaseAllowed = !tupleLockActive || pinning !== undefined;
        const rejectedBy = verdicts.filter((v) => !v.ok).map((v) => v.comparator);
        sets.push({
            label: renderComparators(comparators),
            ok: prereleaseAllowed && rejectedBy.length === 0,
            rejectedBy,
            comparators: verdicts,
            candidateIsPrerelease,
            tupleLockActive,
            prereleaseAllowed,
            pinnedTuple: pinning === undefined ? null : tupleOf(pinning.version),
        });
    }
    const satisfied = sets.some((s) => s.ok);
    const normalized = sets.map((s) => s.label).join(' || ');
    const rendered = normalizeVersion(version);
    let because;
    if (satisfied) {
        const via = sets.find((s) => s.ok);
        because = `${rendered} satisfies "${trimmed}" via the alternative "${via.label}"${sets.length > 1 ? ` (${sets.length} alternatives checked)` : ''}`;
    }
    else {
        // Report the closest alternative: fewest rejected comparators, ties by order.
        const closest = sets.reduce((best, s) => (s.rejectedBy.length < best.rejectedBy.length ? s : best), sets[0]);
        if (closest.rejectedBy.length === 0) {
            because = `${rendered} meets every comparator of "${closest.label}" but npm's prerelease rule rejects it: the candidate is a prerelease and no comparator in that alternative pins ${tupleOf(version)}-x (tuple-lock). Widen the range to ${tupleOf(version)}-0 or compare with includePrerelease`;
        }
        else {
            const details = closest.comparators
                .filter((c) => !c.ok)
                .map((c) => `${c.comparator} (${rendered} is ${RELATION_WORD[c.relation]} ${c.bound})`)
                .join(', ');
            because = `${rendered} does not satisfy "${trimmed}"; closest alternative "${closest.label}" rejects ${closest.rejectedBy.length} of ${closest.comparators.length} comparators: ${details}`;
        }
    }
    return { ok: true, value: { satisfied, normalized, sets, because } };
}
//# sourceMappingURL=semver.js.map