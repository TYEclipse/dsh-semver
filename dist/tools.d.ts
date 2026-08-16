/**
 * Tool definitions for dsh-semver: three deterministic version tools exposed to
 * every agent via defineTool. Each tool has a strict JSON-schema parameter
 * surface and a compact text renderer. All outputs are lossless JSON — absent
 * fields are omitted or null, never undefined (the dsh-tools output gate).
 *
 * @module dsh-semver/tools
 */
import { type ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { ResolvedConfig } from './index.ts';
export interface ToolSet {
    semver_parse: ToolDefinition;
    semver_compare: ToolDefinition;
    semver_satisfies: ToolDefinition;
}
/** Build all three tool definitions from the resolved config. */
export declare function buildSemverTools(config: ResolvedConfig): ToolSet;
//# sourceMappingURL=tools.d.ts.map