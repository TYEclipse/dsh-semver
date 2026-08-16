# dsh-semver

> Semantic versioning toolbox for [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) — parse, compare and range-check semver strings. Zero runtime dependencies, pure logic, fully deterministic.

Agents are bad at version arithmetic. "Is `2.1.0-rc.1` newer than `2.1.0-beta.11`?" and "does `1.2.4-beta.1` satisfy `^1.2.3`?" are exactly the questions LLMs get wrong — prerelease ordering, tuple-lock, and caret/tilde upper bounds are easy to misremember. This plugin turns those questions into deterministic tool calls.

## Tools

| Tool | Description |
|------|-------------|
| `semver_parse` | Parse a semver 2.0.0 string into `major` / `minor` / `patch` / `prerelease` / `build`, with a precise rejection reason for malformed input (`1.2`, `1.2.3.4`, leading zeros, `1.2.3-01`, …) |
| `semver_compare` | Compare two versions → `lt` / `eq` / `gt` plus a human verdict (`2.1.0 > 2.0.3`). Build metadata is ignored for precedence (`1.0.0+build.1 == 1.0.0`) |
| `semver_satisfies` | Check a version against an npm-style range, with the matched range normalized in the explanation |

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
```

## Safety

All three tools are **pure and offline**: no network, no filesystem access, no shell, no dynamic evaluation. Inputs are validated with strict regexes and numeric checks; malformed versions and ranges return explicit reasons instead of throwing.

## Development

```sh
pnpm install        # dev dependencies only (esbuild allowBuilds is pre-configured)
pnpm build          # tsc → dist/ (committed; git installs do not run build scripts)
pnpm test           # vitest — 40+ tests, all known anchors from the semver spec / npm docs
pnpm lint           # oxlint (src + test only)
```

## License

MIT

---

## 中文简介

**dsh-semver** 是 DeepSeek Harness 的语义化版本号工具箱：解析（`semver_parse`）、比较（`semver_compare`，遵循 semver 2.0.0 优先级规则，build 元数据不影响比较）、范围匹配（`semver_satisfies`，支持 `^`/`~`/`>=`/`<=`/通配符/连字符区间/`||`，含 npm 的 prerelease tuple-lock 语义）。零运行时依赖、纯逻辑、确定性输出——LLM 经常算错的版本号问题（如 `1.0.0-beta.11 > 1.0.0-beta.2`、`1.2.4-beta.1` 不满足 `^1.2.3`）交给工具一次性算对。
