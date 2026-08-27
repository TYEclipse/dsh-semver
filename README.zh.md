# dsh-semver 中文说明

**dsh-semver** 是 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) 的语义化版本号工具箱：零运行时依赖、纯逻辑、确定性输出。

Agent 经常算错版本号问题——`1.0.0-beta.11` 和 `1.0.0-beta.2` 谁大？`1.2.4-beta.1` 是否满足 `^1.2.3`？`1.2.4-beta.0` 递增后是什么？本插件把这类问题变成确定性的工具调用。

## 六个工具

| 工具 | 功能 |
|------|------|
| `semver_parse` | 解析版本号 → major/minor/patch/prerelease/build；非法输入（`1.2`、`1.2.3.4`、前导零、`1.2.3-01` 等）返回明确原因 |
| `semver_compare` | 比较两个版本 → lt/eq/gt + 人话结论（`2.1.0 > 2.0.3`）；build 元数据不影响优先级（`1.0.0+build.1 == 1.0.0`） |
| `semver_satisfies` | 判断版本是否满足 npm 风格范围，解释里给出归一化后的范围 |
| `semver_inc` | 按 npm `semver.inc` 规则递增版本：major/minor/patch/premajor/preminor/prepatch/prerelease + 可选预发布标识符 |
| `semver_diff` | 两个版本的发布级差异（npm `semver.diff`）：major/minor/patch/premajor/preminor/prepatch/prerelease |
| `semver_sort` | 版本列表按优先级排序（升/降序），build 元数据作次序裁决（npm `semver.sort`/`rsort`） |

### semver_inc 递增规则（v0.2.0）

- 普通递增：`1.2.3` + `major` → `2.0.0`、+ `minor` → `1.3.0`、+ `patch` → `1.2.4`
- 带标识符的预发布：`1.2.3` + `preminor`(`rc`) → `1.3.0-rc.0`；不带标识符 → `1.3.0-0`
- 预发布计数：`1.2.4-beta.0` + `prerelease` → `1.2.4-beta.1`；`1.2.4-beta` + `prerelease` → `1.2.4-beta.0`；换标识符重新计数（+`prerelease`(`rc`) → `1.2.4-rc.0`）
- 保留 npm 细节：pre-major/pre-minor/pre-patch 版本转正式版不自增（`1.0.0-5` + `major` → `1.0.0`）；`1.2.0-5` + `prerelease` → `1.2.0-6`（不递增 patch）；build 元数据被丢弃；点分标识符允许（`premajor`(`beta.1`) → `2.0.0-beta.1.0`）；带前导零的标识符拒绝

### semver_diff 差异语义（v0.2.0）

`1.2.3` → `2.0.0` = `major`；`1.2.3` → `2.0.0-beta.1` = `premajor`；`1.2.4-beta.1` → `1.2.4-beta.2` = `prerelease`。保留 npm 特殊分支：`1.2.3` 与 `1.2.3-beta.1` 差 `patch`、`1.0.0-1` 与 `1.0.0` 差 `major`。优先级相等（build 忽略）→ `equal: true`，无 `difference` 键。

## 支持的范围语法（npm 兼容子集）

- 精确：`1.2.3`、`=1.2.3`
- 比较符：`>1.2.0`、`>=1.2.0`、`<2.0.0`、`<=2.0.0`
- 脱字符：`^1.2.3` → `>=1.2.3 <2.0.0`，含 0.x 规则（`^0.2.3` → `>=0.2.3 <0.3.0`）
- 波浪号：`~1.2.3` → `>=1.2.3 <1.3.0`
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

六个工具全部**纯函数、离线**：无网络、无文件系统访问、无 shell、无动态求值。

## 开发

```sh
pnpm install   # 仅 devDependencies（esbuild allowBuilds 已预配置）
pnpm build     # tsc → dist/（已提交；git 安装不跑构建脚本）
pnpm test      # vitest，114 用例；锚点由 npm semver 7.7.4（独立 oracle）生成
pnpm lint      # oxlint（仅 src + test）
```

## 许可证

MIT
