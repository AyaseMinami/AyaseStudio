# Issue #105：统一数据契约与兼容基础

2026-10-01 用户先授权本地实现 #105 和持续开发规则，随后授权将 #93 及其必要基础提交推送，并关闭 #93；#105 保持打开。本文件记录当前本地实现、验证证据与剩余验收，完整开发合同见 [DATA-CONTRACTS.md](DATA-CONTRACTS.md)。

## #105 基础实施时的历史范围

- `src/storage/dataContract.ts` 提供纯克隆迁移、模块可读性判断、字段策略和限定参数过滤；`dataPolicies.ts` 将实际持久 TypeScript 类型及嵌套类型与备份投影关联；`dataRegistry.ts` 注册 13 张表、8 个偏好键及模块资源责任。
- `scripts/check-data-contracts.mjs` 使用 TypeScript AST 检查静态表、可解析持久偏好键、注册与 `backupTables` 的一致性，加入 `npm.cmd run check:data-contracts` 和常规 `check`。任意动态计算键和未绑定类型的对象不在自动完整性保证内。
- 搜索 v1 → v2、连接 v2 → v3 与会话读入口复用迁移基础；工作区事务先预检结构，再创建默认值／修复记录，非法结构不进入写入。
- 普通启动在控制器挂载前严格读取连接配置；独占 `#backup` 维护入口只允许明确确认的完整替换修复可解析但不兼容的配置，并以日志保护原值。无法解析的连接 JSON 仍被绘图维护围栏拒绝，等待 #93。
- 历史 Dexie schema v3 升级在版本事务内预检本次搬迁的会话配置／模型字段；失败回滚旧 schema 及全部行，不声称全面验证任意旧 schema 字段。
- 备份新导出为文档 v4，信封、密码和加密合同保持 v1；严格接受历史 v1/v2/v3。v4 已知模块版本、最低读者和必需能力限定读取，兼容未来会话可选参数只在声明区域过滤。
- 完整原始预算检查在克隆和过滤之前，结构／语义／资源验证在恢复计划及持久写入之前。路径报告进入预览／结果，私有兼容偏好纳入日志回滚并使再次导出继续提示潜在丢失；源文件不改写，被过滤值不保留或发送。
- AGENTS、架构、开发、计划和备份文档连接到持续开发合同，明确开发者必须主动完成注册、迁移／默认政策、测试及独立审查。

## 保留边界

`drawingSettings`／`drawingPresets` 注册及字段策略为 #93 接入准备，表状态仍为 `pending-93`，绘图维护保护保持。最新 #93 范围只允许已批准的无提示词设置和明确保存的纯文本预设；自动草稿提示词、参考／生成图片、任务／结果历史不纳入。#105 不实现 #93 全功能，也不重写 #83 历史规范。

未知结构、协议、凭据、安全或引用字段不作为可选参数忽略；未来版本声明也不能自动推断语义迁移。新客户端读取旧文件与旧客户端读取新文件分别验收；v4 不提供已发布旧客户端的追溯兼容。

## 验证证据

以下结果由主代理执行／核对并提供，覆盖最终本地代码；浏览器、编译、原生启动和真实交互证据分开记录。

| 检查 | 当前记录 |
| --- | --- |
| `npm.cmd run check:data-contracts` 及检查器回归 | 最终 `check` 内通过 15 项 Node AST／编译器变异测试；覆盖 13 张表、8 个偏好键、8 张实际备份表 |
| 迁移／默认值／工作区失败零写入回归 | 纳入最终全量门禁；补充 3 个非法 schema v2 样例均回滚至 schema 2 并保持全部行，1 个合法样例保持迁移数据 |
| v1/v2/v3/v4 读取、模块／能力拒绝、参数过滤、报告及回滚回归 | 纳入最终全量门禁；重点测试入口为 `src/backup/compatibility.test.ts`、`src/storage/dataContract.test.ts`、`src/storage/localDataCompatibility.test.ts` 及既有备份／工作区回归 |
| `npm.cmd run check` | 最终通过：15 项 Node 测试、109 个 Vitest 文件／1584 项测试、TypeScript 与 Vite 构建；仅保留既有大 chunk 提示 |
| Rust 检查及隔离原生启动烟雾 | `cargo check --locked --manifest-path src-tauri/Cargo.toml` 通过；`npm.cmd run tauri dev -- --config .data105.local/native-smoke.json --no-watch` 使用同一测试 identifier，先启动合成页面，再将隔离入口切至正式主页，两次均编译并运行 `target/debug/ayase-studio.exe`，第二次核实进程；仅有既有 libpng profile 提示，不接触正式配置；不替代原生交互 |
| 独立 Sol/high 审查与发现修复 | 首轮实质发现已修复；最终 316 项定向回归和 15 项策略测试通过，无遗留 P1／P2；旧 schema 补充审查的 54 项测试通过，无遗留 P1／P2 |
| 内置浏览器合成验收 | 实际 `BackupWorkspace` 和真实 codec：1280 浅色／720 深色无横向溢出；预览显示过滤路径，另存副本／替换确认、模拟恢复仅执行一次及再次导出警告通过；恢复为模拟边界，无实际文件／数据库写入 |
| 内置浏览器正式启动入口 | 同一未使用的隔离 origin 挂载正式 App，正常显示默认助手／新对话，捕获的 error／warn 为空；不读取真实用户配置或请求供应商 |
| 文档内容／相对链接／`git diff --check` | 已核对七份变更文档与实现入口；88 个相对文件链接目标存在，逐行尾部空白检查和 `git diff --check` 通过 |

确定性测试只使用合成数据，不读取真实用户备份／API Key、不发网络或供应商请求。原生文件选择／保存、实际桌面重启／中断、真实文件逐类恢复及设备断电边界不能由编译或浏览器测试代替。

合成浏览器与第一轮原生烟雾使用忽略目录 `.data105.local/` 中的 `acceptance.tsx`／`index.html` 和 `native-smoke.json`；第二轮保持测试 identifier，并将 devUrl 切至隔离 origin 的正式主页。它们作为本地可复查入口，不属于可交付用户数据或正式数据库。原生文件窗口、桌面重启和供应商调用本次均未验证。

## #93 接入后的当前状态（2026-10-01）

#93 已本地接入 `drawingSettings`／`drawingPresets`，注册策略由 `pending-93` 更新为 `projected`，新导出文档 v5，严格保留 v1–v4／v4 七模块合同。旧广泛绘图维护禁用规则由命令协调、私有原子回滚快照和原生文件围栏取代；旧记录中的相关限制现已被本轮实现取代，不再描述当前行为。

本轮确定性实例已补齐旧文件缺失绘图类别保留、未来可读参数过滤、不兼容结构／预算拒绝、预览和再次导出提示，以及旧日志和各恢复策略回滚。独立 Sol/high 审查完成，当前门禁及证据见 [#93 实施记录](ISSUE-93-IMPLEMENTATION.md)。上方测试数和 v4 格式是 #105 基础历史快照。

## #93 接入时的剩余接受（历史，2026-10-01）

#105 的绘图接入和确定性跨版本实例已补齐，原生文件窗口、实际重启／中断及真实用户恢复尚未接受，不记录为全部交付完成或关闭。#94 独立负责压力、资源／生命周期和桌面接受项；它不由本次兼容回归代替。用户已授权随 #93 交付必要基础代码，未要求关闭 #105。

## 收尾审计与修正（2026-10-02）

用户授权完成 #105 本地收尾，有必须人工执行的项再告知。远端 #105 正文及零评论已核对，仍为 OPEN；本轮未授权提交、推送或关闭。工作分支 `dev`，起点 `06db59b`；已有列表拖动和设置界面改动保留，不属于本项修正。

独立 Sol/high 只读审计用实际模块和合成内存存储复现两项 P2：搜索 profile 未知字段在读取时被丢弃，后续保存覆盖原文；外观容错显示把未知／损坏结构转换成默认视图，普通 setter 和备份导出随后抹去原始结构。两项均已修复：

- 搜索 v1 和 v2 MCP／API profile 用实际字段策略拒绝未知键，包括安全、协议及原型字段；保留已知规范化和历史迁移。显式默认草稿修复沿用已有用户操作合同。
- 外观 `readAppearancePreferences` 共享严格读取入口用于本机保存、真实备份投影／校验和恢复计划；已知旧缺省／crop／资源库迁移保持纯读取。显示回退仍可用，未知／损坏原文不能被普通设置覆盖或授权文件清理。合并／副本拒绝不可读外观；明确替换以日志保护原文，失败恢复精确原始字符串。
- 恢复日志／过滤报告重启回归改为关闭旧数据库连接、建立新的 `AyaseDatabase` 后恢复；不再只重新创建 repository。
- 数据注册及版本保持：13 张表、8 个偏好、8 张直接备份表，另有两张绘图投影表；Dexie v8、备份文档 v5／信封 v1、appearance v1、search v2。没有新增持久字段或推断语义迁移。

### 验收标准逐项对应

| #105 标准 | 实现与确定性证据 | 接受边界 |
| --- | --- | --- |
| 版本职责、迁移和共享关键入口 | `dataRegistry.ts`／`dataContract.ts`／`DATA-CONTRACTS.md`；连接、搜索、会话、绘图及外观本机／备份读入口 | 不为未变化模块虚构升级步骤；其余显示用容错不授权持久覆盖 |
| 历史 v1/v2/v3、本机旧记录、跨／重复迁移及默认 | `dataContract.test.ts`、`localDataCompatibility.test.ts`、`dataSafety.test.ts`、`chat/workspace.test.ts`、`backup/compatibility.test.ts`、`appearanceData.test.ts` | 字段重命名／单位换算是纯迁移 seam 的合成例，不代表产品新增转换；旧客户端未追溯改变 |
| 未来可读过滤、报告、严格拒绝及再次导出 | `backup/compatibility.test.ts`、`drawingIntegration.test.ts`；路径报告、预算先验、私有偏好及真实导出链路 | 只过滤已声明参数区，未知协议／资源／凭据／外观／预设结构拒绝；源文件不改写 |
| 新表／偏好／字段覆盖与秘密排除 | `scripts/check-data-contracts.test.mjs`、`check-data-policy-types.test.mjs`、`dataPolicies.ts` 实际投影；快照 allowlist 与未知／秘密字段回归 | 动态键仍需人工登记；静态检查不代替语义验证 |
| 各阶段失败、重开回滚与资源安全 | `backup/restore.test.ts`、`compatibility.test.ts`、`drawingIntegration.test.ts`；日志创建、文件写入、数据库事务、偏好、提交点和清理失败 | 假 IndexedDB 重开不能单独证明进程、OS 对话框或断电行为 |
| #93 模块接入、绘图设置／预设往返 | `drawingIntegration.test.ts`、`drawingPresets.test.ts` 和 #93／#101 实施记录 | 自动提示词草稿、历史、参考／成果图片仍排除，恢复零供应商派发 |
| 文档、门禁及独立审查 | 本记录、数据契约、架构、开发同步；本轮独立审查及最终检查记录如下 | 本地通过不代表远端交付或 Issue 关闭 |

### 本轮检查

- 全量 `npm.cmd run check` 通过：16 项 Node 门禁、119 个 Vitest 文件／1938 项测试、TypeScript 和 Vite 构建；证据 `.data105-check-final.local.log`。首次基线为 118 文件／1900 项通过，本轮新增 38 项，构建仍有既有大 chunk 提示。
- `cargo check --locked --manifest-path src-tauri/Cargo.toml` 通过；`cargo test --locked --manifest-path src-tauri/Cargo.toml ayase_backup` 通过 14 项原生备份文件测试，证据 `.data105-cargo-check.local.log`／`.data105-rust-backup.local.log`。
- 12 个定向文件／347 项通过，独立复核另执行 8 文件／228 项通过；修正后的生产代码无剩余 P1／P2。合成测试不读取真实配置或 API Key，不请求供应商。
- 最终合成入口 TypeScript、`git diff --check` 通过；七份相关文档的 119 个相对文件链接目标存在。换行转换提示不属于 diff 错误。

可复现的浏览器／原生／人工入口见 [scripts/data105](../scripts/data105/README.md)。跨进程探针使用独立 identifier，实际恢复生产日志入口、原生文件与 IndexedDB；它是备份专用合成入口，不能称为完整 App 退出／绘图请求生命周期、断电或真实用户数据接受。

### 实际运行结果与人工交接

四次原生运行使用 `io.github.ayaseminami.ayasestudio.data105finish`，先检查实际 identifier 才打开数据库；与正式数据目录隔离。两个种子入口分别留下 `staging`／`applying` 日志和真实合成附件，然后程序关闭。两个恢复入口在新的进程中调用生产 `recoverBackupAtStartup()`，均正常退出，报告 `passed`：

- BEFORE 与恢复后的完整私有快照 SHA-256 相等；applying 种子的修改确实被回滚。
- 日志拥有的 UUID 附件移除，日志不存在；重复恢复返回 false。
- 历史搜索／外观缺省迁移保持，实际 v5 导出往返通过；v1／v3 解码及未来可读参数警告再次导出通过。
- 原生报告 `providerCalls: 0`；合成入口不挂载聊天／绘图控制器，外部 fetch 被阻止。

证据为 `.data105.local/seed-staging-report.json`、`recover-staging-report.json`、`seed-applying-report.json`、`recover-applying-report.json` 及对应 `*-native.log`。首个种子试跑因测试页面拦截 Tauri 内部 IPC，在检查 identifier 前失败、未打开数据库；修正仅允许内部 IPC 后重新执行上述完整四次运行。该试跑不计成功证据。

内置浏览器使用独立 `Data105-browser` 数据库及模拟文件选择／保存，实际 `BackupWorkspace`、API、codec 和 Dexie：未来可读样例合并、v1 另存副本、v3 替换均显示成功；刷新后保留恢复结果，再次导出仍显示过滤路径与可能丢失参数警告。加密导出成功，错误密码拒绝，正确密码显示已校验 v5 预览及原兼容警告。界面截图已检查，测试页背景对比已修正。一次停服时的报告请求失败被丢弃，重新执行连续在线验收；不把这次中断观察作为产品失败或成功证据。`browser-report.json` 只保留最后一次报告，不代表完整动作历史。

原生人工窗口 `#105 隔离验收（合成数据）` 已启动，`manual-report.json` 为 `ready-for-manual`，`manualAcceptance: pending`。此状态只证明初始化、原生围栏、生产启动恢复、合成样例及编解码已就绪，不能证明系统文件对话框已操作。已向用户交接：

1. 导出先取消，再保存并重新打开；打开文件选择也取消一次，确认页面可继续操作。
2. 加密合成备份保存后分别输入错误／正确密码，确认拒绝及成功预览。
3. 从 `.data105.local/` 选择 `fixture-v1.ayasebackup`、`fixture-v3.ayasebackup`、`fixture-future-readable.ayasebackup`，确认旧版预览、未来参数警告及导入确认；合并／副本／替换只作用于此合成窗口。

用户随后明确回复“我已验收通过”，本轮交接的系统文件对话框／合成备份人工检查据此记录通过。这是用户提供的验收结果；初始化报告中的 `manualAcceptance: pending` 是操作前快照，不冒充机器自动证明交互通过。#105 本地实现、修正、独立审查、自动门禁、跨进程恢复及人工验收收尾完成，当前没有本项剩余本地阻塞。

真实用户备份、完整应用生命周期／压力和断电仍属独立接受边界，不因本次确认扩大。用户已有未提交 UI 工作保留；收尾验收时未执行 Git 提交、推送或远端操作，核对远端 #105 为 OPEN。用户随后明确授权提交／推送本项、把既有 #95 提交 `069f3a5` 一起推送并关闭 #105；实际交付状态及提交号以远端 Issue 验收评论和 Git 历史为准。
