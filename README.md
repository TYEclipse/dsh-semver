# dsh-semver

> Semantic versioning toolbox for [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) — parse, compare, range-check, increment, diff, sort, find a range's lowest version, check whether two ranges overlap, pull a version out of messy text and say whether a version is above or below a whole range. Zero runtime dependencies, pure logic, fully deterministic.

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
| `semver_min_version` | Lowest version a range accepts (npm `semver.minVersion`): `~1.2.3` → `1.2.3`, `>1.2` → `1.3.0`, `<=1.2.3` → `0.0.0`; unsatisfiable combinations report `satisfiable: false` instead of a plausible-looking bound |
| `semver_intersects` | Whether two ranges can be satisfied by one version (npm `semver.intersects`) — plus a witness version that satisfies both when they overlap |
| `semver_coerce` | Pull the first version-like number out of arbitrary text (npm `semver.coerce`): `"node v18.16.1"` → 18.16.1, `"42"` → 42.0.0, `"1.2"` → 1.2.0, `"x.y.z"` → no version. Prerelease/build metadata in the source text are dropped, exactly like npm's default |
| `semver_outside` | Where a version sits relative to a whole range (npm `semver.gtr` / `semver.ltr`): **above** everything it accepts, **below** everything, **inside**, or in the **gap** between alternatives — the "too new or too old?" question `semver_satisfies` alone cannot answer |

### semver_coerce / semver_outside — text and position (v0.4.0)

```
semver_coerce("expected node v18.16.1, found 20.11")   → 18.16.1
semver_coerce("42")                                    → 42.0.0        (missing components filled with 0)
semver_coerce("1.2.3.4")                               → 1.2.3         (npm consumes the extra digits)
semver_coerce("changelog 2026-10-12: 4.5.6 released")  → 2026.0.0      (the date wins — read the note below)
semver_coerce("x.y.z")                                 → no version-like number

semver_outside("2.0.0", "^1.2.3")                  → above   (is 2.0.0 too new? yes — above everything ^1.2.3 takes)
semver_outside("1.0.0", "^1.2.3")                  → below   (too old)
semver_outside("1.4.0", "^1.2.3")                  → inside
semver_outside("2.0.0", "^1.0.0 || ^3.0.0")        → gap     (not inside, yet neither above nor below the whole range)
```

- **"First" is not "the one you meant".** npm's `coerce` takes the first number run in the text, so a changelog line coerces to its date and a commit sha coerces to `4.0.0`. That is npm's behaviour, reproduced rather than improved on — the tool says so in its description.
- **Four outcomes, no forced choice.** A version can be above a range, below it, inside it, or in a gap between alternatives (`^1.0.0 || ^3.0.0` with `2.0.0`: npm returns `false` for *both* directions). `satisfies`, `above` and `below` are reported separately, so the gap is never mistaken for a direction.
- **npm's quirks are surfaced, not hidden.** A prerelease never satisfies a plain range (tuple-lock), so npm classifies `1.2.3-beta.1` as **both** above and below `>=1.2.0 <2.0.0`. The result shows exactly that instead of inventing a tidier verdict.
- **The comparator shape is anchored too.** npm compiles `^1.2.3` to `>=1.2.3 <2.0.0-0` and keeps `1.2.3` as a bare comparator; the `-0` upper bound is load-bearing for `gtr`/`ltr`, so the test suite compares this parser against `new (require('semver').Range)(range).set` comparator for comparator (54 ranges anchored), not just through verdicts.
- **Unrepresentable numbers are reported.** A 16-digit component is above `Number.MAX_SAFE_INTEGER`; npm's parser throws and `parse()` swallows it into `null`, so `semver_coerce` reports *no version* with a note saying why — never a rounded number.

### semver_min_version / semver_intersects — range algebra (v0.3.0)

Two questions that come up whenever an agent has to negotiate versions:

```
semver_min_version("^1.2.3")            → 1.2.3
semver_min_version(">1.2.3")            → 1.2.4      (> bound with no prerelease bumps patch)
semver_min_version(">1.2")              → 1.3.0      (partial versions follow npm's x-range rule)
semver_min_version("~1.2.3")            → 1.2.3
semver_min_version("<=1.2.3")           → 0.0.0      (no lower bound → the floor)
semver_min_version(">2.0.0 <2.0.1")     → satisfiable: false   (never a guessed bound)

semver_intersects("^1.2.3", "^1.3.0")   → true, witness 1.3.0
semver_intersects("^1.0.0", "^2.0.0")   → false
semver_intersects("^1.0.0 || ^2.0.0", "^2.5.0") → true
```

- **`satisfiable: false` is a result, not an error.** Unsatisfiable combinations (`^0.1.4 ~3.0.2`, `>=1.0.0 <1.0.0`, `>2.0.0 <2.0.1`) report that no version fits, rather than returning a boundary that looks reasonable but matches nothing.
- **The witness is verified, never guessed.** When two ranges overlap, `semver_intersects` probes the ranges' boundary versions and checks each candidate against **both** ranges before reporting it — so a reported witness always satisfies both, though it is not claimed to be the lowest one.
- **npm parity is enforced against npm itself.** `npm semver` renders `~1.2.3` as `>=1.2.3 <1.3.0`; a hand-written expectation would have missed that `1.2.0` used to be accepted. See *Testing* below.

### semver_inc — npm increment semantics (v0.2.0)

- **Plain bumps**: `1.2.3` + `major` → `2.0.0`, + `minor` → `1.3.0`, + `patch` → `1.2.4`.
- **Pre bumps with identifier**: `1.2.3` + `preminor` (`rc`) → `1.3.0-rc.0`; without identifier → `1.3.0-0`.
- **Prerelease counter**: `1.2.4-beta.0` + `prerelease` → `1.2.4-beta.1`; `1.2.4-beta` + `prerelease` → `1.2.4-beta.0`; switching identifier restarts the counter (`prerelease` with `rc` → `1.2.4-rc.0`).
- **npm quirks preserved**: a pre-major/pre-minor/pre-patch version releases without incrementing (`1.0.0-5` + `major` → `1.0.0`); `1.2.0-5` + `prerelease` → `1.2.0-6` (no patch bump); build metadata is dropped; dotted identifiers are allowed (`premajor` with `beta.1` → `2.0.0-beta.1.0`); identifiers with leading zeros are rejected.

### semver_diff — npm difference semantics (v0.2.0)

`1.2.3` → `2.0.0` = `major`; `1.2.3` → `2.0.0-beta.1` = `premajor`; `1.2.4-beta.1` → `1.2.4-beta.2` = `prerelease`. npm special cases preserved: `1.2.3` vs `1.2.3-beta.1` → `patch`, `1.0.0-1` vs `1.0.0` → `major`. Equal precedence (build metadata ignored) → `equal: true` with no `difference` key.

### Supported range syntax (npm-compatible subset)

- **Exact**: `1.2.3`, `=1.2.3`
- **Comparisons**: `>1.2.0`, `>=1.2.0`, `<2.0.0`, `<=2.0.0` — partial versions follow npm's x-range rewrite (`>1.2` → `>=1.3.0`, `<=1.2` → `<1.3.0`, `<1.2` → `<1.2.0`, `>=1.2` → `>=1.2.0`; npm compiles `>*` / `<*` to a range nothing satisfies)
- **Caret**: `^1.2.3` → `>=1.2.3 <2.0.0`, with the 0.x rules (`^0.2.3` → `>=0.2.3 <0.3.0`, `^0.0.3` → `>=0.0.3 <0.0.4`)
- **Tilde**: `~1.2.3` → `>=1.2.3 <1.3.0`, `~1.2` → `>=1.2.0 <1.3.0`, `~1` → `>=1.0.0 <2.0.0` (fixed in v0.3.0 — the patch component used to be dropped from the lower bound, so `1.2.0` wrongly matched `~1.2.3`)
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

semver_min_version(">=1.2.0 <2.0.0")
  → 1.2.0

semver_intersects("^1.2.3", ">=1.3.0 <1.5.0")
  → true — e.g. 1.3.0 satisfies both
```

## Safety

All ten tools are **pure and offline**: no network, no filesystem access, no shell, no dynamic evaluation. Inputs are validated with strict regexes and numeric checks; malformed versions, ranges and identifiers return explicit reasons instead of throwing.

## Testing

```sh
pnpm test           # vitest — 154 tests
```

Tool semantics are anchored to **npm's own semver package** as an independent oracle, never to hand-written expectations:

```
test/oracle/range-algebra-oracle.mjs   # regenerates the anchors from npm semver
test/anchors/range-algebra.json        # 54 ranges · 400 range pairs · 864 matcher cases · 28 coerce cases · 864 gtr/ltr cases
```

With `npm i semver@7` available, `node test/oracle/range-algebra-oracle.mjs --write` rewrites the anchors; the test suite sweeps the plugin's matcher, `semver_min_version`, `semver_intersects`, `semver_coerce`, `semver_outside` and the npm-shaped comparator parser against every one of them. The `~1.2.3` lower-bound bug fixed in v0.3.0 was found exactly this way — its v0.2.x expectation had been chosen by hand and sat outside the wrong bound.

The oracle also carries a self-check (`node test/oracle/range-algebra-oracle.mjs --check`) that re-derives every anchor from npm and requires byte equality with the committed file, plus internal invariants (`gtr` never agrees with `satisfies`, `intersects` is symmetric, the corpus yields all four placement outcomes). It runs as part of this repo's test gate, so "the marker points at a script that exists" is never mistaken for "the anchors are still true". One of those invariants was itself wrong when first written — it claimed a version can never be both above and below a range, and the corpus immediately showed npm really does that for tuple-locked prereleases.

## Development

```sh
pnpm install        # dev dependencies only (esbuild allowBuilds is pre-configured)
pnpm build          # tsc → dist/ (committed; git installs do not run build scripts)
pnpm test           # vitest — 154 tests; anchors generated by npm semver 7.8.5 (independent oracle)
pnpm lint           # oxlint (src + test only)
```

## License

MIT

---

## 中文简介

**dsh-semver** 是 DeepSeek Harness 的语义化版本号工具箱：解析（`semver_parse`）、比较（`semver_compare`，遵循 semver 2.0.0 优先级规则，build 元数据不影响比较）、范围匹配（`semver_satisfies`，支持 `^`/`~`/`>=`/`<=`/通配符/连字符区间/`||`，含 npm 的 prerelease tuple-lock 语义），以及 v0.2.0 新增的**版本号递增**（`semver_inc`，npm `semver.inc` 全规则：major/minor/patch/premajor/preminor/prepatch/prerelease + 可选预发布标识符）、**版本差异判定**（`semver_diff`，npm `semver.diff` 语义，含 prerelease 特殊分支）与**版本列表排序**（`semver_sort`，升/降序，build 元数据作次序裁决）。零运行时依赖、纯逻辑、确定性输出——LLM 经常算错的版本号问题（如 `1.0.0-beta.11 > 1.0.0-beta.2`、`1.2.4-beta.0` 递增后是 `beta.1` 而非 `beta.01`、`1.2.4-beta.1` 不满足 `^1.2.3`）交给工具一次性算对。
