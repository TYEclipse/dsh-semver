/**
 * Tool definitions for dsh-semver: six deterministic version tools exposed to
 * every agent via defineTool. Each tool has a strict JSON-schema parameter
 * surface and a compact text renderer. All outputs are lossless JSON — absent
 * fields are omitted or null, never undefined (the dsh-tools output gate).
 *
 * @module dsh-semver/tools
 */

import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import {
  diffKind,
  incVersion,
  INC_RELEASES,
  normalizeVersion,
  parseVersion,
  relationLabel,
  satisfiesRange,
  sortVersionStrings,
  type DiffKind,
} from './semver.ts'
import type { ResolvedConfig } from './index.ts'

export interface ToolSet {
  semver_parse: ToolDefinition
  semver_compare: ToolDefinition
  semver_satisfies: ToolDefinition
  semver_inc: ToolDefinition
  semver_diff: ToolDefinition
  semver_sort: ToolDefinition
}

function renderParse(value: unknown): string {
  const result = value as { valid: boolean; input: string; reason?: string; normalized?: string; major?: number; minor?: number; patch?: number; prerelease?: readonly string[] | null; build?: readonly string[] | null }
  if (!result.valid) return `invalid version "${result.input}": ${result.reason ?? 'unknown reason'}`
  const pre = result.prerelease === null || result.prerelease === undefined ? '' : ` prerelease [${result.prerelease.join(', ')}]`
  const build = result.build === null || result.build === undefined ? '' : ` build [${result.build.join(', ')}]`
  return `${result.normalized} → major ${result.major}, minor ${result.minor}, patch ${result.patch}${pre}${build}`
}

function renderCompare(value: unknown): string {
  const result = value as { valid: boolean; left: string; right: string; verdict?: string; reason?: string }
  if (!result.valid) return `cannot compare "${result.left}" vs "${result.right}": ${result.reason ?? 'unknown reason'}`
  return result.verdict ?? ''
}

function renderSatisfies(value: unknown): string {
  const result = value as { valid: boolean; version: string; range: string; satisfied?: boolean; explanation?: string; reason?: string }
  if (!result.valid) return `cannot check "${result.version}" against "${result.range}": ${result.reason ?? 'unknown reason'}`
  return result.explanation ?? ''
}

function renderInc(value: unknown): string {
  const result = value as { valid: boolean; version: string; release: string; next?: string; rule?: string; reason?: string }
  if (!result.valid) return `cannot increment "${result.version}" by ${result.release}: ${result.reason ?? 'unknown reason'}`
  return `${result.version} +${result.release} → ${result.next ?? ''}${result.rule ? ` (${result.rule})` : ''}`
}

function renderDiff(value: unknown): string {
  const result = value as { valid: boolean; left: string; right: string; equal?: boolean; difference?: string; explanation?: string; reason?: string }
  if (!result.valid) return `cannot diff "${result.left}" vs "${result.right}": ${result.reason ?? 'unknown reason'}`
  return result.explanation ?? ''
}

function renderSort(value: unknown): string {
  const result = value as { valid: boolean; count: number; order: string; sorted: string[]; invalidCount?: number; invalid?: string[]; reason?: string }
  if (result.count === 0) {
    const invalidNote = result.invalidCount ? ` (${result.invalidCount} invalid entries skipped)` : ''
    return `no valid versions to sort${invalidNote}`
  }
  const base = `${result.sorted.join(', ')}`
  return result.invalidCount ? `${base} — skipped ${result.invalidCount} invalid` : base
}

/** Build all three tool definitions from the resolved config. */
export function buildSemverTools(config: ResolvedConfig): ToolSet {
  const semver_parse = defineTool({
    name: 'semver_parse',
    description: 'Parse a Semantic Versioning 2.0.0 string (e.g. "1.2.3-beta.1+build.5") into its components: '
      + 'major, minor, patch, prerelease identifiers and build metadata. Accepts an optional "v" or "=" prefix. '
      + 'Returns valid:false with a reason for malformed input (e.g. "1.2", "1.2.3.4", leading zeros). '
      + 'Deterministic, read-only, no network.',
    parameters: {
      version: { type: 'string', required: true, description: 'Version string to parse, e.g. "2.1.0-rc.1+build.42".' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          valid: { type: 'boolean', required: true },
          input: { type: 'string', required: true },
          version: { type: 'string' },
          core: { type: 'string' },
          major: { type: 'number' },
          minor: { type: 'number' },
          patch: { type: 'number' },
          prerelease: { type: 'array', items: { type: 'string' } },
          build: { type: 'array', items: { type: 'string' } },
          normalized: { type: 'string' },
          reason: { type: 'string' },
        },
      },
      render: (_args: { version: string }, value: unknown) => [{ type: 'text', text: renderParse(value) }],
    },
    async execute(args: { version: string }) {
      const parsed = parseVersion(args.version)
      if (!parsed.ok) {
        return { valid: false, input: args.version, reason: parsed.reason }
      }
      const value = parsed.value
      const normalized = normalizeVersion(value)
      const out: {
        valid: boolean
        input: string
        version?: string
        core?: string
        major?: number
        minor?: number
        patch?: number
        prerelease?: string[]
        build?: string[]
        normalized?: string
        reason?: string
      } = {
        valid: true,
        input: args.version,
        version: normalized,
        core: `${value.major}.${value.minor}.${value.patch}`,
        major: value.major,
        minor: value.minor,
        patch: value.patch,
        normalized,
      }
      if (value.prerelease !== null) out.prerelease = [...value.prerelease]
      if (value.build !== null) out.build = [...value.build]
      return out
    },
  })

  const semver_compare = defineTool({
    name: 'semver_compare',
    description: 'Compare two Semantic Versioning 2.0.0 strings and report which one is newer. Follows the spec: '
      + 'prereleases sort below their release (1.0.0-alpha < 1.0.0), numeric prerelease identifiers sort before '
      + 'alphanumeric ones (1.0.0-alpha.1 < 1.0.0-alpha.beta), and build metadata is ignored for precedence '
      + '(1.0.0+build.1 == 1.0.0). Returns lt / eq / gt plus a human verdict. Deterministic, read-only, no network.',
    parameters: {
      left: { type: 'string', required: true, description: 'First version, e.g. "2.1.0-rc.1".' },
      right: { type: 'string', required: true, description: 'Second version, e.g. "2.1.0".' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          valid: { type: 'boolean', required: true },
          left: { type: 'string', required: true },
          right: { type: 'string', required: true },
          relation: { type: 'string', enum: ['lt', 'eq', 'gt'] },
          equal: { type: 'boolean' },
          verdict: { type: 'string' },
          reason: { type: 'string' },
        },
      },
      render: (_args: { left: string; right: string }, value: unknown) => [{ type: 'text', text: renderCompare(value) }],
    },
    async execute(args: { left: string; right: string }) {
      const a = parseVersion(args.left)
      if (!a.ok) return { valid: false, left: args.left, right: args.right, reason: `left ${a.reason}` }
      const b = parseVersion(args.right)
      if (!b.ok) return { valid: false, left: args.left, right: args.right, reason: `right ${b.reason}` }
      const relation = relationLabel(a.value, b.value)
      return {
        valid: true,
        left: args.left,
        right: args.right,
        relation,
        equal: relation === 'eq',
        verdict: `${normalizeVersion(a.value)} ${relation === 'lt' ? '<' : relation === 'gt' ? '>' : '=='} ${normalizeVersion(b.value)}`,
      }
    },
  })

  const semver_satisfies = defineTool({
    name: 'semver_satisfies',
    description: 'Check whether a version satisfies an npm-style range. Supported range syntax: exact ("1.2.3", "=1.2.3"), '
      + 'comparisons (">1.2.0", ">=1.2.0", "<2.0.0", "<=2.0.0"), caret ("^1.2.3" → >=1.2.3 <2.0.0, with 0.x rules), '
      + 'tilde ("~1.2.3" → >=1.2.3 <1.3.0), wildcards ("1.2.x", "1.x", "*"), hyphen ranges ("1.2.3 - 2.3.4", partial '
      + 'endpoints allowed), AND (space-separated) and OR ("||"). Follows npm prerelease semantics: a range with a '
      + 'prerelease lower bound only matches prereleases of the same [major, minor, patch] tuple (tuple-lock), and a '
      + 'plain release range never matches prerelease versions unless includePrerelease is true. Deterministic, read-only.',
    parameters: {
      version: { type: 'string', required: true, description: 'Version to test, e.g. "2.1.0-beta.3".' },
      range: { type: 'string', required: true, description: 'Range expression, e.g. "^2.0.0 || >=3.1.0".' },
      includePrerelease: { type: 'boolean', description: `Also match prerelease versions when the range itself has no prerelease (default ${config.includePrerelease}).` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          valid: { type: 'boolean', required: true },
          version: { type: 'string', required: true },
          range: { type: 'string', required: true },
          satisfied: { type: 'boolean' },
          explanation: { type: 'string' },
          reason: { type: 'string' },
        },
      },
      render: (_args: { version: string; range: string }, value: unknown) => [{ type: 'text', text: renderSatisfies(value) }],
    },
    async execute(args: { version: string; range: string; includePrerelease?: boolean }) {
      const parsed = parseVersion(args.version)
      if (!parsed.ok) return { valid: false, version: args.version, range: args.range, reason: parsed.reason }
      const result = satisfiesRange(parsed.value, args.range, args.includePrerelease ?? config.includePrerelease)
      if (!result.ok) return { valid: false, version: args.version, range: args.range, reason: result.reason }
      const verb = result.satisfied ? 'satisfies' : 'does NOT satisfy'
      return {
        valid: true,
        version: normalizeVersion(parsed.value),
        range: args.range,
        satisfied: result.satisfied,
        explanation: `${normalizeVersion(parsed.value)} ${verb} "${args.range}" (normalized: ${result.normalized})`,
      }
    },
  })

  const semver_inc = defineTool({
    name: 'semver_inc',
    description: 'Increment a Semantic Versioning 2.0.0 string following npm semver.inc rules. Releases: major, minor, patch, premajor, preminor, prepatch, prerelease. Optional identifier names prerelease bumps ("beta" on "1.2.3" → "1.2.4-beta.0"; "prerelease" on "1.2.4-beta.0" → "1.2.4-beta.1"; a different identifier restarts the counter). npm semantics: "1.0.0-5" + major → "1.0.0" (pre-major release), "1.2.0-5" + prerelease → "1.2.0-6" (no patch bump), build metadata is dropped. Deterministic, read-only, no network.',
    parameters: {
      version: { type: 'string', required: true, description: 'Version to increment, e.g. "1.2.4-beta.0".' },
      release: { type: 'string', enum: [...INC_RELEASES], required: true, description: 'Release type to bump: major / minor / patch / premajor / preminor / prepatch / prerelease.' },
      identifier: { type: 'string', description: 'Prerelease identifier for pre* bumps, e.g. "beta" (dot-separated tokens allowed, no leading zeros). Ignored for major/minor/patch.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          valid: { type: 'boolean', required: true },
          version: { type: 'string', required: true },
          release: { type: 'string', required: true },
          identifier: { type: 'string' },
          next: { type: 'string' },
          rule: { type: 'string' },
          reason: { type: 'string' },
        },
      },
      render: (_args: { version: string; release: string; identifier?: string }, value: unknown) => [{ type: 'text', text: renderInc(value) }],
    },
    async execute(args: { version: string; release: string; identifier?: string }) {
      const result = incVersion(args.version, args.release, args.identifier)
      if (!result.ok) {
        const out: { valid: boolean; version: string; release: string; identifier?: string; reason?: string } = {
          valid: false,
          version: args.version,
          release: args.release,
          reason: result.reason,
        }
        if (args.identifier !== undefined) out.identifier = args.identifier
        return out
      }
      const out: { valid: boolean; version: string; release: string; identifier?: string; next?: string; rule?: string } = {
        valid: true,
        version: result.value.from,
        release: args.release,
        next: result.value.next,
        rule: result.value.rule,
      }
      if (args.identifier !== undefined) out.identifier = args.identifier
      return out
    },
  })

  const semver_diff = defineTool({
    name: 'semver_diff',
    description: 'Report the release-type difference between two Semantic Versioning 2.0.0 strings (npm semver.diff): major / minor / patch, with a "pre" prefix when the target is a prerelease (premajor / preminor / prepatch), or "prerelease" when only the prerelease changed. npm special cases: "1.2.3" vs "1.2.3-beta.1" → patch; "1.0.0-1" vs "1.0.0" → major. Build metadata is ignored. Deterministic, read-only, no network.',
    parameters: {
      left: { type: 'string', required: true, description: 'First version, e.g. "1.2.3".' },
      right: { type: 'string', required: true, description: 'Second version, e.g. "2.0.0-beta.1".' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          valid: { type: 'boolean', required: true },
          left: { type: 'string', required: true },
          right: { type: 'string', required: true },
          equal: { type: 'boolean', required: true },
          difference: { type: 'string', enum: ['major', 'minor', 'patch', 'premajor', 'preminor', 'prepatch', 'prerelease'] },
          explanation: { type: 'string' },
          reason: { type: 'string' },
        },
      },
      render: (_args: { left: string; right: string }, value: unknown) => [{ type: 'text', text: renderDiff(value) }],
    },
    async execute(args: { left: string; right: string }) {
      const a = parseVersion(args.left)
      if (!a.ok) return { valid: false, left: args.left, right: args.right, equal: false, reason: `left ${a.reason}` }
      const b = parseVersion(args.right)
      if (!b.ok) return { valid: false, left: args.left, right: args.right, equal: false, reason: `right ${b.reason}` }
      const kind = diffKind(a.value, b.value)
      if (kind === null) {
        return {
          valid: true,
          left: normalizeVersion(a.value),
          right: normalizeVersion(b.value),
          equal: true,
          explanation: `${normalizeVersion(a.value)} and ${normalizeVersion(b.value)} have equal precedence (build metadata ignored)`,
        }
      }
      const out: { valid: boolean; left: string; right: string; equal: boolean; difference?: DiffKind; explanation?: string } = {
        valid: true,
        left: normalizeVersion(a.value),
        right: normalizeVersion(b.value),
        equal: false,
        difference: kind,
        explanation: `${normalizeVersion(a.value)} → ${normalizeVersion(b.value)} is a ${kind} change`,
      }
      return out
    },
  })

  const semver_sort = defineTool({
    name: 'semver_sort',
    description: 'Sort a list of Semantic Versioning 2.0.0 strings by precedence (ascending by default, descending optional), with build metadata as tie-break (npm semver.sort / rsort). Invalid entries are skipped and reported with their input index — valid entries are still sorted. Deterministic, read-only, no network.',
    parameters: {
      versions: { type: 'array', items: { type: 'string' }, required: true, description: 'Version strings to sort, e.g. ["1.2.3", "1.2.10", "1.0.0"].' },
      order: { type: 'string', enum: ['asc', 'desc'], description: 'Sort direction (default "asc").' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          valid: { type: 'boolean', required: true },
          count: { type: 'number', required: true },
          order: { type: 'string', required: true },
          sorted: { type: 'array', items: { type: 'string' }, required: true },
          invalidCount: { type: 'number' },
          invalid: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args: { versions: string[]; order?: string }, value: unknown) => [{ type: 'text', text: renderSort(value) }],
    },
    async execute(args: { versions: string[]; order?: string }) {
      const order = args.order ?? 'asc'
      const result = sortVersionStrings(args.versions, order === 'desc' ? 'desc' : 'asc')
      if (!result.ok) return { valid: false, count: 0, order, sorted: [] }
      const out: { valid: boolean; count: number; order: string; sorted: string[]; invalidCount?: number; invalid?: string[] } = {
        valid: result.value.invalid.length === 0,
        count: result.value.sorted.length,
        order,
        sorted: result.value.sorted,
      }
      if (result.value.invalid.length > 0) {
        out.invalidCount = result.value.invalid.length
        out.invalid = result.value.invalid.map((e) => `index ${e.index}: "${e.input}" — ${e.reason}`)
      }
      return out
    },
  })

  return { semver_parse, semver_compare, semver_satisfies, semver_inc, semver_diff, semver_sort }
}
