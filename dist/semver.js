/**
 * dsh-semver — semantic versioning toolbox for DeepSeek Harness.
 *
 * Three deterministic tools, zero runtime dependencies (pure logic):
 *   semver_parse      — parse a version string into major/minor/patch/prerelease/build
 *   semver_compare    — compare two versions (lt / eq / gt) with a human verdict
 *   semver_satisfies  — check a version against an npm-style range (^ ~ >= <= > < = x-ranges, hyphen, ||, AND)
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
/** Parse a single comparator token into [lower, upper] comparators. */
function parseToken(token) {
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
    const upper = (v) => ({ op: '<', version: v });
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
        return { ok: true, comparators: [upperInc(v), lower(v)] };
    }
    if (op === '>=' || op === '<=' || op === '>' || op === '<') {
        if (isX(rawMajor) || isX(rawMinor) || isX(rawPatch)) {
            return { ok: false, reason: `invalid range: "${op}" cannot be combined with wildcard versions` };
        }
        const v = makeVersion(Number(rawMajor), Number(rawMinor), Number(rawPatch), preRaw);
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
    const base = makeVersion(major, minor ?? 0, 0, preRaw);
    const upperBound = minor !== undefined ? makeVersion(major, minor + 1, 0, null) : makeVersion(major + 1, 0, 0, null);
    return { ok: true, comparators: [lower(base), upper(upperBound)] };
}
/** Expand one range alternative (a space-separated comparator set) into comparators. */
function expandAlternative(alt) {
    const trimmed = alt.trim();
    if (trimmed === '')
        return { ok: true, comparators: [] };
    const hyphen = HYPHEN_RE.exec(trimmed);
    if (hyphen !== null) {
        // Hyphen ranges must stand alone in their alternative.
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
            // Partial upper endpoint → exclusive, one unit past the last specified component.
            const hiUpper = hi.comparators[1];
            if (hiUpper === undefined)
                return { ok: false, reason: `invalid range: cannot parse upper endpoint "${hiToken}"` };
            comparators.push({ op: '<', version: hiUpper.version });
        }
        else {
            return { ok: false, reason: `invalid range: hyphen endpoints "${loToken}" / "${hiToken}" must be plain versions` };
        }
        return { ok: true, comparators };
    }
    const tokens = trimmed.split(/\s+/);
    const comparators = [];
    for (const token of tokens) {
        const parsed = parseToken(token);
        if (!parsed.ok)
            return parsed;
        comparators.push(...parsed.comparators);
    }
    return { ok: true, comparators };
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
//# sourceMappingURL=semver.js.map