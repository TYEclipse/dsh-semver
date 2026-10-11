# CHANGELOG · dsh-semver

> 版本口径：patch 修 bug/补测试｜minor 新增用户可见功能｜major 破坏性变更。安装：`dsh plugin --profile web add github:TYEclipse/dsh-semver`

## [0.4.0] — 2026-10-12
### Minor · R67
- [自主进化] R67 新增 `semver_coerce`（npm `semver.coerce` 对齐）+ `semver_outside`（npm `semver.gtr`/`ltr` 对齐，含「空隙」与 tuple-lock 的诚实呈现）；oracle 迁到 npm 锚点（新增 coerce / outside / 比较符集合三个区）+ 自检 `--check`
- **新增 `semver_coerce`**：从任意文本里抓出第一个版本号（npm `semver.coerce` 默认口径）——`"node v18.16.1"` → `18.16.1`、`"42"` → `42.0.0`、`"1.2"` → `1.2.0`、`"1.2.3.4"` → `1.2.3`（npm 会把紧跟的数字一起吃掉）、`"x.y.z"` → 没有版本。文本里的预发布/build 元数据按 npm 默认丢弃。**两个「会骗人」的情形写进描述与测试**：changelog 行 `"changelog 2026-10-12: 4.5.6 released"` 抓到的是**日期** `2026.0.0`，commit sha `4b825dc…` 抓到 `4.0.0`；16 位档位超过 `Number.MAX_SAFE_INTEGER` 时 npm 的 `parse()` 把异常吞成 `null`，本工具同样报「没有版本」并给一句原因，**绝不返回四舍五入的数字**
- **新增 `semver_outside`**：版本相对**整个范围**的位置（npm `semver.gtr`/`semver.ltr` 逐比较符移植）——四种结局 `inside` / `above` / `below` / `gap`（`^1.0.0 || ^3.0.0` 对 `2.0.0`：不在范围内、两个方向也都是 `false`，工具把这个「空隙」如实命名）;`satisfies`/`above`/`below` 三个布尔分开给，**不硬凑方向**；npm 的 tuple-lock 怪癖（预发布同时被判高于与低于）照实呈现
- **比较符形状也成了锚点**：npm 把 `^1.2.3` 编译成 `>=1.2.3 <2.0.0-0`、把 `1.2.3` 保持为**裸比较符**、把 `>=0.0.0` 丢掉（`^0` → 只有 `<1.0.0-0`）——上界的 `-0` 对 `gtr`/`ltr` 判定是关键。新增 `npmRangeSets()`（仓内导出）让测试能拿 54 个范围的比较符集合与 `new (require('semver').Range)(r).set` **逐条比对**，不只看结论
- **修复（本轮 oracle 抓出）**：`semver_coerce` 初版把「档位超上限」写成 `valid: false`；实测 npm 的 `parse()` 吞异常返回 `null`，于是改成 `version: null` + `note` 说明原因（与 npm 逐条对齐）
- **测试**：132 → **154**（新增 22 条：coerce 全语料对拍、比较符形状对拍、outside 全语料对拍（gtr/ltr/satisfies 三个布尔逐条）、空隙与 tuple-lock 回归、工具层 lossless 输出）；覆盖率 **91.47% → 92.55%**（基线棘轮上调）
- **oracle 迁到仓内 npm 锚点**：`test/oracle/range-algebra-oracle.mjs` 现在三模式——默认打印全部锚点（人读那趟）、`--write` 重写提交件、`--check` 自检（用 npm 重新推导全部锚点并**逐字节比对**提交件，再跑内部不变量：`gtr` 不与 `satisfies` 同真、`intersects` 对称、语料覆盖四种结局）。自检里有一条不变量**本身写错了**（断言「不可能同时高于和低于」），语料当场证明 npm 真的会这么判 tuple-lock 预发布——已按实测改正并把这条认知写进注释与 README
- 文档：README / README.zh 补两个新工具、用法示例、形状锚点与自检说明；测试计数同步

## [0.3.1] — 2026-09-21
### Patch · R45
- [自主进化] R45 修复 semver_intersects 渲染文本未带见证版本（headless e2e 发现：结构化输出有、模型可见文本没有）
- **修复**：`semver_intersects` 的渲染文本（模型唯一能看到的那行）此前只写「两个范围可以同时满足」，没带见证版本；现为 `"^1.2.3" 和 "^1.3.0" 可以同时满足 —— 例如 1.3.0`。结构化字段 `witness` 本来就有，是渲染层漏了
- **测试**：新增 1 条回归（渲染文本必须包含见证版本），132 条全绿；覆盖率 90.79% → 91.47%

## [0.3.0] — 2026-09-21
### Minor · R45
- [自主进化] R45 新增 semver_min_version + semver_intersects（npm minVersion/intersects 对齐）；修 ~1.2.3 下界漏 patch 的匹配 bug；支持部分版本比较符（>1.2 → >=1.3.0）
- **新增 `semver_min_version`**：范围能接受的最低版本（npm `semver.minVersion` 对齐）——`~1.2.3` → `1.2.3`、`>1.2.3` → `1.2.4`、`>1.2` → `1.3.0`、`<=1.2.3` → `0.0.0`；互斥组合返回 `satisfiable: false`（`^0.1.4 ~3.0.2`、`>=1.0.0 <1.0.0`、`>2.0.0 <2.0.1`），不猜边界值
- **新增 `semver_intersects`**：两个范围是否可能被同一版本满足（npm `semver.intersects` 对齐），并为有交集的情形给出一个**经验证**同时满足两者的示例版本
- **修复（重要）**：`~1.2.3` 的下界丢失了 patch 号（旧实现编译成 `>=1.2.0 <1.3.0`），导致 `1.2.0` / `1.2.1` 错误地满足 `~1.2.3`。现按 npm 编译为 `>=1.2.3 <1.3.0`；`~1.2` / `~1` 的既有语义不变
- **新增**：比较符支持部分版本（npm x-range 规则）——`>1.2` → `>=1.3.0`、`<=1.2` → `<1.3.0`、`<1.2` → `<1.2.0`、`>=1.2` → `>=1.2.0`、`>1.2.x` / `<=1.2.x` 等同理；此前这类写法被当作非法范围拒绝
- **测试**：97 → 132（新增 35 条）；新增 `test/oracle/range-algebra-oracle.mjs`（由 npm semver 生成锚点）+ `test/anchors/range-algebra.json`（54 个范围 / 400 组范围对 / 864 条匹配用例），本插件的匹配器、`semver_min_version`、`semver_intersects` 逐条与 npm 对拍；覆盖率 88.8% → 90.79%
- 文档：README / README.zh 补两个新工具、范围语法（部分版本比较符、`~` 修复说明）与 Testing 章节

## [0.2.2] — 2026-09-11
### Patch · R31
- [自主进化] 接入版本与覆盖率门禁（工具链）

## [0.2.1] — 2026-09-11
### Patch · R31
- [自主进化] 接入版本与覆盖率门禁（工具链）

