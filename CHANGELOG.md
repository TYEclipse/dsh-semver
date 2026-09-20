# CHANGELOG · dsh-semver

> 版本口径：patch 修 bug/补测试｜minor 新增用户可见功能｜major 破坏性变更。安装：`dsh plugin --profile web add github:TYEclipse/dsh-semver`

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

