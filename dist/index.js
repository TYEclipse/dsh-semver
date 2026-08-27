/**
 * dsh-semver — semantic versioning toolbox for DeepSeek Harness.
 *
 * Six deterministic tools, zero runtime dependencies (pure logic):
 *   semver_parse      — parse a version string into major/minor/patch/prerelease/build
 *   semver_compare    — compare two versions (lt / eq / gt) with a human verdict
 *   semver_satisfies  — check a version against an npm-style range (^ ~ >= <= > < = x-ranges, hyphen, ||, AND)
 *   semver_inc        — increment a version (major/minor/patch/premajor/preminor/prepatch/prerelease, npm rules)
 *   semver_diff       — release-type difference between two versions (npm semver.diff)
 *   semver_sort       — sort a list of versions by precedence (asc/desc, build-metadata tie-break)
 *
 * Safety model: every tool is pure, read-only and offline — no network, no
 * filesystem access, no dynamic evaluation.
 *
 * @module dsh-semver
 */
import z from '@deepseek-ai/schemastery';
import { buildSemverTools } from "./tools.js";
/** Stable Cordis plugin name (also the config key under `plugins:`). */
export const name = 'dsh-semver';
/** Services required before tool registration can start. */
export const inject = ['agents', 'tools'];
export const Config = z.object({
    includePrerelease: z.boolean().default(false),
});
/** Resolve loader config into the effective runtime config. */
export function resolveConfig(config) {
    return {
        includePrerelease: config.includePrerelease ?? false,
    };
}
/** Register every semver tool on one agent; returns the disposer. */
function decorate(agent, tools) {
    const disposers = Object.values(tools).map((definition) => agent.ctx.tools.register(definition));
    return () => {
        for (const dispose of disposers) {
            try {
                dispose();
            }
            catch {
                // already disposed
            }
        }
    };
}
/** Mount the semver tools on every live agent and every future one. */
export function apply(ctx, config) {
    const resolved = resolveConfig(config);
    const tools = buildSemverTools(resolved);
    const disposers = new Set();
    const decorateAgent = (agent) => {
        try {
            disposers.add(decorate(agent, tools));
        }
        catch (error) {
            ctx.logger('semver').warn(`tool registration for agent ${agent.id} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    for (const agent of ctx.agents.list())
        decorateAgent(agent);
    const off = ctx.on('agent/created', ({ agent }) => decorateAgent(agent));
    ctx.effect(() => () => {
        off();
        for (const dispose of disposers) {
            try {
                dispose();
            }
            catch {
                // already disposed
            }
        }
        disposers.clear();
    });
}
//# sourceMappingURL=index.js.map