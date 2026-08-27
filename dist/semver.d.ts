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