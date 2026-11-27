# #106 正式版（0.1.0）发布前最终全面评估与整改方案

日期：2026-11-27。状态：**WP1–WP5 施工已完成、全部自动化门禁绿灯并经 Codex 独立只读复核逐项闭环；现已停靠并向用户汇报，等待用户决定提交、发布与 Windows x64 实机验收安排，不直接提交、推送、构建发布或关闭 Issue。**

需求：[Issue #106](https://github.com/AyaseMinami/AyaseStudio/issues/106)（经用户于 2026-11-26 升级为「正式版发布前的最终评估」，不另建新 Issue）。
基线：`dev` @ `875082ec9916af534a4db9ca772748b9b7da84ed`（审查全程工作区干净）。
对照历史记录：[#57 / #106 2026-10-03 非样式审查记录](ISSUE-57-106-AUDIT.md)（基线 `8414d8b`，此后合并 `#118`、`#119`、`#76`、`#127`、`#128`、SVG/GIF 绘图、`#130`–`#132`、`#136`–`#138`、`#140`–`#143`、`#126` 等 26+ 项重大变更）。

---

## 1. 评估结论与基线实测

### 1.1 最终放行裁定（Antigravity 主导）

当前 `dev` @ `875082e` **暂不直接放行 Stable（NO-GO）**。自动化基线全绿且 **无 P0 缺陷**，但双 Agent 独立审查与交叉核对确认了：
- **4 项代码层必须先修项（`B1`–`B4`）** 与 **1 项 Windows 重解析点条件性风险（`C1`）**；
- **7 组已确认 P2 缺陷（`M1`–`M7`）** 与 **1 组结果页内存收窄优化（`M8a`）**；
- **一批可安全清理的死代码、重复校验与仓库卫生项**；
- **正式版 `0.1.0` 发布准备项**（版本号同步、README/文档更新、随包 `THIRD-PARTY-NOTICES`、安装器 `Beta → Stable` 策略矩阵及 Windows 实机候选验收）。

### 1.2 基线自动化门禁实测（`875082e`）

| 检查项 | 命令 | 结果 |
| --- | --- | --- |
| 发布脚本测试 | `npm.cmd run check:release` | 30 / 30 通过 |
| 数据契约门禁 | `npm.cmd run check:data-contracts` | 16 / 16 通过（14 表 / 9 偏好键 / 9 备份表） |
| 前端单元测试 | `npm.cmd run test` | 187 文件 / 3,377 测试通过 |
| TypeScript & 生产构建 | `npm.cmd run build` + `tsc --noEmit --noUnusedLocals --noUnusedParameters` | 通过（0 错误，0 未使用局部/参数） |
| Rust 核心测试与检查 | `cargo test --locked` / `cargo check --locked` | 195 passed, 0 failed, 1 ignored（私有 Cherry 样本） |
| 原生签名助手测试 | `cargo test --locked --features release-tools --bin verify-updater-signature` | 1 / 1 通过 |
| Rust Clippy 静态检查 | `cargo clippy --locked --all-targets -- -D warnings` | 7 条非功能告警（待 WP4 清理） |
| 锁文件与许可清单核对 | `package-lock.json` / `Cargo.lock` SHA-256 比对 [THIRD-PARTY-DEPENDENCIES.md](THIRD-PARTY-DEPENDENCIES.md) | 272 npm / 151 非 dev / 608 Rust / 11 品牌资产哈希完全一致 |
| 空白与文档本地链接 | `git diff --check` + 全仓 Markdown 本地链接扫描 | 通过（除 `#116` 按 [docs/README.md](README.md) 有意退休的 `.local` 截图外 0 断链） |

---

## 2. 已拍板产品与发布决策（2026-11-27 确认）

| 决策项 | 用户拍板结论 | 实施约束 |
| --- | --- | --- |
| **Issue 归属** | 不新建 Issue，全部纳入 **#106** | 大体量架构重构（如大附件二进制 HTTP IPC、流式 ZIP 容器备份）留待正式版后另开 Issue，不扩大本轮范围。 |
| **便携 `.ayase` 备份上限** | 调高至 **`96 MiB` 原始资源 / `160 MiB` 文档载荷 / `256 MiB` 单文件**（原 `48 / 80 / 128 MiB` 翻倍） | 保持 `envelope v1` / `document v5` 及其余预算（2,000 资源 / 100,000 消息 / 8 MiB 非资源字符串）不变；同步修掉 `BackupWorkspace` 结果页滞留完整备份对象（`M8a`）。旧版读者需同时满足旧三项容量上限（48 / 80 / 128 MiB）及兼容模块版本要求，超过任一旧上限的备份需 `0.1.0+` 读取。 |
| **随包第三方开源许可声明** | **随安装包附带 `THIRD-PARTY-NOTICES`**（由 Antigravity 撰写并校验） | 通过 `src-tauri/tauri.conf.json` `bundle.resources` 随安装包分发，覆盖主项目 MIT 及实际分发的主要第三方开源依赖/字体/图标/SQLite/ring/resvg/NSIS 模板声明，同步更新 [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md)。 |
| **11 个厂商品牌图标** | **保留现状**（个人非商用开源项目） | 维持 [README.md](../README.md)、[THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md) 与 [SOURCES.md](../src/avatar/brands/SOURCES.md) 的非 MIT / 非厂商背书声明及原始字节哈希，不替换或重采样。 |
| **正式版版本号与停靠点** | 目标版本号 **`0.1.0`**；**完工后先停下来汇报，不直接发布** | 施工时同步 5 处版本源及 `README.md` / `PRODUCT.md` 中 Beta 描述；完成后必须先经完整自动化门禁与独立只读复核，再向用户汇报等待确认，**禁止自动 commit / push / 触发发布工作流 / 关闭 Issue**。 |
| **其余既定边界** | 沿用既有产品决定 | `#132` 大附件维持官方协议上限（在发布说明与文档如实提示 12.1–13.5 GB 私有内存峰值及低内存主机风险）；保留旧 `import_drawing_reference` 与 `scripts/` 历史验收夹具，本轮不删除。 |

---

## 3. 跨 Agent 交叉核对与修正摘要

Antigravity 与 Codex 分别独立审查后开展了第二轮举证沟通，以下为关键交叉校准结果：
- **双方独立命中**：`B4`（35 个主窗口自定义 Tauri 命令缺少窗口标签校验）、重复执行的 `scripts/release/*.test.mjs`、死组件 `AssistantAvatarDefaults.tsx` 与死导出 `getActiveProvider`/`getActiveModel`、版本/Beta 文案、安装器 `Beta → Stable` 缺口与第三方许可随包缺口。
- **Codex 首轮发现、Antigravity 逐行证实**：`B1`（备份回滚缺表清空风险）、`B2`（聊天/目录自定义 Key 头随跨源重定向泄露风险）、`M4`（SSE 缺单 `\r` 分隔）、`M8a`（备份结果页保留完整 `BackupPreview`）、`M8b`（`tauri-plugin-updater` 临时目录残留属上游行为）。
- **Antigravity 首轮发现、Codex 复核证实并校准**：`B3`（`#141` `prepareSearchContext` 漏传 `replayScope`）、`C1`（`file_safety.rs` `0x400` 拦截可见非链接重解析点；Codex 补充微软 Cloud Files 默认隐藏标记，故校准为按 Reparse Tag 修复 + 实机验收）、`M1`（Codex 进一步揭示 `unavailable.current` 未清理会让 `isSettled()` 永久为假并阻塞备份/更新，由轻量内存泄漏升级为高优先 P2）、`M2`（校准为 P2/A）、`M3`、`M5`、`M6`、`M7`。
- **经交叉核对驳回/降级的误报**：
  - `SearchResults.tsx:49` `meta[http-equiv='refresh']`：经按 HTML Living Standard（HTML 文档 `http-equiv` 匹配本就 ASCII 不区分大小写）与 Chromium Blink 沙箱实现复核，原 P1 绕过不成立，降级为可选 1 行加固（移除全部供应商 `meta`）。
  - `drawing_output.rs` 入队失败遗留定位文件：经核对 [DATA-CONTRACTS.md](DATA-CONTRACTS.md#L82)，该行为已明文写入数据合同，不再作为契约缺陷处理。
  - `AvatarSettings.tsx:18` `open()` 缺少重入锁：按钮已有 `disabled={busy}`，降级为防御性清理。

---

## 4. 分阶段施工方案（待下一对话由 Antigravity 主导执行）

### WP1 · 发布前必须先修（Go/No-Go 代码阻断：B1–B4 + C1）

1. **`B1` · 启动备份回滚私有日志严格校验**（[src/backup/repository.ts](../src/backup/repository.ts#L36-L66)）
   - 在 `recover()` 执行任何写盘前，严格校验 `journal` 结构：`id === "restore"`、`phase` 仅允许 `"staging" | "applying"`、`before` 为纯对象、`before.rows` 必需表（除旧日志可省略 `providerAvatars` 外）均须为数组、`before.preferences` 为纯对象、`references` 为字符串数组；若含 `before.drawing`，校验其结构（`presets` 为数组等）。
   - 结构损坏或不受支持时**零写入、保留原数据与原日志**并抛出明确恢复错误，绝不将缺表按 `?? []` 清空。
   - 回归测试：覆盖未知阶段、缺失必需表、非法引用导致的零写入，同时验证已知旧日志（缺 `providerAvatars` / 缺 `drawing`）仍正常回滚。

2. **`B2` · 聊天与模型目录统一禁止 HTTP 重定向**（[src/chat/runtime.ts](../src/chat/runtime.ts#L4-L24)、[src/chat/transport.ts](../src/chat/transport.ts#L691-L699)、[src/chat/transport.ts](../src/chat/transport.ts#L860-L872)、[src/chat/modelCatalog.ts](../src/chat/modelCatalog.ts#L194-L245)）
   - 与绘图（[src/drawing/runtime.ts](../src/drawing/runtime.ts#L34)）及外部搜索（[src/search/runtime.ts](../src/search/runtime.ts#L18)）保持一致：桌面 `tauriFetch` 封装统一传 `maxRedirections: 0`；Fetch 层请求统一传 `redirect: "error"`，并对收到的 `3xx` 响应返回清晰脱敏错误提示（引导填写最终 Base URL，绝不随重定向转发 `x-goog-api-key` / `x-api-key` / `Authorization` 或重送请求体）。
   - 回归测试：覆盖四协议聊天（流式/非流式）与模型目录的 3xx/redirect 拦截及无凭据泄露。

3. **`B3` · 修复 `#141` 外部搜索续轮漏传 `replayScope`**（[src/search/context.ts](../src/search/context.ts#L22-L30)、[src/chat/useChatSession.ts](../src/chat/useChatSession.ts#L1268-L1269)）
   - `prepareSearchContext` 增加 `replayScope?: string` 参数并透传至 `planContextBudget(..., replayScope)`；在 `useChatSession.ts` 调用处传入当前 `replayScope`。
   - 回归测试：覆盖 Anthropic Native / OpenAI Responses 同连接外部搜索续轮保留历史合法 `providerReplay` 并计入预算，跨连接仍拒绝回放，外部搜索历史自身仍按既有规则转纯文本且剥离 `providerReplay`。

4. **`B4` · 主窗口专属自定义 Tauri 命令权限门禁与托盘源收紧**（[src-tauri/src/lib.rs](../src-tauri/src/lib.rs#L73-L116)、[src-tauri/src/tray.rs](../src-tauri/src/tray.rs#L70-L84) 及 6 个业务模块）
   - 新增共享 `require_main_window(window: &tauri::WebviewWindow) -> Result<(), String>`（校验 `window.label() == "main"`），接入 `attachments.rs`、`background.rs`、`drawing.rs`、`drawing_output.rs`、`ayase_backup.rs`、`cherry_import.rs` 全部 35 个主窗口专属 `#[tauri::command]`。
   - 在 `tray.rs:77-78` 区分调试与发布：`#[cfg(debug_assertions)]` 保留 `localhost` / `127.0.0.1` / `tauri.localhost`，发布构建（`#[cfg(not(debug_assertions))]`）仅允许 `tauri.localhost` 且限 `http`/`https` 协议。
   - 回归测试：验证非主窗口标签被拒及托盘导航策略函数在 release/debug 下的放行边界。

5. **`C1` · Windows `file_safety` 按 Reparse Tag 精确区分链接与非链接系统文件**（[src-tauri/src/file_safety.rs](../src-tauri/src/file_safety.rs#L16-L90)）
   - 在 Windows 上读取重解析标签（如通过 `FindFirstFileW` `dwReserved0` 或 `GetFileInformationByHandleEx(FileAttributeTagInfo)`）：
     - 明确拒绝名称代理/重定向链接：`IO_REPARSE_TAG_SYMLINK`（`0xA000000C`）、`IO_REPARSE_TAG_MOUNT_POINT`（`0xA0000003`）及任意未知/带 `IsReparseTagNameSurrogate`（`0x2000_0000`）位的标签；
     - 明确放行经核验的非链接系统数据标签（如 CompactOS `IO_REPARSE_TAG_WOF` `0x80000017`、OneDrive/Cloud Files `IO_REPARSE_TAG_CLOUD*` 族）；
     - `checked_read` 对非链接文件采用正常内容打开（不对其传 `FILE_FLAG_OPEN_REPARSE_POINT` 破坏 WOF/Cloud 透明读取），仍保留打开后句柄元数据复检、文件类型检查与严格限量读取；对符号链接/目录联接测试保持全部通过。

---

### WP2 · 已确认 P2 缺陷修复（M1–M7 + 可选加固）

1. **`M1` · 彻底修剪已删除对话的 `views` 与 `unavailable`**（[src/chat/useConversationWorkspace.ts](../src/chat/useConversationWorkspace.ts#L165-L177)）
   - 独立遍历并修剪 `stores.current`、`views.current`、`unavailable.current`，避免重载失败后删除对话泄漏内存并令 `isSettled()` 永久返回 `false` 阻塞备份/更新。补齐回归测试。
2. **`M2` · 补齐应用内更新安装前门闩**（[src/App.tsx](../src/App.tsx#L71-L78)）
   - 与 `backupDisabled`（第 189 行）对齐，在调用 `installUpdate` 前同样拦截 `appearance.backgroundBusy || avatar.busy || !drawing.ready || drawing.closing || drawing.managementBusy || drawing.presetsBusy || drawing.referencesBusy`，并补齐单测。
3. **`M3` · 修复 Cherry SQLite `NOT IN` 可空 `topic.id` 静默丢消息**（[src-tauri/src/cherry_sqlite.rs](../src-tauri/src/cherry_sqlite.rs#L514)）
   - 子查询补 `AND id IS NOT NULL`，新增包含 `NULL` 软删 `topic` 的 Rust 回归测试。
4. **`M4` · SSE 解析器支持合法单 `\r` 行尾**（[src/chat/sse.ts](../src/chat/sse.ts#L65-L94)）
   - 按 WHATWG SSE 规范正确处理 `\r\n`、`\n` 与孤立 `\r`（含跨 chunk 的 `\r` + `\n` 合并），补充回归测试。
5. **`M5` · `#128` 历史消息编辑 3 处边界修复**（[src/chat/messageEdits.ts](../src/chat/messageEdits.ts#L107-L110)、[src/chat/useChatSession.ts](../src/chat/useChatSession.ts#L1508-L1553)）
   - `MessageEdits.accept` 中 `committed()` 同步抛错时在 `catch` 调用 `op.prepared?.cancel?.()` 释放生成权；
   - `editAndSendMessage` 的 `claim()` 检查 `!closingRef.current`，阻止退出结算窗口期内启动新的外部搜索/生成；
   - 非外部搜索的 `editAndSendMessage` 在提交成功后发布 `setContextPlan(summarizeContextPlan(planned))`。
6. **`M6` · Rust 文件安全、解码与围栏 4 处加固**
   - [src-tauri/src/background.rs](../src-tauri/src/background.rs#L448-L456)：将 `select_background_image` 的 `blocking_pick_file()` 移入 `spawn_blocking`；
   - [src-tauri/src/cherry_leveldb.rs](../src-tauri/src/cherry_leveldb.rs#L203-L205)：`key_len + length + 128` 改为链式 `checked_add`，补畸形长度单测；
   - [src-tauri/src/drawing.rs](../src-tauri/src/drawing.rs#L457-L473)：优化受管参考图 `read()` 路径，校验格式与完整性但不必每次重复完整解码并丢弃 `DynamicImage`（不新增会拒绝合法参考图的新像素门槛，遵守 `#86` 合同）；
   - [src-tauri/src/attachments.rs](../src-tauri/src/attachments.rs#L145-L276)、[src-tauri/src/background.rs](../src-tauri/src/background.rs#L285-L290)、[src-tauri/src/ayase_backup.rs](../src-tauri/src/ayase_backup.rs#L388-L404)：将 `attachments.rs` / `background.rs` 受管读取统一接入 `file_safety` 有界读取（基于 `C1`），并为 `drawing.rs` / `background.rs` 补齐 `spawn_blocking` 入队前 in-flight 计数，供 `ayase_backup_fence` 真正等齐排队任务。
7. **`M7` · 状态与缓存细节 4 处 + 2 处轻量防御加固**
   - [src/ui/avatar/ProviderAvatar.tsx](../src/ui/avatar/ProviderAvatar.tsx#L9-L17)：`!imageId` 时调用 `setImage(undefined)` 及时释放旧 `UserAvatar` Blob；
   - [src/chat/repository.ts](../src/chat/repository.ts#L403-L404)：`delete-message` 同步清除孤立助手消息上的 `providerReplay`；
   - [src-tauri/src/updater.rs](../src-tauri/src/updater.rs#L109-L116)：超 `MAX_DOWNLOAD` 区分于普通取消，返回大小超限错误提示；
   - [src/update/controller.ts](../src/update/controller.ts#L86-L90)：下载失败路径显式清理旧会话引用与状态保持一致；
   - 可选加固：[src/ui/chat/SearchResults.tsx](../src/ui/chat/SearchResults.tsx#L49) 直接移除全部供应商 `meta` 标签；[src/ui/settings/AvatarSettings.tsx](../src/ui/settings/AvatarSettings.tsx#L18-L27) 补同步重入序号守卫。

---

### WP3 · 便携备份容量翻倍（`96 / 160 / 256 MiB`）与结果页内存收窄（M8a）

1. **统一调高三道预算常量（格式保持 `envelope v1` / `document v5` 不变）**：
   - 原始资源总计：`48 MiB` → **`96 MiB`**（[src/backup/snapshot.ts](../src/backup/snapshot.ts#L108-L109)、[src/backup/validation.ts](../src/backup/validation.ts)、[src-tauri/src/ayase_backup.rs](../src-tauri/src/ayase_backup.rs#L15)）；
   - 文档载荷 `MAX_PAYLOAD`：`80 MiB` → **`160 MiB`**（[src/backup/codec.ts](../src/backup/codec.ts#L7)）；
   - 单备份文件 `MAX_BACKUP_FILE` / `BACKUP_LIMIT`：`128 MiB` → **`256 MiB`**（[src/backup/codec.ts](../src/backup/codec.ts#L6)、[src-tauri/src/ayase_backup.rs](../src-tauri/src/ayase_backup.rs#L14)）；
   - 同步更新错误提示文案、前后端边界单元测试及 [docs/AYASE-BACKUP.md](AYASE-BACKUP.md#L56)、[docs/DATA-CONTRACTS.md](DATA-CONTRACTS.md)。
2. **收窄备份维护页结果态内存（`M8a`）**（[src/ui/settings/BackupWorkspace.tsx](../src/ui/settings/BackupWorkspace.tsx#L68,L154,L189)）：
   - `exportResult` 与 `restoredPreview` 仅保留展示所需的轻量摘要（数量、加密状态、兼容提示、过滤路径等），导出/恢复完成后释放完整 `BackupDocument` 及其中 Base64 资产引用，降低维护页并发峰值内存。

---

### WP4 · 可安全清理的冗余代码与仓库卫生

1. 删除完全无引用的死组件 `src/ui/settings/AssistantAvatarDefaults.tsx`（已删除；保留 [src/avatar/assistantDefaults.ts](../src/avatar/assistantDefaults.ts) 中数据契约注册键的读写实现以通过 `check:data-contracts`）。
2. 移除零引用单行包装导出 `getActiveProvider()`、`getActiveModel()`（[src/chat/settings.ts](../src/chat/settings.ts#L148-L152,L184-L188)）与仅被孤立单测引用的 `estimateInlineRequestBytes()` 及其孤立用例（[src/chat/contextBudget.ts](../src/chat/contextBudget.ts#L32)）。
3. 消除两处明确重复校验：
   - [src/backup/validation.ts](../src/backup/validation.ts#L265)（已于第 231 行执行过相同的 `validateConnections`，此处仅保留 `else check(raw.connections === null)`）；
   - [src/drawing/controller.ts](../src/drawing/controller.ts#L165-L168)（已于第 163 行 `validateOwnership(saved)` 内完成 `validGeminiDrawingOptions` 校验）。
4. 清理 [src-tauri/src/drawing_formats.rs](../src-tauri/src/drawing_formats.rs#L298-L300,L317-L335) 中 21 个废弃 `<pattern>` / `<filter>` 属性白名单。
5. 清理 CI 与发布脚本冗余：
   - [.github/workflows/ci.yml](../.github/workflows/ci.yml#L24-L25) 与 [.github/workflows/release-candidate.yml](../.github/workflows/release-candidate.yml#L45-L46) 去除 `npm.cmd run check` 之前重复的 `node --test scripts/release/*.test.mjs`；
   - `release-candidate.yml` 第 59–65 行复用 `scripts/release/verify-product-version.ps1`（或移除与随后 `prepare` 重复的大小写不敏感检查）；
   - [scripts/release/local.mjs](../scripts/release/local.mjs#L27) 移除 `loadArtifacts(directory, version)` 未使用参数 `version`。
6. 在 [ConnectionSettings.tsx](../src/ui/settings/ConnectionSettings.tsx#L334) 与 [DrawingWorkspace.tsx](../src/ui/drawing/DrawingWorkspace.tsx#L241) 中随列表项删除同步修剪折叠/展开 `Set` 里的残留旧 ID。
7. 清理 `cargo clippy --locked --all-targets -- -D warnings` 全部 7 条常规告警（`tray.rs`、`drawing_formats.rs`、`cherry_legacy.rs`、`instance_lock.rs`）。

---

### WP5 · 正式版 `0.1.0` 准备、随包 `THIRD-PARTY-NOTICES`、策略矩阵与文档同步

1. **随包第三方开源许可声明**：
   - 新增根目录或打包资源文件 `THIRD-PARTY-NOTICES.txt`（内容按锁定依赖与 [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md) 编写，涵盖 Ayase Studio MIT、主要 npm/Rust MIT/Apache-2.0/ISC/BSD/MPL 依赖声明、KaTeX 及数学字体 MIT、Lucide ISC + Feather MIT、PDF.js Apache-2.0、SQLite 公有领域归属、ring/BoringSSL/webpki-roots 复合声明、resvg/usvg/roxmltree、Tauri NSIS 模板 MIT 及非 MIT 品牌标识声明）；
   - 在 [src-tauri/tauri.conf.json](../src-tauri/tauri.conf.json#L40-L57) 的 `bundle.resources` 中注册随安装目录分发，并同步更新 [docs/THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md)（标注随包 notices 已补齐、11 个品牌图标按用户个人非商用开源决定保留现状）。
2. **安装器升级策略矩阵补齐**：
   - 在 [scripts/test-installer-policy.ps1](../scripts/test-installer-policy.ps1#L43-L53) 补齐 `0.1.0-beta.11 → 0.1.0`（升级）、`0.1.0 → 0.1.0`（同版重装）、`0.1.0 → 0.1.0-beta.11`（降级）三条策略用例。
3. **版本对齐 `0.1.0`（5 处版本源）**：
   - `package.json`、`package-lock.json`（两处根版本字段）、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`（根包）、`src-tauri/tauri.conf.json` 全部对齐至 `0.1.0`；通过 `scripts/release/release.test.mjs` 与 `cli.mjs` 版本对齐校验。
4. **文档同步**：
   - [README.md](../README.md)：将「处于 Beta 测试阶段 / 最新 Beta 版本 / Beta 仍在迭代」更新为 `0.1.0` 正式版口径；补齐近期落地的 `#126` 全局字号比例、`#138` 无气泡助手阅读与壁纸磨砂、`#137` 模型选择器重构、`#141` DeepSeek 服务端联网等核心功能；如实说明未做 Windows Authenticode 签名及大附件内存特征与 `96 MiB` 便携备份上限；
   - 同步更新 [PRODUCT.md](../PRODUCT.md)、[ARCHITECTURE.md](ARCHITECTURE.md)、[DATA-CONTRACTS.md](DATA-CONTRACTS.md)、[PROTOCOLS.md](PROTOCOLS.md)、[AYASE-BACKUP.md](AYASE-BACKUP.md)、[PLAN.md](PLAN.md)，并记录本轮 `#106` 实施与复核结果。

---

## 5. 全量缓存与临时资源审查基线（2026-11-26）

下表记录 `875082e` 基线全部前端与原生缓存、内存容器、Object URL、懒加载单例及磁盘临时/派生文件的所有者、生命周期与容量边界（供 `#106` 验收留档与修复对照）：

| 所有者与定位 | 键与内容 | 生命周期、失效与失败行为 | 容量／内存／磁盘边界 | 本轮处理 |
| --- | --- | --- | --- | --- |
| **头像预览缓存**<br>[previewCache.ts](../src/avatar/previewCache.ts#L15-L95) | `WeakMap<Blob, Promise<string>>`；`Map<mime:sha256, Entry>` | 引用计数租约；失败剔除并撤销 URL；HMR 清理空闲项 | 空闲 LRU **32 项 / 8 MiB**；活跃项按调用方持有 | 保持 |
| **用户头像与裁切 URL**<br>[useUserAvatar.ts](../src/avatar/useUserAvatar.ts#L21-L25) · [AvatarLibrary.tsx](../src/ui/avatar/AvatarLibrary.tsx#L68-L95) · [AvatarSettings.tsx](../src/ui/settings/AvatarSettings.tsx#L17-L27) | 单缩略图 / 裁切原图 Object URL | `useEffect` 变更与卸载撤销；库/助手编辑器有代次锁 | 1 URL / 弹窗（原图 ≤20 MB） | `AvatarSettings` 补防重入锁（WP2） |
| **供应商独立头像**<br>[providerAvatars.ts](../src/avatar/providerAvatars.ts#L24-L43) · [ProviderAvatar.tsx](../src/ui/avatar/ProviderAvatar.tsx#L9-L17) | Dexie `providerAvatars` 持久快照；组件 state `{ id, value }` | 持久表无自动 GC（`#100` 边界）；组件卸载释放 | 无磁盘配额；单组件最多持 20 MB `original` | `M7`：切离自定义图清空 state |
| **本地分词器缓存**<br>[contextBudget.ts](../src/chat/contextBudget.ts#L61-L85) | `tokenizerCache: Map<encoding, TokenCounter>` | 进程生命期；冷并发 import 后二次查缓存；不缓存失败 | 最多 **2 项**（`o200k_base` / `cl100k_base`） | 保持 |
| **代码高亮语法单例**<br>[CodeBlock.tsx](../src/chat/CodeBlock.tsx#L7-L18) | 模块级 `lowlight` + `React.memo` / `useMemo` | 进程生命期不可变语法；单块 HAST 随卸载释放 | 固定 ~38 种语言 | 保持 |
| **对话工作区 Store 与视图**<br>[useConversationWorkspace.ts](../src/chat/useConversationWorkspace.ts#L35-L38) | `stores`、`views`（消息、草稿、`File`、contextPlan）、`unavailable` | 会话常驻；编辑先 detach 后重读；删除/卸载释放 | 无 LRU/总字节上限（关联 `#35`） | **`M1`**：独立修剪三集合防锁死备份 |
| **连接目录、测试与控制器**<br>[useChatSession.ts](../src/chat/useChatSession.ts#L269,L305-L315) | 连接/模型 ID → 目录、探测、AbortController、60s 命名超时、`imports` 计数 | 配置变更及单/批删失效；控制器身份防迟到；卸载全取消 | 随配置数与活动请求 | 保持 |
| **`#128` 历史编辑与附件租约**<br>[messageEdits.ts](../src/chat/messageEdits.ts#L38-L41) · [attachmentLifecycle.ts](../src/chat/attachmentLifecycle.ts#L5-L9) · [MessageEditor.tsx](../src/ui/chat/MessageEditor.tsx#L85-L86) | 对话 ID → before/after 快照与新文件；`leases`/`reserved`/`discardRetries`；异步文件批次 | 正常完成释放；结果不明留保护供显式核对；取消作废 token | 每对话至多 1 个活跃编辑 | **`M5`**：3 处边缘交互修复 |
| **流式解码、搜索与用量**<br>[transport.ts](../src/chat/transport.ts#L432) · [searchDecoding.ts](../src/chat/searchDecoding.ts#L65) · [jsonSearch.ts](../src/search/jsonSearch.ts#L59) | 单次请求内事件、思考块、工具键、回放块、用量快照 | 请求结束或中止立即释放；无跨请求缓存；不自动重试 | 外部 JSON 搜索 **30s / 2 MiB**；模型流无总长度上限 | **`B2`/`B3`/`M4`** |
| **模型选择器与批量设置状态**<br>[ModelPicker.tsx](../src/ui/chat/ModelPicker.tsx#L211) · [ConnectionSettings.tsx](../src/ui/settings/ConnectionSettings.tsx#L334) · [DrawingWorkspace.tsx](../src/ui/drawing/DrawingWorkspace.tsx#L241) | DOM ref Map；供应商折叠集、绘图展开集 | DOM ref 卸载即删；批量选中随上下文重置 | 随配置数 | WP4：随删项修剪折叠/展开 Set |
| **背景控制器与原生缩略图**<br>[appearance.ts](../src/appearance/appearance.ts#L847-L904) · [background.rs](../src-tauri/src/background.rs#L130-L185) | URL Promise Map；磁盘 `backgrounds/thumbnails/*.png` | 并发共享；失败按身份剔除；刷新绕过；清理成对删除 | JS 仅存 URL；缩略图 ≤512px / 热读 ≤2 MiB / 解码 ≤4 MiB | **`M6a/d`** |
| **绘图控制器、参考图与预览**<br>[controller.ts](../src/drawing/controller.ts#L127-L147) · [useDrawingWorkspace.ts](../src/drawing/useDrawingWorkspace.ts#L54-L69) · [DrawingResultThumbnail.tsx](../src/ui/drawing/DrawingResultThumbnail.tsx#L12-L40) | `active`/`unsaved`（仅保存失败滞留原像素）；会话参考图 `Blob`；大图/缩略图 Object URL | 落盘/丢弃释放 `unsaved`；Object URL 切换/卸载撤销；缩略图不落盘 | 并发 1–4、每批 1–99、历史 50/页；`unsaved` 故意无上限 | **`M6c`**（去掉参考图 `read()` 重复整图解码） |
| **原生 SVG 字体库与绘图定位**<br>[drawing_formats.rs](../src-tauri/src/drawing_formats.rs#L621-L626) · [drawing_output.rs](../src-tauri/src/drawing_output.rs#L17-L21) | `FONTS: OnceLock<Arc<fontdb::Database>>`；`drawing-locations/<UUID>.json`；`NamedTempFile` | `FONTS` 首次 SVG 解码加载并进程复用；定位文件按合同持久保留 | SVG 4 MiB / 5 万展开 / 256 MiB 栅格；GIF 64 帧 / 128M 像素 | WP4 清理废弃属性白名单 |
| **附件预览、复制与 PDF Worker**<br>[SentAttachmentPreview.tsx](../src/ui/chat/SentAttachmentPreview.tsx#L7-L54) · [SentImageAttachment.tsx](../src/ui/chat/SentImageAttachment.tsx#L16-L38) · [PreviewImage.tsx](../src/ui/chat/PreviewImage.tsx#L42-L73) | 视口外 >300px 卸载内联图；按需 `pdfjs-dist` worker；离屏 `<canvas>` 复制 PNG | PDF import 后检取消、清理销毁 task；Office 跳过读字节 | PDF ≤1800px / 4M 像素；无跨预览缓存 | 保持 |
| **原生附件 Staging / 隔离与进程锁**<br>[attachments.rs](../src-tauri/src/attachments.rs#L10-L47) · [instance_lock.rs](../src-tauri/src/instance_lock.rs#L5-L17) | `FILE_OPERATIONS` + `IN_FLIGHT`；`.instance.lock`；`staging`/`quarantine` | 未引用转 quarantine，30 天宽限 + 1 小时双扫删；备份前 `wait_for_idle()` | 无总磁盘配额 | **`M6d`** + Clippy |
| **`#76` 应用内更新会话**<br>[update/controller.ts](../src/update/controller.ts#L28-L153) · [updater.rs](../src-tauri/src/updater.rs#L13-L162) | 根单会话 + Rust `UpdateState`（元数据、取消信号、安装包 `Vec<u8>`） | 取消/失败/重查/安装开始释放 `bytes`；`dispose()` 清 10s 计时器 | 内存上限 **512 MiB**（超时 20s / 300s）；上游插件临时目录跨进程残留记入已知限制 | **`M2` / `M7c-d`** |
| **Cherry 原生归档会话**<br>[cherry_import.rs](../src-tauri/src/cherry_import.rs#L13-L24) · [DataImportSettings.tsx](../src/ui/settings/DataImportSettings.tsx#L14-L41) | 单 `SESSION` token → ZIP 句柄与文件索引；`TempDir` | 替换或匹配 token 关闭；卸载自动关闭；`TempDir` 预览结束即删 | 归档 ≤2 GiB / 5 万条；聊天 ≤128 MiB；单文件 ≤64 MiB；累计读取 ≤1 GiB | **`M3` / `M6b`** |
| **备份快照与恢复维护页**<br>[BackupWorkspace.tsx](../src/ui/settings/BackupWorkspace.tsx#L68-L78) · [backup/snapshot.ts](../src/backup/snapshot.ts#L102-L142) | 单次导出/恢复 Map；维护页状态留存预览/结果 | 退出 `#backup` 整页 `reload()` 全量释放 | 升级为 **96 MiB 资源 / 160 MiB 文档 / 256 MiB 文件** | **`B1` / WP3 (`M8a`)** |
| **滚动条自动隐藏与托盘**<br>[scrollbarAutoHide.ts](../src/ui/scrollbarAutoHide.ts#L17-L31) · [tray.rs](../src-tauri/src/tray.rs#L13-L147) | 活跃滚动容器 `Map`（700ms 计时器与 Web Animation）；隐藏 `tray-menu` WebView | 空闲/分离节点回收；主窗销毁触发 `handle.exit(0)` | ≥500 子节点跳过动画；固定 1 个轻量托盘 WebView | **`B4`** 托盘导航收紧 |

---

## 6. 施工验收门禁、停靠点与实机发布边界

### 6.1 施工完成后的代码与复核门禁（全部通过后停下来汇报）

```powershell
npm.cmd run check
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo test --locked --features release-tools --manifest-path src-tauri/Cargo.toml --bin verify-updater-signature
cargo check --locked --manifest-path src-tauri/Cargo.toml
cargo clippy --locked --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings
git diff --check
git status --short --branch
```

- 除上述自动化门禁外，因涉及备份恢复逻辑、备份预算、Tauri IPC 安全边界与原生文件安全，施工完成后必须安排**独立只读复核**（如由未参与改码的 Codex 独立复审最终完整 diff 与新增回归测试）。
- **强制停靠点**：所有门禁与独立复核通过后，**立即停止并向用户汇报完整改动清单、测试结果与复核结论**，等待用户明确授权后再决定是否提交、推送、合入 `main`、构建 `v0.1.0` 候选包或关闭 `#106`。

### 6.2 精确 `v0.1.0` 候选包的 Windows 实机人工验收项（自动化单测不可替代）

按 [RELEASING.md](RELEASING.md#L40-L62) 与 `#106` 验收标准，在正式发布 `v0.1.0` 前须使用精确签名的候安装包在 Windows x64 实机核验：
1. 全新安装、同版 `0.1.0` 重装、从 `0.1.0-beta.11` 覆盖升级及既有对话/设置/附件/背景/绘图保留，并检查安装目录内 `THIRD-PARTY-NOTICES.txt` 已随包到位；
2. 桌面/文档/图片（含 OneDrive 同步目录或可见重解析点目录）的 `.ayase` 备份导出/导入（含 >48 MiB 样本验证 `96 / 160 / 256 MiB` 新上限）、绘图导出与自定义绘图输出目录（实机验证 `C1`）；
3. 托盘驻留/恢复/设置跳转/退出确认、单实例唤起、原生文件对话框、真实退出重启及 `#126` 微软雅黑 5 档字号实机观感；
4. 正式发布后，另行用旧版带更新器的安装实测真实应用内检查更新、下载与取消、确认安装重启及最终版本号（`0.1.0-beta.11 → 0.1.0` 通道切换至 `Stable`）。

---

## 7. 施工实施与门禁验证记录（2026-11-27）

### 7.1 已完成施工范围

- **WP1（Go/No-Go 代码阻断 `B1`–`B4` + `C1`）**：全部落地并补齐回归单测：
  - `B1`：[src/backup/repository.ts](../src/backup/repository.ts)、[src/backup/errors.ts](../src/backup/errors.ts)、[src/backup/restore.test.ts](../src/backup/restore.test.ts)
  - `B2`：[src/chat/runtime.ts](../src/chat/runtime.ts)、[src/chat/transport.ts](../src/chat/transport.ts)、[src/chat/modelCatalog.ts](../src/chat/modelCatalog.ts)、[src/chat/transport.test.ts](../src/chat/transport.test.ts)、[src/chat/modelCatalog.test.ts](../src/chat/modelCatalog.test.ts)、[src/chat/runtime.test.ts](../src/chat/runtime.test.ts)
  - `B3`：[src/search/context.ts](../src/search/context.ts)、[src/chat/useChatSession.ts](../src/chat/useChatSession.ts)、[src/search/context.test.ts](../src/search/context.test.ts)
  - `B4`：[src-tauri/src/lib.rs](../src-tauri/src/lib.rs)、[src-tauri/src/tray.rs](../src-tauri/src/tray.rs) 及 6 个主窗口业务模块全部 35 个自定义命令
  - `C1`：[src-tauri/src/file_safety.rs](../src-tauri/src/file_safety.rs)（零新增外部 crate，Windows `kernel32` FFI 按 `FileAttributeTagInfo` 精确区分链接重解析点与 WOF/Cloud Files 非链接系统重解析点，并保留非重解析文件 `FILE_FLAG_OPEN_REPARSE_POINT` 防 TOCTOU）
- **WP2（已确认 P2 修复 `M1`–`M7` + 可选加固）**：全部落地并补齐回归单测（`useConversationWorkspace`、`App` 更新安装门闩、`cherry_sqlite`、`sse`、`messageEdits`/`useChatSession`、`background`/`cherry_leveldb`/`drawing`/`drawing_output`/`attachments`/`ayase_backup` 并发围栏与统一 `file_safety`、`ProviderAvatar`、`chat/repository`、`updater`/`update/controller`、`SearchResults`、`AvatarSettings`）。
- **WP3（`96 / 160 / 256 MiB` 便携备份扩容 & `M8a`）**：升级上限并收窄 [BackupWorkspace.tsx](../src/ui/settings/BackupWorkspace.tsx) 导出/恢复结果态为轻量摘要 `BackupSummary`。
- **WP4（冗余代码、CI 卫生与 Clippy 零告警）**：删除死组件 `src/ui/settings/AssistantAvatarDefaults.tsx` 与零引用导出，消除两处重复校验（`src-tauri/src/drawing_formats.rs` 的 22 项既有属性名经 Codex 独立复核评估后予以保留，确保历史已存静态 SVG 成果重验不回归，`<filter>`/`<pattern>` 元素继续拒绝），精简 CI 重复测试与 `loadArtifacts` 死参，修剪折叠/展开 `Set` 残留 ID，归零全部 Rust Clippy 告警。
- **WP5（`0.1.0` 发布准备）**：新增 [THIRD-PARTY-NOTICES.txt](../THIRD-PARTY-NOTICES.txt) 并注册至 [src-tauri/tauri.conf.json](../src-tauri/tauri.conf.json) `bundle.resources`；5 处版本源对齐 `0.1.0`；刷新 [THIRD-PARTY-DEPENDENCIES.md](THIRD-PARTY-DEPENDENCIES.md) 锁文件摘要（272 npm / 608 Rust 依赖数零变化）；[scripts/test-installer-policy.ps1](../scripts/test-installer-policy.ps1) 补齐 3 条 `0.1.0` Stable 策略用例；同步更新 README、PRODUCT 及现行合同文档。

### 7.2 自动化门禁实测结果

| 检查项 | 命令 | 结果 |
| --- | --- | --- |
| 发布脚本测试 | `npm.cmd run check:release` | 30 / 30 通过 |
| 数据契约门禁 | `npm.cmd run check:data-contracts` | 16 / 16 通过（14 表 / 9 偏好键 / 9 备份表） |
| 前端单元测试 | `npm.cmd run test` | 188 文件 / 3,402 测试通过 |
| TypeScript & 生产构建 | `npm.cmd run build` + `tsc --noEmit --noUnusedLocals --noUnusedParameters` | 通过（0 错误，0 未使用局部/参数） |
| Rust 核心测试与检查 | `cargo test --locked` / `cargo check --locked` | 208 passed, 0 failed, 1 ignored |
| 原生签名助手测试 | `cargo test --locked --features release-tools --bin verify-updater-signature` | 1 / 1 通过 |
| Rust Clippy 静态检查 | `cargo clippy --locked --all-targets -- -D warnings` | 通过（0 告警） |
| NSIS 安装器策略矩阵 | `pwsh -NoProfile -File scripts/test-installer-policy.ps1` | 12 / 12 通过（含新增 3 条 `0.1.0` Stable 用例） |
| 空白与文档本地链接 | `git diff --check` + 改动文档本地链接扫描 | 通过（0 空白异常，0 断链） |

### 7.3 独立只读复核记录

- **Codex 独立只读复核（`codex-review` MCP，基线 `dev` @ `875082e`）**：共完成三轮只读复核与定向回验，全部确认问题均已逐项核实并修复：
  1. `B1` 恢复日志严格校验：补齐 `references` 规范受管路径与 ≤2,000 项上限、数组稠密性检查（防稀疏数组空槽跳过 `.every()`）、表行与绘图预设唯一非空 `id` 校验及单例 `drawing.draft.id === "current"` 校验，并强化不同活态/快照数据回归测试；
  2. `THIRD-PARTY-NOTICES.txt` & `THIRD-PARTY-LICENSES.md`：补全 Dexie 上游 `NOTICE`、highlight.js 完整 BSD-3-Clause、Lucide ISC + Feather 完整 MIT、完整 Apache-2.0 与 `webpki-roots` CDLA-Permissive-2.0 全文，逐字补全 `ring`（OpenSSL Project Authors / Intel Apache-2.0 与 Google / Intel / Brian Smith ISC）与 `minisign-verify`（MIT + 原样保留 `src/crypto` rust-crypto 声明）及 `leveldb-core` / `snap` 归属；
  3. `background.rs`：缩略图校验/写入与启动清理统一接入 `file_safety::inspect` 拒绝受管目录联接，同时恢复用户显式选择外部背景源的常规有界读取（不擅自收紧用户选择源）；
  4. `drawing.rs` / `file_safety.rs` / `attachments.rs` / `sse.ts` / `drawing_formats.rs` / `tray.rs` / `context.test.ts` / 文档口径：补齐有收据快路径与无收据旧参考图全像素解码回退、`OpenOptionsExt` 支持 Windows >`MAX_PATH` 路径及长路径联接探测单测、附件读入原生 `expected_size` 有界校验、SSE 单遍分块扫描消除 O(N²) 回扫、保留历史静态 SVG 22 项既有属性名兼容性、放行托盘默认端口收紧、Responses 真实可持久化签名回放夹具以及旧版三上限兼容与 `DEVELOPMENT.md` `0.1.0` 版本口径同步。
- 全部代码与文档项均已获 Codex 独立确认无阻塞，并在末轮修改后重跑 `git diff --check` 确认工作区干净。
