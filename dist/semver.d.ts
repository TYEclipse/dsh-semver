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
//# sourceMappingURL=semver.d.ts.map