# #128 历史消息附件编辑实施与验证

日期：2026-10-13。范围：当前 `dev`（起点 HEAD `3eb26be1339bdbeceb67e71beca1e79f0c3650b1`）授权本地代码、合同、确定性验证、内置浏览器和隔离原生启动。既有 #124／#125／#127／头像修改保留；无 commit、push、PR、远端 Issue 修改、发布、安装或真实服务请求。代码复核与门禁完成；原生互动／真正退出重启仍待人工接受，不能据此关闭 Issue。

依据：[设计案](ISSUE-128-DESIGN.md)（设计复核证据在第10节）、[Cherry 固定版本研究](ISSUE-128-CHERRY-RESEARCH.md)。没有复制 Cherry 源码、文案、图标或资产。用户选择仅用户消息增删附件，助手保持原正文编辑和附件展示／预览；本地范围说明优先于远端旧描述，远端未修改。

后续同日用户另行授权将全部工作区变更打成新 EXE：已生成 `0.1.0-beta.6` 本地手动验收安装包，打包／版本／哈希及门禁见 [开发记录](DEVELOPMENT.md#local-beta-6-installer-for-user-acceptance-2026-10-13)。下文仍是此前实现阶段的证据，不因此补作安装、真实退出重启或 Issue 关闭接受。

## 实际实现

| 边界 | 实现与行为 |
| --- | --- |
| 原位编辑 | `MessageEditor.tsx` 的冻结 base、正文、有序 retained/added 列表独立于 Composer。原附件待移除／撤销、新附件删除、文件选择／投放／图片粘贴、读取顺序、会话失效与局部错误；待读取禁用保存，提交禁用取消及 Escape，IME／快捷键保持。助手无附件增删入口且文件事件拒绝并消费 |
| 接受与归属 | `MessageEdits` 按 conversationId 同步占用；禁止重复提交／同目标生成与破坏操作，导航不取消已受理操作。工作区短队列 flush/read、条件事务、替换 Store；文件／网络不占 workspace busy，其它对话可生成 |
| 资源 | 保存新增 File 后逐项追踪 ownedNew，提交前 verify；完整 before（包括截断历史、非活动候选）的租约先于 DB 替换。lease acquire/release 与 cleanup 串行、按身份共享／幂等释放，旧件合入 native retained，新件 reserved/pending。第二次 verify/commit 或回滚确认后才释放；未知结果保护新旧。discard 失败保持 reservation 并在 cleanup 重试 |
| 保存结果 | notSaved 保留草稿；saved 退出编辑；savedNeedsReload 丢弃旧可写 Store，原对话重试加载而不重复保存；recoveryRequired 保持资源保护并显式核对 before/after，不盲目重试或发请求。结果归原对话，恢复态不是永久 pending。cleanup 失败为已保存加警告 |
| 回滚 | DB 错误重新读取以区分 before／expectedAfter／unknown；DB 后 verify 失败条件替换回 before。完整消息回滚不覆盖标题、排序或配置；未确认回滚不 discard。旧可写 Store 不得复活旧历史 |
| 保存并发送 | 在耐久替换前校验模型／协议／配置／预算／最终有序历史与实际附件读取，最新候选从原 before 问答建立，旧轮截断。生成占用在编辑占用仍持有时接手；提交／校验／Store 已确认后才启动原共享 stream consumer。回调在 durable save 后返回，底部草稿保留；供应商失败／Stop 留下已提交消息，不回滚、自动重发或额外命名 |
| 数据 | 复用 attachments／SentAttachment／roundVersions，不增加持久编辑字段或版本。`messageData` 在编辑和备份共用结构校验；原已排除的 continuation／continuationMessage 补穷尽字段策略。旧无附件、非法未知嵌套结构、重复身份等在编辑替换前拒绝并保留原文；备份投影、映射和 rollback 沿用原体系 |
| 维护与关闭 | 备份／导入／更新准备计入 pending 与需核对结果。组合退出 guard 拒绝新操作、等待已受理编辑（含条件回滚）、停止并排空生成／SessionStore 写入；已 settle 的恢复错误不永久禁止正常退出。通常导航不 dispose 协调器 |

本地格式核对：Dexie v9、chat 模块 v3／最低读者 3、备份文档 v5、信封 v1 不变；无新增迁移、必需能力、表、偏好键、原生权限或资源类型。注册表保留既有归属；正文及最终列表一次 transcript 事务保存，空列表省略 attachments。DB 与文件系统没有整体原子耐久保证。

## 确定性验证

使用 fake-indexeddb、独立数据库、合成受管 UUID／File、模拟原生／transport，未读取 `.env.probe.local` 或实际账户。

| 证据文件 | 覆盖 |
| --- | --- |
| [messageEdits.test.ts](../src/chat/messageEdits.test.ts) | 20 项：多件保存与顺序、原仓库重开、部分 save、前后 verify、DB 失败／丢回执／未知、完整 before 竞争 cleanup、rollback 失败、savedNeedsReload、双击／冻结／过期 base、角色／引用／空消息、不可读旧件移除、discard 延后重试、非法顶层／续传配置／嵌套消息／来源／搜索及重复 ID 零替换，共享 lease 幂等释放 |
| [useChatSession.messageEdit128.test.tsx](../src/chat/useChatSession.messageEdit128.test.tsx) | 8 项：无模型／Key 仅保存零 provider、底部草稿完整保留、混合附件顺序、before 候选、耐久结果早于生成终态、失败／Stop 保留提交、原生 save／verify 等待时导航及同目标阻止／他对话生成、备份协调、关闭中第二 verify 失败仍可回滚、仅保存／发送的重载恢复无重发 |
| [messageEdit128.test.ts](../src/backup/messageEdit128.test.ts) | 5 项：实际编辑后 snapshot／编解码／merge、copy、replace／资源去重和重映射／再次导出／私有失败 rollback；候选及分支共享引用、旧无附件及无 runtime File/token/移除标记投影 |
| [MessageEditor.test.tsx](../src/ui/chat/MessageEditor.test.tsx) 及既有 MessageList/Composer/AttachmentUi | 附件增删／撤销、同名与跨操作顺序、头部读取混合失败与迟到、取消选择器／卸载／切换、输入隔离、预览／回焦、快捷键／IME／提交禁止取消和角色限制。既有消息／工作区／附件／并发／候选测试按新明确结果更新，无降低功能断言 |
| [attachments.rs](../src-tauri/src/attachments.rs) | 15 个 targeted Rust 测试通过；新增实际 staging／active／已满足清理期限 quarantine 的 retained 保护测试，覆盖旧租约合入 retained 可撤销 purge；原 save/read、共享保留、校验与路径安全回归保持 |

最终 `npm.cmd run check`：release 29 项、数据合同 16 项与 AST（14 表、9 偏好、9 备份表）、前端 **183 文件／3,056 项**、TypeScript 与 Vite build 全部通过。最后补既有排除续传字段的穷尽策略后，额外数据合同／定向测试／TypeScript 检查通过。构建仍有既有 500kB chunk size 提示，不是测试失败。日志在忽略目录 `.edit128.local/npm-check.log`、`data-contracts-final.log`、`focused-final.log`。

`cargo test --locked --manifest-path src-tauri/Cargo.toml attachments::tests` 15 项通过；`cargo check --locked --manifest-path src-tauri/Cargo.toml` 通过。`git diff --check` 与最终状态核对完成，工作区仍为 dev，保留全部既有未提交改动。无打包或安装验收。

## 独立代码审查

独立 `comprehensive_reviewer`（Sol/high、独立上下文、只读）检查新协调器、租约／仓库／Store／生成／维护／关闭／备份／UI。与设计第10节的审查分开。

首轮两项 P1 均经主代理核对和故障复现后修复：

1. 续传原数据只验顶层，未知嵌套字段可能在正文编辑时被删除。改为完整嵌套配置、消息／附件、来源／搜索／回放结构校验，并补零替换和原文保留回归。
2. closing 的新操作围栏同时阻止已受理编辑的条件回滚。分开 admission 与 owned commit/rollback 门禁，关闭等待排空期间仍允许持有操作权的回滚；真实 Hook 保持第二 verify、开始 close、拒绝 verify 后验证原消息恢复。

复核发现一项 P2：原 transcript 重复 ID 会使一个编辑替换多条同名身份。编辑严格入口补唯一身份及回复顺序校验、候选角色／回复关系；新增重复原记录零替换回归。复核 10 个定向文件 **143 项通过**，确认以上发现闭环，生产代码无剩余可确认 P0–P2。最后合同／实施记录核对另行完成，不以该审查代替浏览器／原生接受。

## 内置浏览器与原生启动

[scripts/message-edit128](../scripts/message-edit128/README.md) 使用真实 hook／协调器／仓库／UI，仅替换仓库工厂为独立 `MessageEdit128Synthetic`、mocked 文件和 provider；独立 localhost:1528 origin 和同源 CSP。模拟文件字节仅在该 fixture 内存/sessionStorage，连接只有合成凭据，provider 不联网。未操作正在运行的安装版或生产文件。

内置浏览器实际检查：浅色 1280×900、深色 440×620、深色 720×520（当前原生 minWidth/minHeight）。长名／多附件换行、待移除／撤销、Tab 至预览及底部动作，后两尺寸 document.scrollWidth 分别为 440／720，无横向溢出。编辑内容可在消息区滚动到全部按钮，不固定弹窗高度。模拟局部投放两份同名 File 与图片 ClipboardEvent 进入编辑草稿，底部原正文保持；头部／混合失败／取消选择器由自动 UI 测试另证。

旧图及新增图预览打开、放大至 125%、关闭回原入口；模拟文件保存失败后保留完整正文／新旧附件草稿和待移除状态。解除故障仅保存后模拟 provider 调用仍为 0；助手编辑区模拟图片粘贴拒绝、无增删入口；保存并发送遇 mock provider 拒绝仍保留新正文与 2/2 候选，显式上一版恢复编辑前问答，下一版回失败的新版本。取消未提交编辑后重新加载，已保存正文／附件／候选／失败状态仍一致；这是浏览器 IndexedDB 重载，不是真正退出应用。

截图位于忽略目录 `.edit128.local/browser/light-1280.jpg`、`dark-440.jpg`。浏览器 filechooser 自动化尝试中标签失效导致接口不能继续；没有用原生自动化回退。新增输入的 browser evidence 使用明确合成 drop/paste 控件；真实文件选择入口由确定性 UI 测试覆盖，系统文件窗口仍待人工。不得写成全输入方式已经浏览器实操通过。

运行 `npm.cmd run tauri dev -- --no-watch --config scripts/message-edit128/native.config.json` 完成独立 `messageedit128acceptance` 标识的 Rust 编译与 `target/debug/ayase-studio.exe` 启动，进程路径／启动时间核对后已停止本次测试进程，原安装版进程保持。启动期间出现既有 IPC custom protocol 向 postMessage 回退提示；本轮未用原生截图／窗口操作或检查实际 native file IPC，因此不把回退提示当成相关原生交互通过或失败。

## 尚需人工接受与边界

2026-10-13 打包后样式修订：按用户要求将编辑区收成现有 Composer 输入与附件标签的样式，移除常显缩略图和重复文件信息；图片点击时才读取预览。原附件仍可待移除／撤销，回形针添加和三个保存动作保持既有语义。72 项相关 UI 测试、TypeScript/Vite 构建通过；隔离内置浏览器核对浅色 1280×900、深色 440×900、24px 标签、八件／长名／预览焦点、合成投放粘贴、失败保留和取消恢复，页面及编辑区无横向溢出，底部草稿独立且 provider mock 调用为 0。新截图为 `.edit128.local/browser/compact-light.jpg`／`compact-dark.jpg`。用户随后确认 dev 测试通过并授权打包，修订已纳入本地 Beta 7；全量前端 183 文件／3057 项、发布与数据合同 gate、锁定 Rust check、发布版编译和安装策略 9 项通过，产物及校验值见 [开发记录](DEVELOPMENT.md)。此前 Beta 6 包保持原样，下列原生人工项继续保留。

- 桌面原生选择器、多文件取消／输入、真实磁盘附件／缺件的预览和保存，真实拖入／系统剪贴板，以及桌面主题与窗口体验。
- 提交／回滚／生成期间实际窗口关闭、托盘退出和真正进程关闭后重启；安装版数据保留、升级与资源压力／崩溃窗口。隔离启动及 Rust 临时文件测试不能代替这些互动。
- 真实供应商／中转附件能力与计费未测试，无实际请求，也无自动 fallback/retry。#93／#94 既有接受边界不因此闭环。

不新增持久编辑日志：进程被强制终止后运行时 lease／before／File 草稿不保留，不自动尝试旧快照回滚或重发；启动按真实 durable 引用保护和清理。已保存文件不可读取时显示现有错误，允许用户显式移除／替换。上述限制已在设计和合同保留。
