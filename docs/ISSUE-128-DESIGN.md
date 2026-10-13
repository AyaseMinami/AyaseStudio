# #128 历史消息附件编辑设计案

日期：2026-10-13。状态：设计案与独立复核完成，随后按用户授权本地实施；实现、代码复核和验证状态见 [实施记录](ISSUE-128-IMPLEMENTATION.md)。第10节仍仅是设计审查证据，不代表代码或原生互动验收。未提交、推送、更新远端 Issue、构建安装包或操作用户数据。

需求：[Issue #128](https://github.com/AyaseMinami/AyaseStudio/issues/128)。依据：[Cherry 1.9.13 源码研究](ISSUE-128-CHERRY-RESEARCH.md)、[UI 规范](UI-DESIGN.md)、[架构合同](ARCHITECTURE.md)、[数据合同](DATA-CONTRACTS.md)。代码参考为本地 dev HEAD `3eb26be1339bdbeceb67e71beca1e79f0c3650b1` 加当前既有未提交改动，尤其 #124 图片预览；实施时重新核对，不覆盖已有成果。

## 1. 目标与设计决定

在现有消息原位编辑器内管理附件，让正文与最终附件列表一起保存，取消后原消息不变。底部输入草稿、其它消息和其它对话中的生成保持独立。

| 项目 | 本案决定 |
| --- | --- |
| 编辑对象 | 仅 user 消息新增、移除附件。assistant 保持现有正文编辑与附件展示/预览，不新增附件增删入口。不新增 system/tool 消息编辑入口 |
| 动作 | user：取消、保存、保存并发送；assistant：取消、保存。沿用现有快捷键，不增加确认弹窗 |
| 类型 | 文件选择/拖入复用 attachmentAccept 和校验；粘贴图片复用当前 Composer 能力，普通文本仍进入正文。不加入 Cherry 的长文本自动转附件 |
| 模型能力 | 仅保存不需要模型、连接或凭据。保存并发送沿用当前协议能力验证，不根据模型名称猜能力，不自动转换 Office、换模型或重试 |
| 排序 | 原附件顺序保持；新附件按接收操作和操作内文件顺序追加。允许同名不同文件；没有附件重排功能 |
| 移除反馈 | 原附件留在原位置，弱化显示“待移除”并提供“撤销移除”；新增附件移除后从列表消失。保存过滤待移除项 |
| 取消 | 编辑及附件头部读取阶段可取消；点击保存后进入不可取消提交阶段，按钮和 Escape 一致禁用取消 |
| 导航 | 普通编辑阶段离开对话会丢弃该编辑草稿；提交已经受理后允许导航，后台操作仍归原对话，不因编辑器卸载撤销已受理保存或重发 |
| 本地格式 | 复用 StoredChatMessage.attachments 和 SentAttachment；编辑身份、File、移除标记、提交状态仅在内存中 |

用户在 2026-10-13 设计审查期间明确选择“仅用户消息增删附件，助手回复保持现有编辑能力”。本案据此收窄角色范围，远端 Issue 未修改。其它条目是本案的设计选择，不代表用户已完成界面体验或功能验收；不复用 Cherry 不一致的角色门禁。

不包含附件转换、模型能力推测、附件重排、通用工具、完整消息树、新备份格式、自动重发，以及 #126 字体整理或其它未完成 Issue。

## 2. 界面与输入

沿用 MessageList 的消息位置、编辑正文框和操作栏。user 正文下显示附件区及“添加附件”入口，图片使用缩略图/预览入口，文件使用类型图标、完整文件名提示和现有元数据展示。assistant 沿用原正文编辑与原附件展示，不显示新增/移除入口。待移除项状态不能只靠颜色表达。可换行，长文件名不撑开消息；窄窗口操作栏可换行，所有入口可滚动访问，不增加固定高度大弹窗。

原附件预览复用 SentAttachmentPreview；新增图片预览通过 materializeDraftAttachment 临时读取 File，复用 #124 缩放/拖动。预览失败只提示该项错误，不把它从草稿静默移除；关闭后以 preventScroll 返回编辑器入口。待移除原附件在提交前仍可预览。

user 编辑器的文件 dragover/drop 必须 preventDefault 并 stopPropagation，投放只进入该编辑器，不再冒泡到 ChatWorkspace 的底部草稿接收器。编辑器外投放仍进入底部草稿。user 编辑器显示局部投放提示；提交中编辑器区域拒绝文件投放并消费事件，不能转投底部草稿。assistant 编辑区文件投放也须消费并提示“仅用户消息支持附件编辑”，不能悄悄加入其附件或底部草稿。

粘贴遵循文本框焦点，user 图片事件只由当前编辑器消费；不增加全局剪贴板监听。assistant 不注册新增附件处理，遇到文件粘贴时拒绝并提示，保持普通文本粘贴。复用现有图片命名逻辑，避免同秒重名。文件选择器取消不改变任何草稿；读取失败按文件显示可理解的错误，成功项按原操作顺序追加，不因异步完成次序重排。

每次新增操作分配操作序号；可并行读头，但按调用顺序收集结果，后完成的早期操作不能插到后期操作之后。只要存在未完成新增读取，保存/保存并发送禁用。取消、切换编辑消息、对话变化或编辑器卸载都会失效该编辑会话 token；迟到读取/文件选择结果不得再修改草稿。

Enter 仅保存、Shift+Enter 换行、Escape 取消；user 的 Ctrl+Enter 保存并发送。沿用 IME/composition、repeat、修饰键处理。提交期间正文、附件操作、选择器和提交按钮禁用，Escape 不绕过提交状态。原已保存附件无法读取时允许移除或取消；只保存并保留旧引用无需完整读取原文件，也不隐式修复缺失文件。

无正文且最终附件列表为空时拒绝保存并定位提示，包括移除附件-only 消息最后一个附件的情况；可改为删除消息，沿用独立删除流程，不自动删除。

## 3. 状态与职责

建议新增局部 MessageEditor 组件，从 MessageList 提取现有编辑区；共享附件输入小工具仅抽取图片粘贴命名/文件接收等真实重复逻辑，不抽取通用全功能 Composer。

编辑器拥有 EditSession：conversationId、messageId、会话 token、正文、按顺序排列的附件项、待完成读取和局部错误。附件项是 retained（旧 SentAttachment，可标记移除）或 added（DraftAttachment/File）。提交冻结过滤后的附件列表，不把 File 交给 Dexie 或序列化。

useChatSession 中的消息编辑协调器拥有冻结提交、原生附件操作、目标对话占用和结果。编辑组件只能调用协调器，不能调用 Dexie。协调器内部维护短生命周期 per-conversation operation token；这是编辑提交所有者，不能伪装成正在生成的 GenerationTask。

| 层 | 责任与拟修改位置 |
| --- | --- |
| UI | MessageList / 新 MessageEditor、Composer 共享输入辅助、ChatWorkspace 投放边界；展示草稿和结果 |
| 会话协调 | useChatSession / 可提取 messageEdit.ts：冻结目标、附件准备、回滚、结果及编辑发送的接入 |
| 命令与仓库 | workspace.ts、useConversationWorkspace.ts、repository.ts：同一队列内执行编辑事务、刷新 SessionStore、区分持久成功与重载失败 |
| 资源生命周期 | AttachmentLifecycle / AttachmentStore：新文件 reservation、verify、commit、discard、回滚所需旧引用的 operation lease、全局 cleanup；lease 的运行时共享计数不是持久文件拥有者计数 |
| 发送与候选 | useChatSession、roundVersions.ts：从提交前原始问答建立新候选，使用最终有序附件准备请求 |
| 数据/备份 | 现有 strict reader、dataRegistry/dataPolicies、真实备份投影及恢复测试：保持结构与引用完整 |

MessageActions 的 edit/editAndSend 改为接受运行时编辑输入（正文和有序 retained/added 项），并返回明确结果。assistant 仅提交正文；仓库也校验角色，assistant 附件修改请求在持久写入前拒绝，不能只靠 UI 隐藏入口。仓库命令只接收准备好的 SentAttachment[]；附件参数缺失表示沿用旧列表，显式 [] 表示清空，保持现有纯正文调用的兼容性。空附件列表持久化统一省略 attachments，不留下编辑状态。

结果至少区分 notSaved、saved、savedNeedsReload、recoveryRequired。仅保存与发送失败的阶段另带明确错误/警告；不能用一个 false 同时表示“未保存”和“已保存但后续失败”。UI 对 saved/savedNeedsReload 退出编辑，不重复提交同一批 File；notSaved 保留草稿允许重试；recoveryRequired 保留错误及占用，要求重新加载/恢复，禁止盲目重试。

## 4. 对话占用、队列与生命周期

仅打开编辑器不长期占用对话；开始提交时同步取得目标对话 operation token，并检查该对话没有 generation/import/其它编辑提交。此检查必须与 begin 处于同一同步步骤，不能只依赖 disabled 的界面状态。

普通发送/重发的 GenerationTasks.begin 前必须再次检查目标编辑占用。编辑发送在取得 generation token 后再释放编辑占用，转移在同一同步步骤完成，无两者都释放的空档；其专属内部发送入口可持有自己的编辑 token，不能被自己的占用检查拒绝。不得提前冒充生成态来调用现有 workspace.execute，因为该命令当前会拒绝受影响的生成对话。

目标对话的删除、清空、分支、版本切换、另一条消息编辑和助手批量删除的受影响列表，全部纳入编辑占用检查。其它对话生成不暂停/中止；共享 workspace 的短数据库队列仍串行，文件读取、文件持久保存、校验和供应商网络等待不得占着全局 workspace busy。

提交前 flush 目标 SessionStore，取得仓库当前规范化原始 transcript 及目标消息作为 before 快照。编辑器的 base 消息若已被改动/删除，不覆盖新内容，返回明确“消息已变化，请重新打开编辑”的 notSaved；不自动合并。快照与比对均为运行时，不新增持久 revision 字段。

仓库事务必须重新校验目标存在、基础内容一致和维护状态。只允许 kept 旧附件来自该目标 before 消息，新 reference 来自本次受管 save 结果；UI 不得注入任意路径、其它消息引用或伪造元数据。格式及 reference 使用现有严格读入口和原生路径校验。

备份/导入/恢复、关闭前 settle、安装更新准备都必须把 pending 编辑提交计入 canPrepare/isSettled/等待集合；取得维护围栏后拒绝新编辑提交。维护不能在新文件与消息引用提交之间清理/替换资源。真正退出/卸载停止接受新操作，等待已受理提交结束或进入明确恢复错误；原生故障/进程终止无法靠等待保证，见失败与重启边界。通常页面卸载/导航不 dispose 协调器。

### 回滚资源租约

对话占用不能阻止其它对话的 cleanup。现有 AttachmentLifecycle.reserved 只保护新 save 的副本；native cleanup 对无主 staging 可立即删除，active/quarantine 的宽限也不能作为回滚保证，且 pending 参数只保护 staging。因此新增运行时 reference lease：在任何 transcript 替换前，按与 repository.attachmentReferences 相同的 retainedRoundMessages 规则，从完整 before transcript（含将截断的后续历史及非活动候选）收集全部可回滚文件引用并取得租约。

租约的 acquire/release 与 cleanup 使用 AttachmentLifecycle 同一串行队列；acquire 完成前不允许 DB 替换。同一文件可由不同对话操作同时租用，按租约身份/共享计数管理，幂等释放自己的租约，不能因一个操作完成清除另一个的保护。cleanup 在读取 DB 前后取租约保护集合，与真实 DB retained 合并后传给 native retained；新文件 reservation 继续作为 pending。不能只将旧引用放入 native pending。

成功提交与第二次文件校验均已确认，或回滚到 before 已确认后，才能释放旧引用租约，再执行普通 cleanup。结果未知、回滚失败时保留旧租约和 ownedNew reservation；其它对话 cleanup 仍必须保护它们。savedNeedsReload 已确认 durable 成功与文件有效，可以释放资源租约，但目标进入独立 needsReload 状态（不是仍在 pending 的提交 token），丢弃旧可写 Store、允许 retry/loadView 专用重载，成功后解除目标编辑/发送禁用。维护/备份先重载或报告未完成，不能把 needsReload 混成永远无法 initialize 的 pending。

此租约仅在运行时存在，不进入 DB/备份，不新增原生参数或权限；它是资源生命周期接口的实质扩展，须独立审查与覆盖并发清理/共享租约测试。

## 5. 仅保存提交流程

1. 冻结编辑输入并取得目标对话占用。flush/read before，检查最终消息非空、role、引用归属及编辑基础一致，取得完整 before 引用的回滚租约。无需读取连接 Key 或调用 provider。
2. 顺序 materialize 新增 File，逐个 AttachmentLifecycle.save；记录每个成功的新副本（ownedNew）。保留的旧引用保持原身份；按冻结顺序形成 finalAttachments。文件不修改用户源文件。
3. 对 ownedNew 作原生 verify。数据库提交前失败时原消息不变，仅 discard ownedNew；discard 失败保持 reservation 并提示资源整理待重试。不得 discard 保留的旧文件。
4. 通过 workspace 的同一命令队列/仓库事务一次更新目标消息正文、最终附件、editedAt 和既有正文编辑会失效的 search/providerReplay/continuation 等字段；沿用 paused→incomplete 规则。其它消息、候选和助手/对话配置保持；conversation.updatedAt 正常更新。
5. DB 确认成功后调用 AttachmentLifecycle.commit(ownedNew)（含第二次 verify），再让该对话 SessionStore 从仓库重新加载。释放 reservation 前必须存在已确认的持久拥有者。数据库已提交是事实，界面重载失败返回 savedNeedsReload，不丢弃 ownedNew 或恢复旧可写 Store；禁用旧 Store 写回直到重载完成。
6. 确认 durable 提交和新文件有效后释放旧引用租约，使用全局真实引用 cleanup 回收移除项，包含所有对话/分支和非活动候选。正常成功释放对话占用；重载失败按 needsReload 接管状态。cleanup 失败只显示“已保存，附件整理待重试”，不伪装保存失败，不撤回消息，不阻止其它对话使用。

仅保存最新一轮只修改当前可见版本，不新建候选；离开当前候选前按现有 roundVersions 槽位刷新规则同步正文和附件。非活动候选不改动。引用扫描不能读取过期的当前候选槽位把已移除文件永久保留，也不能遗漏非活动候选。

## 6. 保存并发送

不能先调用“仅保存”再调用现有重发：这会把编辑后的内容当成上一候选，丢失编辑前的当前问答快照。

同一个协调器先冻结 before transcript、编辑正文/有序附件、目标连接/模型和生成配置，取得完整 before 引用的回滚租约，并复用现有请求准备流程。协议能力、最终历史请求体、上下文预算、实际会被发送的原附件读取都在耐久消息替换前核对；失败返回 notSaved，保留完整编辑草稿，清理仅本次尚无持久引用的新副本后释放旧租约。移除的文件不能再出现在请求中，非活动候选不发送。assistant 历史投影与适配器不因本案增加附件发送能力。

准备好新增文件与 finalAttachments 后，按原始 before transcript 构建 finalUser：最新一轮 appendRoundVersion(before, finalUser, newAssistant)，保留编辑前那组问答；旧轮沿用截断后续历史规则，保留前文与替换后的目标用户消息及新回复占位。暂停继续生成/普通 regenerate 不并入附件编辑。

随后取得 generation token 并原子交接编辑占用，将 final transcript 持久化；旧 SessionStore flush 完成，失败回滚在 generation 仍持有占用和 before 资源租约时处理。成功校验/commit ownedNew 后释放旧租约，才允许任何 provider 请求（包括外部搜索）。沿用现有发送事件、停止、统计与生成终态保存，不新增自动命名请求或自动 fallback/retry。

只要 final transcript 与附件已经提交，编辑就已完成：关闭编辑器，底部原草稿不清空；provider 拒绝、网络失败、取消或结果未知按原发送行为留下这轮已保存问答及错误状态，不回滚旧正文/附件，不重发。导航后结果归原对话。普通“停止生成”只停止本次请求，不恢复编辑前版本；用户可显式切换候选（仅最新一轮）。

## 7. 失败、回滚与重启

DB 与文件系统没有整体事务，本案保证阶段可辨认和引用保护，不能声明跨两者原子耐久。

| 失败阶段 | 必须的结果 |
| --- | --- |
| 选取/头部读取/预览 | 局部错误；原消息不变，可取消，迟到结果由 token 丢弃 |
| 部分新增文件保存失败 | 保留编辑草稿；逐项已完成副本可追踪且仅清理 ownedNew；保留旧引用与其它引用 |
| DB 事务明确回滚 | 原 transcript 不变；discard ownedNew；恢复占用和操作按钮，无 provider 请求 |
| 写入结果无法确定 | 在持有目标占用下从仓库重新读取；精确确认 before 或 expectedAfter。before 才允许 discard；expectedAfter 按成功处理；读取失败/其它状态进入 recoveryRequired，保留 reservation，不清理可能有拥有者的文件 |
| DB 后 commit/verify 失败 | 在占用和旧文件未清理条件下条件回滚 transcript 到 before；回滚成功确认后才 discard ownedNew。失败/结果不明保留 reservation/引用并进入 recoveryRequired，禁止发送，不发布旧可写 Store |
| 仅重载失败 | savedNeedsReload；保存事实不变，保留新文件，重新加载后才开放目标编辑/发送 |
| 引用 cleanup 失败 | 保存成功加警告；延后按真实引用重试，不能逐一强删移除项 |
| provider 已开始后失败 | 已提交消息保留，沿用失败/停止状态；不自动回滚或重试 |

回滚恢复 before 的 messages（包括候选），不覆盖 conversation 的标题、排序和配置等并行元数据。条件回滚只在当前 transcript 与本操作 expectedAfter 相符时允许；其它状态拒绝覆盖。新旧文件判定只依赖持久引用和操作归属，不根据 UI 是否关闭推断文件应删除。

恢复错误不能永远占住不可见内存锁：协调器必须按原 conversationId 保存 outcome，并提供“重新加载并核对”入口；导航后的错误也能通过原对话入口辨认，不能错误地显示为当前其它对话保存失败。维护准备报告具体阻塞。确认 before/after 后按表恢复、释放对应租约与占用；needsReload 走独立可重载状态，不调用被 pending.current 阻止的普通 initialize。无法确认时允许用户正常退出：正常退出只等待当前提交/核对 settle，不将“曾发生 recoveryRequired”永久当作无法退出的 pending。维护替换仍需先核对，不能带着未知操作运行。

重启由既有 startup 附件围栏/cleanup 基于持久引用保护并回收无引用副本；运行时旧租约失效，不再自动尝试 before 回滚。不新增持久编辑日志，不能保证进程崩溃后恢复未提交 File 草稿。若确认 DB 保留了不可读的新引用，显示现有附件不可读错误，允许用户在重新加载后显式移除/替换，不能静默回滚或假装发送成功。

## 8. 数据与兼容合同

预定无新表/索引/持久字段/偏好键/原生权限/资源类别。Dexie schema v9、chat 模块 v3、备份文档 v5、信封 v1 保持现值；无新语义迁移、minimumReader 或必需能力。实施前从最新代码核对版本，不因本案硬编码冻结其它任务的版本。

缺失 attachments 继续代表没有附件；保存后的空列表采用缺失形式，旧记录不批量改写。保留附件的 reference、原文件名、MIME、size 不改造；新增附件仍是受管不可变副本，不存用户源路径，不存 File/base64 编辑草稿。既有未知/非法记录必须由本地/备份共享严格读入口拒绝并保留原文；本案不利用“编辑已知字段”擦掉未知结构。

dataRegistry、dataPolicies 及实际备份投影继续登记 messages.attachments、SentAttachment.reference/元数据和 roundVersions；运行时草稿/移除标记/token/占用不上注册表、不进入备份。维护排他完成后，导出捕获最终保存消息；合并/副本/替换恢复与私有回滚沿用现有资源映射，涵盖编辑后共享附件和候选。不新增 credential，不改变备份密钥选择，也不从真实配置取 Key 做确定性验收。

实施时在 DATA-CONTRACTS.md 写明以上“复用现有结构”的决定并核对穷尽字段策略与真实投影。若最终出现新持久字段或结构，必须重新设计模块版本、最低读者、默认值、迁移、拒绝边界及测试，不能用本案的“无新格式”豁免。

## 9. 实施顺序与验收

按职责逐步实施，完成后走全量门禁和独立审查。以下是原设计的实施顺序；实际执行及验收证据另见实施记录。

1. 先建立协调器、结果类型、对话占用/维护接入、仅保存命令及资源失败路径，测试真实仓库重开与引用保护。
2. 接入保存并发送的统一准备、候选 before 快照、请求前回滚和 provider 后失败边界；使用模拟 transport。
3. 实现原位附件编辑区、待移除/撤销、选择/投放/粘贴、顺序、迟到结果与预览；保留底部草稿和 #124 行为。
4. 更新架构/开发/UI/数据合同；执行下表覆盖和独立 Sol/high 审查，完成隔离浏览器及相关 native startup，原生互动另列用户接受。

| 验收组 | 关键覆盖与证据 |
| --- | --- |
| 编辑/UI | user 的增加、保留、多个移除和撤销；assistant 无附件增删入口且绕过 UI 的修改也拒绝、原正文编辑/展示保持；重复文件名/多文件顺序；空正文但有附件；移除最后附件；保存失败保留完整草稿；取消恢复原消息 |
| 输入隔离 | 取消选择器；头部读取迟到；切换消息/对话；新旧图片预览；混合成功/失败；编辑投放不进入 Composer，编辑外投放仍进入 Composer，输入区已有草稿完整不变 |
| 原生/资源 | 第 N 个 save 失败、前后 verify 失败、discard 失败；共享消息/分支/候选引用；DB后/commit前插入其它对话 cleanup；旧件仍在 staging、active、quarantine 都能回滚；共享旧 lease 的幂等释放；回滚失败持续保护新旧资源；不可读旧附件可移除 |
| 队列/维护 | 双击提交；同对话 send/edit/delete/版本切换竞争；另对话持续流式生成；自动命名元数据不被回滚覆盖；备份/关闭/更新与编辑提交争用；提交中导航后只更新原对话 |
| 仅保存 | 无模型/无 Key 完成；零 provider 调用；目标正文/附件同事务，其他消息不变；重载失败不重复保存/写旧 Store；新仓库实例重开一致 |
| 发送 | 最新候选保留编辑前正文/附件，当前候选用新列表；非活动引用与请求分离；旧轮截断；协议不支持/附件读取/预算失败零请求且原历史不变；发送失败/停止保留已提交消息 |
| 数据/备份 | 旧/当前缺失附件、非法未知结构零写入并保留；编辑后导出、三种恢复、重映射、再次导出和私有回滚；纯正文旧调用保持；无新版本与登记核对 |
| 视觉/键盘 | 浅色宽屏、深色 440×620 和支持的窄窗口；长名、多附件、待移除、错误状态；Tab/Shift+Tab、IME、Escape、Enter/Ctrl+Enter；#124 预览焦点返回与阅读位置 |

默认代码门禁：npm.cmd run check（含 check:data-contracts）、cargo check --manifest-path src-tauri/Cargo.toml、git diff --check、git status --short --branch；改动原生附件代码时补 targeted cargo tests。因本案接入本地文件生命周期，运行相关 native 检查及 npm.cmd run tauri dev 隔离启动烟雾；仅编译/启动不能代替原生选择器、真正关闭重启或安装版互动验收。浏览器使用内置浏览器、合成文件与 mocked native/provider，不能读真实 Key 或发模型请求。原生人工接受与真实线路需单独记录，不作为本设计审查通过事实。

设计审查验收只检查完整性、可执行性、需求一致性和现有模块适配；不等于功能实现、测试通过、设备接受、Git 交付或 Issue 关闭。

## 10. 独立审查记录

2026-10-13 使用 code-review 流程，分配独立 comprehensive_reviewer（Sol/high，独立上下文、只读）审查完整未跟踪设计案及相关源代码/合同和 Issue #128；没有委托实现或远端操作。

首轮对象 SHA256：`5BA8530A67AF66201A64A6BED44AA812AC4D358EB3C1B8949691A8A9774A6BD5`。发现一项 P1：DB 已更新、commit/verify 尚未完成时，另一对话 cleanup 可删除仍在 staging 的旧移除附件，导致 before 回滚恢复不可读引用。主代理核对 AttachmentLifecycle 的 reserved 与 native cleanup 的 retained/pending 分工后确认发现，修订为本案 §4 的完整 before 资源租约及对应验收；同步补清 savedNeedsReload 专用重载与恢复出口。按用户确认收窄为仅 user 增删附件。

同一独立审查者复核修订版 SHA256 `114BE603263483BCD990AFD0A00FB8F5548B63AB7A20B0D9094D7F58453D938B`，确认首轮 P1 闭环：DB 替换前取得共享租约，与 cleanup 串行且以 native retained 保护，直至成功或回滚已确认；未知状态保留新旧资源。完整复核后未发现剩余可确认 P0–P2 设计缺陷，角色、重载、结果归属与退出规则无已发现冲突。

以上哈希标识审查时的完整文件；复核后仅本节追记审查结果和页首设计状态，未修改复核过的正文合同。主代理完成四份相关文档的相对链接、空白、Git diff 和状态检查，既有工作区功能改动保持。设计案复核通过不证明未实施的代码正确；本次未运行应用测试、构建、浏览器或原生验收。
