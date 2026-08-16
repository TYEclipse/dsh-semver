/**
 * dsh-semver — semantic versioning toolbox for DeepSeek Harness.
 *
 * Three deterministic tools, zero runtime dependencies (pure logic):
 *   semver_parse      — parse a version string into major/minor/patch/prerelease/build
 *   semver_compare    — compare two versions (lt / eq / gt) with a human verdict
 *   semver_satisfies  — check a version against an npm-style range (^ ~ >= <= > < = x-ranges, hyphen, ||, AND)
 *
 * Safety model: every tool is pure, read-only and offline — no network, no
 * filesystem access, no dynamic evaluation.
 *
 * @module dsh-semver
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import z from '@deepseek-ai/schemastery'
import { buildSemverTools, type ToolSet } from './tools.ts'

/** Stable Cordis plugin name (also the config key under `plugins:`). */
export const name = 'dsh-semver'

/** Services required before tool registration can start. */
export const inject = ['agents', 'tools']

/** Plugin configuration, resolved with defaults by the loader. */
export interface Config {
  /** Also match prerelease versions when a range has no prerelease comparator (npm default: false). */
  includePrerelease?: boolean
}

export const Config: z<Config> = z.object({
  includePrerelease: z.boolean().default(false),
})

/** Config with every default resolved (all fields guaranteed). */
export interface ResolvedConfig {
  includePrerelease: boolean
}

/** Resolve loader config into the effective runtime config. */
export function resolveConfig(config: Config): ResolvedConfig {
  return {
    includePrerelease: config.includePrerelease ?? false,
  }
}

/** Register every semver tool on one agent; returns the disposer. */
function decorate(agent: Agent, tools: ToolSet): () => void {
  const disposers = Object.values(tools).map((definition) => agent.ctx.tools.register(definition))
  return () => {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        // already disposed
      }
    }
  }
}

/** Mount the semver tools on every live agent and every future one. */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  const tools = buildSemverTools(resolved)
  const disposers = new Set<() => void>()

  const decorateAgent = (agent: Agent): void => {
    try {
      disposers.add(decorate(agent, tools))
    } catch (error) {
      ctx.logger('semver').warn(`tool registration for agent ${agent.id} failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  for (const agent of ctx.agents.list()) decorateAgent(agent)
  const off = ctx.on('agent/created', ({ agent }) => decorateAgent(agent))

  ctx.effect(() => () => {
    off()
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        // already disposed
      }
    }
    disposers.clear()
  })
}
