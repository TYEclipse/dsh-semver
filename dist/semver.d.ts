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
    major: number;
    minor: number;
    patch: number;
    /** Prerelease identifiers (e.g. ["beta", "2"]), or null when absent. */
    prerelease: readonly string[] | null;
    /** Build metadata identifiers (e.g. ["build", "5"]), or null when absent. */
    build: readonly string[] | null;
}
/** Parse a semver string. Returns ok:false with a reason for invalid input. */
export declare function parseVersion(input: string): {
    ok: true;
    value: ParsedVersion;
} | {
    ok: false;
    reason: string;
};
/** Normalize a parsed version back to a canonical string (build metadata preserved). */
export declare function normalizeVersion(value: ParsedVersion): string;
/**
 * Compare two parsed versions per semver 2.0.0 precedence.
 * Returns -1 (a < b), 0 (equal precedence), or 1 (a > b). Build metadata is ignored.
 */
export declare function compareVersions(a: ParsedVersion, b: ParsedVersion): number;
/**
 * Check whether a version satisfies an npm-style range.
 * Supports: exact, =, >, >=, <, <=, ^, ~, wildcards (1.2.x, 1.x, *), hyphen
 * ranges (1.2.3 - 2.3.4), AND (space) and OR (||). Build metadata in range
 * tokens is ignored.
 */
export declare function satisfiesRange(version: ParsedVersion, range: string, includePrerelease?: boolean): {
    ok: true;
    satisfied: boolean;
    normalized: string;
} | {
    ok: false;
    reason: string;
};
/** Human-readable relation between two versions. */
export declare function relationLabel(a: ParsedVersion, b: ParsedVersion): 'lt' | 'eq' | 'gt';
/**
 * npm's own comparator shape for a range, as strings (`"npmRangeSets('^1.2.3')"`
 * → `[['>=1.2.3', '<2.0.0-0']]`, a wildcard set → `[['ANY']]`). Exposed for the
 * oracle sweep: it lets the test compare this parser against
 * `new (require('semver').Range)(range).set` comparator for comparator instead
 * of only through verdicts — the shape is what `outsideRange` walks.
 */
export declare function npmRangeSets(range: string): {
    ok: true;
    sets: string[][];
} | {
    ok: false;
    reason: string;
};
export type MinVersionResult = {
    ok: true;
    value: {
        min: string | null;
        normalized: string;
    };
} | {
    ok: false;
    reason: string;
};
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
export declare function minVersionOfRange(range: string, includePrerelease?: boolean): MinVersionResult;
export type IntersectResult = {
    ok: true;
    value: {
        intersects: boolean;
        normalized1: string;
        normalized2: string;
        witness: string | null;
    };
} | {
    ok: false;
    reason: string;
};
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
export declare function rangesIntersect(range1: string, range2: string, includePrerelease?: boolean): IntersectResult;
export type CoerceResult = {
    ok: true;
    value: {
        version: string;
        major: number;
        minor: number;
        patch: number;
        note: null;
    };
} | {
    ok: true;
    value: {
        version: null;
        major: null;
        minor: null;
        patch: null;
        note: string | null;
    };
} | {
    ok: false;
    reason: string;
};
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
export declare function coerceVersion(input: string): CoerceResult;
export type OutsideResult = {
    ok: true;
    value: {
        satisfies: boolean;
        above: boolean;
        below: boolean;
        normalized: string;
    };
} | {
    ok: false;
    reason: string;
};
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
export declare function outsideRange(version: string, range: string, includePrerelease?: boolean): OutsideResult;
/** Release types supported by semver_inc (npm semver.inc). */
export declare const INC_RELEASES: readonly ["major", "minor", "patch", "premajor", "preminor", "prepatch", "prerelease"];
export type IncRelease = (typeof INC_RELEASES)[number];
/** Release-type difference between two versions (npm semver.diff). */
export type DiffKind = 'major' | 'minor' | 'patch' | 'premajor' | 'preminor' | 'prepatch' | 'prerelease';
/** Compare two identifiers, numeric before alphanumeric (npm compareIdentifiers). */
export declare function compareIdentifiers(a: string, b: string): number;
/** Precedence comparison with build-metadata tie-break (npm compareBuild). */
export declare function compareBuildVersions(a: ParsedVersion, b: ParsedVersion): number;
export type IncResult = {
    ok: true;
    value: {
        from: string;
        next: string;
        rule: string;
    };
} | {
    ok: false;
    reason: string;
};
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
export declare function incVersion(input: string, release: string, identifier?: string): IncResult;
/**
 * Release-type difference between two versions (npm semver.diff semantics).
 * Returns null when precedence is equal (build metadata ignored). npm special
 * cases: prerelease → release of the same main version is patch (or minor when
 * the low version is a pre-minor, or major when it is a pre-major), and a
 * difference whose higher side is a prerelease gets the "pre" prefix.
 */
export declare function diffKind(a: ParsedVersion, b: ParsedVersion): DiffKind | null;
export type SortResult = {
    ok: true;
    value: {
        sorted: string[];
        invalid: {
            index: number;
            input: string;
            reason: string;
        }[];
    };
} | {
    ok: false;
    reason: string;
};
/**
 * Sort version strings by precedence (npm semver.sort / rsort), using build
 * metadata as tie-break (npm compareBuild). Invalid entries are skipped and
 * reported with their input index; valid entries are still sorted.
 */
export declare function sortVersionStrings(inputs: readonly string[], order?: 'asc' | 'desc'): SortResult;
//# sourceMappingURL=semver.d.ts.map