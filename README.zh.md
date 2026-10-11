# dsh-semver 中文说明

**dsh-semver** 是 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) 的语义化版本号工具箱：零运行时依赖、纯逻辑、确定性输出。

Agent 经常算错版本号问题——`1.0.0-beta.11` 和 `1.0.0-beta.2` 谁大？`1.2.4-beta.1` 是否满足 `^1.2.3`？`1.2.4-beta.0` 递增后是什么？本插件把这类问题变成确定性的工具调用。

## 十个工具

| 工具 | 功能 |
|------|------|
| `semver_parse` | 解析版本号 → major/minor/patch/prerelease/build；非法输入（`1.2`、`1.2.3.4`、前导零、`1.2.3-01` 等）返回明确原因 |
| `semver_compare` | 比较两个版本 → lt/eq/gt + 人话结论（`2.1.0 > 2.0.3`）；build 元数据不影响优先级（`1.0.0+build.1 == 1.0.0`） |
| `semver_satisfies` | 判断版本是否满足 npm 风格范围，解释里给出归一化后的范围 |
| `semver_inc` | 按 npm `semver.inc` 规则递增版本：major/minor/patch/premajor/preminor/prepatch/prerelease + 可选预发布标识符 |
| `semver_diff` | 两个版本的发布级差异（npm `semver.diff`）：major/minor/patch/premajor/preminor/prepatch/prerelease |
| `semver_sort` | 版本列表按优先级排序（升/降序），build 元数据作次序裁决（npm `semver.sort`/`rsort`） |
| `semver_min_version` | 范围能接受的最低版本（npm `semver.minVersion`）：`~1.2.3` → `1.2.3`、`>1.2` → `1.3.0`、`<=1.2.3` → `0.0.0`；不可满足的组合返回 `satisfiable: false`，而不是一个「看起来合理」的边界值 |
| `semver_intersects` | 两个范围是否可能被同一个版本同时满足（npm `semver.intersects`）；有交集时额外给出一个**已验证**同时满足两者的示例版本 |
| `semver_coerce` | 从任意文本里抓出第一个版本号（npm `semver.coerce`）：`"node v18.16.1"` → 18.16.1、`"42"` → 42.0.0、`"1.2"` → 1.2.0、`"x.y.z"` → 没有版本；文本里的预发布/build 元数据按 npm 默认丢弃 |
| `semver_outside` | 版本相对**整个范围**的位置（npm `semver.gtr`/`semver.ltr`）：高于全部、低于全部、在范围内、落在分支之间的空隙——回答「太新还是太旧」，这是 `semver_satisfies` 单独答不了的 |

### semver_coerce / semver_outside 文本与定位（v0.4.0）

```
semver_coerce("expected node v18.16.1, found 20.11")   → 18.16.1
semver_coerce("42")                                    → 42.0.0        （缺的档位补 0）
semver_coerce("1.2.3.4")                               → 1.2.3         （npm 会把后面的数字吃掉）
semver_coerce("changelog 2026-10-12: 4.5.6 released")  → 2026.0.0      （日期先被命中，见下）
semver_coerce("x.y.z")                                 → 没有版本样式的数字

semver_outside("2.0.0", "^1.2.3")                  → 高于（above：2.0.0 比 ^1.2.3 能接受的全部都新）
semver_outside("1.0.0", "^1.2.3")                  → 低于（below：太旧）
semver_outside("1.4.0", "^1.2.3")                  → 范围内（inside）
semver_outside("2.0.0", "^1.0.0 || ^3.0.0")        → 空隙（gap：不在范围内，但也不比整个范围高或低）
```

- **「第一个」不等于「你想的那个」**：npm 的 `coerce` 取文本里第一个数字串，所以 changelog 行会取到日期、commit sha 会取成 `4.0.0`。这是 npm 的行为，本插件照搬而不是自作聪明去改（工具描述里已写明）。
- **四种结局，不硬凑方向**：版本可能高于范围、低于范围、在范围内，或落在两个分支之间的空隙（`^1.0.0 || ^3.0.0` 对 `2.0.0`：npm 两个方向都返回 `false`）。结果里 `satisfies`/`above`/`below` 三个布尔分开给，空隙不会被误当成某个方向。
- **npm 的怪癖照实显示**：预发布默认不满足普通范围（tuple-lock），于是 npm 把 `1.2.3-beta.1` 同时判为高于和低于 `>=1.2.0 <2.0.0`。结果就照实给这个，不编一个更「漂亮」的结论。
- **比较符形状也进了锚点**：npm 把 `^1.2.3` 编译成 `>=1.2.3 <2.0.0-0`、把 `1.2.3` 保持为裸比较符；上界的 `-0` 对 `gtr`/`ltr` 的判定是关键的，所以测试会拿本插件解析出的**比较符集合**与 `new (require('semver').Range)(range).set` 逐条比对（54 个范围），不只看结论。
- **表示不了的数字如实报**：16 位档位超过 `Number.MAX_SAFE_INTEGER`，npm 的解析器抛错后被 `parse()` 吞成 `null`，因此 `semver_coerce` 报「没有版本」并附一句原因，**绝不返回四舍五入后的数字**。

### semver_min_version / semver_intersects 范围代数（v0.3.0）

```
semver_min_version("^1.2.3")            → 1.2.3
semver_min_version(">1.2.3")            → 1.2.4      （无预发布的 ">" 下界递增 patch）
semver_min_version(">1.2")              → 1.3.0      （部分版本按 npm x-range 规则重写）
semver_min_version("<=1.2.3")           → 0.0.0      （没有下界 → 取下限）
semver_min_version(">2.0.0 <2.0.1")     → satisfiable: false（绝不猜一个边界值）

semver_intersects("^1.2.3", "^1.3.0")   → true，示例版本 1.3.0
semver_intersects("^1.0.0", "^2.0.0")   → false
semver_intersects("^1.0.0 || ^2.0.0", "^2.5.0") → true
```

- **`satisfiable: false` 是结果，不是报错**：`^0.1.4 ~3.0.2`、`>=1.0.0 <1.0.0`、`>2.0.0 <2.0.1` 这类互斥组合会如实说明「没有版本满足」，而不是返回一个看起来合理、实际谁也匹配不上的边界。
- **示例版本是验证过的，不是猜的**：两个范围有交集时，工具会拿边界版本逐一用**两个范围各自**校验，通过才输出——所以给出的示例版本一定同时满足两者（但不声称它是最低的那一个）。
- **npm 对齐用 npm 自身做锚**：`~1.2.3` 在 npm 里编译为 `>=1.2.3 <1.3.0`；靠手写期望值的旧用例恰好漏掉了「`1.2.0` 也匹配」这个错误（详见英文 README 的 Testing 一节）。

### semver_inc 递增规则（v0.2.0）

- 普通递增：`1.2.3` + `major` → `2.0.0`、+ `minor` → `1.3.0`、+ `patch` → `1.2.4`
- 带标识符的预发布：`1.2.3` + `preminor`(`rc`) → `1.3.0-rc.0`；不带标识符 → `1.3.0-0`
- 预发布计数：`1.2.4-beta.0` + `prerelease` → `1.2.4-beta.1`；`1.2.4-beta` + `prerelease` → `1.2.4-beta.0`；换标识符重新计数（+`prerelease`(`rc`) → `1.2.4-rc.0`）
- 保留 npm 细节：pre-major/pre-minor/pre-patch 版本转正式版不自增（`1.0.0-5` + `major` → `1.0.0`）；`1.2.0-5` + `prerelease` → `1.2.0-6`（不递增 patch）；build 元数据被丢弃；点分标识符允许（`premajor`(`beta.1`) → `2.0.0-beta.1.0`）；带前导零的标识符拒绝

### semver_diff 差异语义（v0.2.0）

`1.2.3` → `2.0.0` = `major`；`1.2.3` → `2.0.0-beta.1` = `premajor`；`1.2.4-beta.1` → `1.2.4-beta.2` = `prerelease`。保留 npm 特殊分支：`1.2.3` 与 `1.2.3-beta.1` 差 `patch`、`1.0.0-1` 与 `1.0.0` 差 `major`。优先级相等（build 忽略）→ `equal: true`，无 `difference` 键。

## 支持的范围语法（npm 兼容子集）

- 精确：`1.2.3`、`=1.2.3`
- 比较符：`>1.2.0`、`>=1.2.0`、`<2.0.0`、`<=2.0.0`——部分版本按 npm x-range 规则重写（`>1.2` → `>=1.3.0`、`<=1.2` → `<1.3.0`、`<1.2` → `<1.2.0`、`>=1.2` → `>=1.2.0`；`>*` / `<*` 在 npm 里编译成谁也匹配不上的范围）
- 脱字符：`^1.2.3` → `>=1.2.3 <2.0.0`，含 0.x 规则（`^0.2.3` → `>=0.2.3 <0.3.0`）
- 波浪号：`~1.2.3` → `>=1.2.3 <1.3.0`（v0.3.0 修复：旧实现漏掉了下界里的 patch 号，导致 `1.2.0` 也错误匹配 `~1.2.3`）
- 通配符：`1.2.x`、`1.x`、`*`（裸部分版本 `1.2`、`1` 同义）
- 连字符区间：`1.2.3 - 2.3.4`（两端含；部分上界如 `1.2.3 - 2.3` → `<2.4.0`）
- 组合：空格 AND、`||` OR

## Prerelease 语义（npm tuple-lock）

- 普通范围默认不匹配预发布版本：`1.2.4-beta.1` 不满足 `^1.2.3`
- 带预发布下界的范围只匹配同 `[major, minor, patch]` 元组的预发布：`1.2.3-beta.5` 满足 `^1.2.3-beta.2`，但 `1.2.4-beta.1` 不满足
- 传 `includePrerelease: true`（工具参数或插件配置）可放宽两条规则

## 安装

```sh
# dsh plugin 无默认 profile，必须带 --profile
dsh plugin --profile web add github:TYEclipse/dsh-semver
```

验证：`dsh --profile web --dump-config | grep '== dsh-semver'`

## 安全性

十个工具全部**纯函数、离线**：无网络、无文件系统访问、无 shell、无动态求值。

## 测试锚点

工具语义以 **npm 官方 semver 包**为独立 oracle 生成期望值，不手写：

```
test/oracle/range-algebra-oracle.mjs   # 由 npm semver 重新生成锚点（--write 写盘 / --check 自检）
test/anchors/range-algebra.json        # 54 个范围 · 400 组范围对 · 864 条匹配用例 · 28 条 coerce 用例 · 864 条 gtr/ltr 用例
```

装上 `semver@7` 后执行 `node test/oracle/range-algebra-oracle.mjs --write` 即可重写锚点；测试会拿本插件的匹配器、`semver_min_version`、`semver_intersects`、`semver_coerce`、`semver_outside` 以及 npm 形状的比较符解析逐条对拍。v0.3.0 修掉的 `~1.2.3` 下界 bug 正是这样被抓出来的——它旧用例里的期望值是人手写的，恰好落在了错误的边界之外。

oracle 自带自检（`--check`）：用 npm 重新推导全部锚点并与提交件逐字节比对，同时跑内部不变量（`gtr` 不与 `satisfies` 同时为真、`intersects` 对称、语料覆盖四种定位结局）。它挂在本仓测试门禁里，所以「标记指向的脚本存在」不会被误当成「锚点还成立」。这些不变量里有一条最初就写错了——它断言「一个版本不可能同时高于和低于某个范围」，语料当场证明 npm 对 tuple-lock 的预发布**真的**会这么判。

## 开发

```sh
pnpm install   # 仅 devDependencies（esbuild allowBuilds 已预配置）
pnpm build     # tsc → dist/（已提交；git 安装不跑构建脚本）
pnpm test      # vitest，154 用例；锚点由 npm semver 7.8.5（独立 oracle）生成
pnpm lint      # oxlint（仅 src + test）
```

## 许可证

MIT
