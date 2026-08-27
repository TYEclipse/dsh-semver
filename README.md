# dsh-semver

> Semantic versioning toolbox for [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) — parse, compare, range-check, increment, diff and sort semver strings. Zero runtime dependencies, pure logic, fully deterministic.

Agents are bad at version arithmetic. "Is `2.1.0-rc.1` newer than `2.1.0-beta.11`?", "does `1.2.4-beta.1` satisfy `^1.2.3`?" and "what does `1.2.4-beta.0` + prerelease become?" are exactly the questions LLMs get wrong — prerelease ordering, tuple-lock, caret/tilde upper bounds and prerelease bump rules are easy to misremember. This plugin turns those questions into deterministic tool calls.

## Tools

| Tool | Description |
|------|-------------|
| `semver_parse` | Parse a semver 2.0.0 string into `major` / `minor` / `patch` / `prerelease` / `build`, with a precise rejection reason for malformed input (`1.2`, `1.2.3.4`, leading zeros, `1.2.3-01`, …) |
| `semver_compare` | Compare two versions → `lt` / `eq` / `gt` plus a human verdict (`2.1.0 > 2.0.3`). Build metadata is ignored for precedence (`1.0.0+build.1 == 1.0.0`) |
| `semver_satisfies` | Check a version against an npm-style range, with the matched range normalized in the explanation |
| `semver_inc` | Increment a version following npm `semver.inc` rules: `major` / `minor` / `patch` / `premajor` / `preminor` / `prepatch` / `prerelease`, with an optional prerelease `identifier` |
| `semver_diff` | Release-type difference between two versions (npm `semver.diff`): `major` / `minor` / `patch` / `premajor` / `preminor` / `prepatch` / `prerelease` |
| `semver_sort` | Sort a list of versions by precedence, ascending or descending, with build metadata as tie-break (npm `semver.sort` / `rsort`) |

### semver_inc — npm increment semantics (v0.2.0)

- **Plain bumps**: `1.2.3` + `major` → `2.0.0`, + `minor` → `1.3.0`, + `patch` → `1.2.4`.
- **Pre bumps with identifier**: `1.2.3` + `preminor` (`rc`) → `1.3.0-rc.0`; without identifier → `1.3.0-0`.
- **Prerelease counter**: `1.2.4-beta.0` + `prerelease` → `1.2.4-beta.1`; `1.2.4-beta` + `prerelease` → `1.2.4-beta.0`; switching identifier restarts the counter (`prerelease` with `rc` → `1.2.4-rc.0`).
- **npm quirks preserved**: a pre-major/pre-minor/pre-patch version releases without incrementing (`1.0.0-5` + `major` → `1.0.0`); `1.2.0-5` + `prerelease` → `1.2.0-6` (no patch bump); build metadata is dropped; dotted identifiers are allowed (`premajor` with `beta.1` → `2.0.0-beta.1.0`); identifiers with leading zeros are rejected.

### semver_diff — npm difference semantics (v0.2.0)

`1.2.3` → `2.0.0` = `major`; `1.2.3` → `2.0.0-beta.1` = `premajor`; `1.2.4-beta.1` → `1.2.4-beta.2` = `prerelease`. npm special cases preserved: `1.2.3` vs `1.2.3-beta.1` → `patch`, `1.0.0-1` vs `1.0.0` → `major`. Equal precedence (build metadata ignored) → `equal: true` with no `difference` key.

### Supported range syntax (npm-compatible subset)

- **Exact**: `1.2.3`, `=1.2.3`
- **Comparisons**: `>1.2.0`, `>=1.2.0`, `<2.0.0`, `<=2.0.0`
- **Caret**: `^1.2.3` → `>=1.2.3 <2.0.0`, with the 0.x rules (`^0.2.3` → `>=0.2.3 <0.3.0`, `^0.0.3` → `>=0.0.3 <0.0.4`)
- **Tilde**: `~1.2.3` → `>=1.2.3 <1.3.0`, `~1.2` → `>=1.2.0 <1.3.0`, `~1` → `>=1.0.0 <2.0.0`
- **Wildcards**: `1.2.x`, `1.x`, `*` (bare partials `1.2` / `1` behave the same)
- **Hyphen ranges**: `1.2.3 - 2.3.4` (inclusive endpoints; partial upper endpoints like `1.2.3 - 2.3` → `<2.4.0`)
- **AND / OR**: `>=1.2.0 <2.0.0`, `^1.2.3 || >=3.0.0`

### Prerelease semantics (npm tuple-lock)

- A plain range never matches prerelease versions: `1.2.4-beta.1` does **not** satisfy `^1.2.3`.
- A range with a prerelease lower bound only matches prereleases of the **same** `[major, minor, patch]` tuple: `1.2.3-beta.5` satisfies `^1.2.3-beta.2`, but `1.2.4-beta.1` does not (releases like `1.2.3` still match).
- Set `includePrerelease: true` (tool parameter or plugin config) to relax both rules.

## Install

```sh
# into the web profile (dsh plugin has no default profile — always pass --profile)
dsh plugin --profile web add github:TYEclipse/dsh-semver
```

Verify the layer mounted:

```sh
dsh --profile web --dump-config | grep '== dsh-semver'
```

## Usage examples

```
semver_parse("2.1.0-rc.1+build.42")
  → major 2, minor 1, patch 0, prerelease [rc, 1], build [build, 42]

semver_compare("2.1.0", "2.0.3")
  → "2.1.0 > 2.0.3" (gt)

semver_satisfies("1.2.4-beta.1", "^1.2.3")
  → false — prerelease does not match a plain range

semver_inc("1.2.4-beta.0", "prerelease", "beta")
  → 1.2.4-beta.1

semver_inc("1.2.3", "preminor", "rc")
  → 1.3.0-rc.0

semver_diff("1.2.3", "2.0.0-beta.1")
  → premajor

semver_sort(["1.2.3", "1.2.10", "1.0.0"], "desc")
  → ["1.2.10", "1.2.3", "1.0.0"]
```

## Safety

All six tools are **pure and offline**: no network, no filesystem access, no shell, no dynamic evaluation. Inputs are validated with strict regexes and numeric checks; malformed versions, ranges and identifiers return explicit reasons instead of throwing.

## Development

```sh
pnpm install        # dev dependencies only (esbuild allowBuilds is pre-configured)
pnpm build          # tsc → dist/ (committed; git installs do not run build scripts)
pnpm test           # vitest — 114 tests; anchors generated by npm semver 7.7.4 (independent oracle)
pnpm lint           # oxlint (src + test only)
```

## License

MIT

---

## 中文简介

**dsh-semver** 是 DeepSeek Harness 的语义化版本号工具箱：解析（`semver_parse`）、比较（`semver_compare`，遵循 semver 2.0.0 优先级规则，build 元数据不影响比较）、范围匹配（`semver_satisfies`，支持 `^`/`~`/`>=`/`<=`/通配符/连字符区间/`||`，含 npm 的 prerelease tuple-lock 语义），以及 v0.2.0 新增的**版本号递增**（`semver_inc`，npm `semver.inc` 全规则：major/minor/patch/premajor/preminor/prepatch/prerelease + 可选预发布标识符）、**版本差异判定**（`semver_diff`，npm `semver.diff` 语义，含 prerelease 特殊分支）与**版本列表排序**（`semver_sort`，升/降序，build 元数据作次序裁决）。零运行时依赖、纯逻辑、确定性输出——LLM 经常算错的版本号问题（如 `1.0.0-beta.11 > 1.0.0-beta.2`、`1.2.4-beta.0` 递增后是 `beta.1` 而非 `beta.01`、`1.2.4-beta.1` 不满足 `^1.2.3`）交给工具一次性算对。
