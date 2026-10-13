# #128 历史消息附件编辑：Cherry Studio 1.9.13 源码对照

调查日期：2026-10-13。本文是研究记录，不是实施方案、运行验收或 Issue 完成声明。仅调查 Cherry Studio 经典聊天的历史消息编辑路径；未启动 Cherry、未发送模型请求、未修改 Ayase 功能、未操作远端。

## 固定版本与使用边界

固定上游仓库 `CherryHQ/cherry-studio`，提交 `da22fb797343fd3760e5dd2d467eda9bf0017632`。调查时通过 [GitHub tag API](https://api.github.com/repos/CherryHQ/cherry-studio/git/ref/tags/v1.9.13) 核实 `v1.9.13` 直接指向该 commit，且该提交的 [package.json 第 1–3 行](https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/package.json#L1-L3) 声明版本 `1.9.13`。它与 [现有导入参考](CHERRY-IMPORT.md) 使用的旧版提交一致，不混用 main 或 2.x 的消息树实现。[先前调查](ISSUE-77-EXTERNAL-RESEARCH.md)记录 2026-09-30 当时安装版实际为 1.9.13，因此本次沿用这一版本；未重新检查当前安装版本。

该提交的 [LICENSE](https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/LICENSE#L1-L2) 是 GNU Affero General Public License 第 3 版。本次只归纳交互和数据行为，并提供出处；未把上游源码、文案、图标或资产复制到 Ayase。这里不作源码复用的许可证审批。

证据分三类：**直接源码行为**指明确的条件和调用；**条件风险**指失败或竞争出现时，由调用顺序推导的结果；**未验证**指没有运行测试、全局审计或故障复现，不能写成已确认的实际用户结果。

## 源码证据表

所有链接固定到上述提交，行号来自官方 raw 文件逐行读取。

| 问题 | 直接源码行为 | 固定来源 |
| --- | --- | --- |
| 编辑入口 | 用户消息有独立编辑按钮；更多菜单在存在主文本块时提供编辑，不限制 user/assistant；点击只设置正在编辑的消息 ID | [MessageMenubar.tsx L227–231](https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/src/renderer/src/pages/home/Messages/MessageMenubar.tsx#L227-L231)、[L296–311](https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/src/renderer/src/pages/home/Messages/MessageMenubar.tsx#L296-L311)、[L726–738](https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/src/renderer/src/pages/home/Messages/MessageMenubar.tsx#L726-L738) |
| 编辑器位置 | 消息项在 `isEditing` 时原位渲染 MessageEditor，隐藏原消息内容。没有弹窗，也不把历史消息搬到底部输入框 | [Message.tsx L209–233](https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/src/renderer/src/pages/home/Messages/Message.tsx#L209-L233) |
| 编辑草稿 | 进入时读取全部原 blocks，建立本组件 editedBlocks 与空 files 列表；文本更新产生替换块，删除旧附件只过滤草稿数组 | [MessageEditor.tsx L44–55](https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/src/renderer/src/pages/home/Messages/MessageEditor.tsx#L44-L55)、[L159–173](https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/src/renderer/src/pages/home/Messages/MessageEditor.tsx#L159-L173) |
| 文件选择 | 用户消息显示附件按钮；复用底部输入的 AttachmentButton，点击打开原生多选文件对话框，结果追加到编辑器 files；超过 20 种扩展名时使用通配选择并事后过滤 | [MessageEditor.tsx L337–346](https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/src/renderer/src/pages/home/Messages/MessageEditor.tsx#L337-L346)、[AttachmentButton.tsx L29–66](https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/src/renderer/src/pages/home/Inputbar/tools/components/AttachmentButton.tsx#L29-L66)、[L157–165](https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/src/renderer/src/pages/home/Inputbar/tools/components/AttachmentButton.tsx#L157-L165) |
| 拖入与粘贴 | 编辑容器处理 drop 并按扩展名接收；粘贴使用独立 messageEditor handler，文本框聚焦时记录目标；这两条路径没有 user-role 条件 | [MessageEditor.tsx L132–157](https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/src/renderer/src/pages/home/Messages/MessageEditor.tsx#L132-L157)、[L175–199](https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/src/renderer/src/pages/home/Messages/MessageEditor.tsx#L175-L199)、[L254–289](https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/src/renderer/src/pages/home/Messages/MessageEditor.tsx#L254-L289) |
| 附件列表 | 保留的旧 FILE/IMAGE blocks 与新选择的 files 分开显示，可关闭标签；共用文件图标、文件名与预览组件 | [MessageEditor.tsx L301–331](https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/src/renderer/src/pages/home/Messages/MessageEditor.tsx#L301-L331)、[AttachmentPreview.tsx L88–137](https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/src/renderer/src/pages/home/Inputbar/AttachmentPreview.tsx#L88-L137) |
| 保存准备 | 两个动作都先上传新增 files，再给原消息 ID 新建成功状态的 IMAGE/FILE blocks，附加到 editedBlocks | [MessageEditor.tsx L201–231](https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/src/renderer/src/pages/home/Messages/MessageEditor.tsx#L201-L231) |
| 仅保存与重发 | 仅保存调用 editMessageBlocks，估计 usage 后退出；重发调用 resendUserMessageWithEdit 再退出；取消只停止编辑 | [Message.tsx L93–121](https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/src/renderer/src/pages/home/Messages/Message.tsx#L93-L121) |
| blocks 写入 | 根据 block ID 求新增、更新、删除，再依次 dispatch；重发先执行同样的编辑，找主文本与附件，更新 usage 后启动重新生成 | [useMessageOperations.ts L298–375](https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/src/renderer/src/hooks/useMessageOperations.ts#L298-L375)、[L384–411](https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/src/renderer/src/hooks/useMessageOperations.ts#L384-L411) |
| 上传与引用数 | uploadFile 先调用本机文件存储，之后按 ID 增加已有 count 或新增 files 记录；uploadFiles 为 Promise.all，不吞错误、不返回空数组降级 | [FileManager.ts L59–77](https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/src/renderer/src/services/FileManager.ts#L59-L77) |
| 物理文件 | 本机 uploadFile 按大小和 MD5 查重，已有文件复用 ID，否则复制到受管目录并返回元数据；此处 upload 不是模型供应商上传 | [FileStorage.ts L185–221](https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/src/main/services/FileStorage.ts#L185-L221)、[L293–332](https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/src/main/services/FileStorage.ts#L293-L332) |
| 移除资源 | cleanupMultipleBlocks 从数据库读旧块，异步调用 deleteFile；deleteFile 在 count > 1 时减一，否则先删元数据再删物理文件，物理删除失败只记日志 | [messageThunk.ts L553–575](https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/src/renderer/src/store/thunk/messageThunk.ts#L553-L575)、[FileManager.ts L96–118](https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/src/renderer/src/services/FileManager.ts#L96-L118) |

## 用户操作流程与角色边界

1. 点击某条消息的编辑入口。页面仅有一个 editingMessageId；编辑器挂载时建立局部草稿。底部输入的正文和附件 state 没有传给它。服务复用发生在附件按钮、文件预览、粘贴处理等部件，而不是共享一份输入草稿。
2. 主文本块分别渲染为文本框。其它原 blocks 仍在草稿中，但编辑界面只展示主文本以及 FILE/IMAGE 附件标签。移除旧附件不即时删除资源，新附件移除只改变新 files 列表。
3. 新增附件可走文件选择、拖入、粘贴。文件选择和拖入主要取得源文件元数据；截图类剪贴板图片、超过配置阈值的长文本则先写本机临时文件。短文本遵循默认文本框粘贴。文件类型集合由关联回答的模型能力决定，缺少关联回答时回退到助手模型，见 [MessageEditor.tsx L67–109](https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/src/renderer/src/pages/home/Messages/MessageEditor.tsx#L67-L109)。不能直接当成 Ayase 的支持类型政策。
4. 点击仅保存或重新发送时，都先把新文件放入本机受管存储并增加引用计数，然后构造附件 blocks。仅保存更新历史消息；重新发送先保存编辑，再按 askId 重置关联助手回答并排队生成，不是追加一条新的用户消息，也不是删除全部后续消息。见 [resendMessageThunk L1213–1279](https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/src/renderer/src/store/thunk/messageThunk.ts#L1213-L1279)、[L1296–1317](https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/src/renderer/src/store/thunk/messageThunk.ts#L1296-L1317)。触发编辑重发的外层 thunk 使用 void dispatch，退出编辑不证明生成结束，见 [L1331–1335](https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/src/renderer/src/store/thunk/messageThunk.ts#L1331-L1335)。
5. 正常取消只停止编辑并卸载局部草稿，没有 blocks 写入。选择磁盘文件后立即取消，不经过编辑器的受管上传；不能由此推出所有粘贴临时文件也被及时清理。

用户消息有附件按钮、保存、取消、重发，发送快捷键触发重发，Escape 退出。助手消息可经更多菜单编辑已有主文本与附件，显示保存、取消，但不显示附件按钮和重发按钮。编辑容器的拖入及粘贴注册仍适用于助手编辑器，已有附件删除标签也没有角色限制。因此不能概括为“助手附件完全不能编辑”，也不能把这种入口不对称当成已确认的产品设计。助手消息的 handleKeyDown 提前返回，源码中没有同样的 Escape 行为。

## 引用、提交与失败边界

以下都来自上述固定源码，没有运行故障注入。

| 分类 | 可确认事实或条件风险 | 边界 |
| --- | --- | --- |
| 直接源码行为 | 保留原附件时不重新 upload；删除草稿标签时不递减 count；提交后的旧块清理由 removeBlocksThunk 启动 | 计数变更分别发生在新增资源与旧块回收路径 |
| 直接源码行为 | 删除旧 blocks 的 Dexie topics/message_blocks 事务，不包含物理文件与 files 引用数；cleanupMultipleBlocks 的数据库查块及文件清理通过 void promise 启动，不被 removeBlocksThunk 等待 | [removeBlocksThunk L1841–1892](https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/src/renderer/src/store/thunk/messageThunk.ts#L1841-L1892)；不能报告整体资源原子提交 |
| 直接源码行为 | 更新消息和新增/更新 blocks 的 thunk 先变更 Redux，再依次 await 持久化；其 catch 只记日志。editMessageBlocks 的 catch 也只记日志 | [updateMessageAndBlocksThunk L1805–1838](https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/src/renderer/src/store/thunk/messageThunk.ts#L1805-L1838)；外层 await 正常返回不能证明所有 durable 写入成功 |
| 直接源码行为 | 编辑器把 onSave/onResend 定义为返回 void，并在上传后调用但不 await。父组件内部会 await 业务操作，成功路径 stopEditing；父 catch 只记日志 | 回调完成与编辑器 isProcessing 的恢复没有完整结果协议 |
| 条件风险 | 文件上传、files 表查询/写入或本机复制拒绝时，processEditedBlocks 拒绝；handleSave/Resend 已把 isProcessing 置 true，却没有 catch/finally 或 reset false | 未运行复现。按代码推导，编辑器仍挂载时按钮可能持续 disabled；不能写成已实测卡死 |
| 条件风险 | 多文件 Promise.all 部分成功、其它项失败时，成功项可能已留下受管文件和计数，但没有返回完整附件 blocks；后续 blocks 持久化失败也可能留下先上传的资源 | 所读编辑提交链没有批次补偿或 discard。未审计全局清理，不能宣称永久泄漏 |
| 条件风险 | 按钮取消在处理时 disabled，但 user 的 Escape 分支没有 isProcessing 检查；上传中退出或切换编辑消息后，旧 async closure 仍可调用 onSave/onResend | 没有会话令牌、AbortSignal 或卸载后阻止提交的检查；取消后迟到提交需要实际复现，不能当成已验收失败 |
| 条件风险 | 上传引用数使用 get 后 update，而非同一事务的原子累加；并发共享同一个 file ID 时可能互相覆盖计数。清理依赖 count，没有在该路径重新扫描所有消息引用 | “count > 1 时保留文件”是直接行为；跨话题、分支、并发共享引用的正确性未证实，不能等同于全局引用保护 |
| 直接源码行为 | 长文本和无路径剪贴板图片先 createTempFile/write/get；编辑器取消和标签移除没有临时文件删除调用 | [PasteService.ts L39–114](https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/src/renderer/src/services/PasteService.ts#L39-L114)、[FileStorage.ts L602–611](https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/src/main/services/FileStorage.ts#L602-L611)。临时目录是否由退出/启动清理不在本次验证范围 |
| 直接源码行为 | 粘贴文件内部失败会记日志并显示文件错误，外层错误捕获返回 false；拖入单项错误被 getFilesFromDropEvent 的 allSettled 隔离；文件对话框 selecting 状态在 await 后恢复，没有 finally | [input.ts L12–38](https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/src/renderer/src/utils/input.ts#L12-L38)、上述 PasteService 与 AttachmentButton；错误、追加结果和会话关闭没有统一事务 |

## 对照时可借鉴与不能直接继承的内容

可借鉴的是消息原位编辑、附件标签增删、草稿与底部输入独立、取消在普通同步路径不改历史消息，以及“仅保存”和“保存后重发”两种用户意图明确分开。这些是交互研究结论，不要求复用上游实现。

不宜机械照搬 blocks 差集 + 多次 dispatch、在消息提交前单独增加 count、后台 void 清理、吞掉持久化错误、未 await 的提交回调或角色门禁不一致。它们不能替代 Ayase 已有的 repository、附件生命周期、全局引用保护与 roundVersions 语义。Cherry 的局部取消行为也不能替代异步文件选择、上传和保存期间取消的完整合同。

未证实的项目保留为研究边界：真实 UI 外观与快捷键效果、上传失败后可恢复性、取消中途操作的迟到提交、共享附件并发计数、重启后的 durable 结果、临时目录最终回收。源码研究没有证明这些验收项通过。

## Ayase 当前代码对照

本节核对 2026-10-13 的本地 `dev` 工作区（HEAD `3eb26be1339bdbeceb67e71beca1e79f0c3650b1`，含既有未提交改动）。#128 的批准范围见 [Issue](https://github.com/AyaseMinami/AyaseStudio/issues/128)；研究建议没有改变当前合同。

| 环节 | Ayase 现状与研究含义 | 本地依据 |
| --- | --- | --- |
| 编辑位置 | 已是消息内联编辑，保存、取消、保存并发送各自明确；编辑状态仅包含消息 ID 和正文。可扩展此处，无需把历史消息搬到底部输入框 | [MessageList.tsx](../src/ui/chat/MessageList.tsx)，editing state 与 message-editor |
| 原件与新增件 | 已保存附件使用受管 reference，未发送附件使用带 File 的内存草稿；选择时只读取文件头，完整读取与持久保存在提交路径中执行 | [attachments.ts](../src/chat/attachments.ts)，DraftAttachment / SentAttachment / prepareDraftAttachment / materializeDraftAttachment |
| 输入方式 | 选择器与粘贴处理位于 Composer；当前粘贴文件能力是图片。拖入事件由整个聊天容器处理，交给底部草稿的 onFiles | [Composer.tsx](../src/ui/chat/Composer.tsx)、[ChatWorkspace.tsx](../src/ui/chat/ChatWorkspace.tsx)。历史编辑器需消费自身投放事件，避免冒泡后附件同时进入底部草稿 |
| 仅保存 | edit-message 仅接受 content，仓库事务改正文并保留现有 attachments；空正文检查使用现有附件列表。编辑后重新加载 SessionStore，但当前编辑命令不触发附件清理 | [workspace.ts](../src/chat/workspace.ts)、[repository.ts](../src/chat/repository.ts)、[useConversationWorkspace.ts](../src/chat/useConversationWorkspace.ts)。扩展后空消息判断应使用编辑后的最终附件列表 |
| 保存并发送 | 当前只覆盖原用户消息的正文，读取原附件，不接受编辑后的新增/移除列表。最新一轮形成候选版本，旧轮重发截断后续历史 | [useChatSession.ts](../src/chat/useChatSession.ts)、[roundVersions.ts](../src/chat/roundVersions.ts)、[架构合同](ARCHITECTURE.md)。Cherry 按 askId 重置回答的实现不能替代此行为 |
| 资源保护 | AttachmentLifecycle 将文件写入与清理串行化，保护未提交资源；commit 校验新文件，discard 处理未提交副本。全局引用扫描包含所有对话及非活动问答候选 | [attachmentLifecycle.ts](../src/chat/attachmentLifecycle.ts)、[repository.ts](../src/chat/repository.ts)、[roundVersions.ts](../src/chat/roundVersions.ts)。移除编辑标签不能直接删除文件 |
| 格式与备份 | 消息已具有 attachments，嵌套附件和 roundVersions 已登记字段策略；预期可复用现有格式，但实际实现仍需检查资源引用和备份投影，无新增格式不能作为免检理由 | [dataPolicies.ts](../src/storage/dataPolicies.ts)、[数据合同](DATA-CONTRACTS.md) |

## 研究建议与待定事项

本节保留研究阶段建议；后续本地设计选择及独立审查见 [#128 设计案](ISSUE-128-DESIGN.md)，不代表功能已实施。

建议保留 Ayase 现有原位编辑，借鉴 Cherry 的独立草稿和附件标签交互，使用 Ayase 自身的受管引用、命令队列、仓库事务与文件生命周期。

1. 编辑草稿以一个有序列表表示保留的旧附件和新增 File，移除仅改变草稿。文本、新附件和移除项与底部输入草稿隔离；取消不写原消息。移除反馈应让用户能辨认本次删除了什么。
2. 文件选择、拖入、图片粘贴沿用当前支持能力。异步读取完成前若编辑会话已取消、切换或卸载，结果不得追加到另一条消息或触发迟到提交。
3. 仅保存不依赖模型凭据，也不发供应商请求；先准备新增受管副本，再提交文本及最终附件列表，校验/回滚及失败临时资源处理复用现有机制。数据库已提交但界面重载失败时，须区分“保存已成功”与“保存失败”，避免重复操作或删除已被引用的新文件。
4. 保存并发送冻结完整编辑快照，沿用当前协议校验、请求前准备和候选版本/历史截断语义。请求前失败与已发送后失败分开，已保存消息不因模型网络错误自动撤回，也不自动重发。
5. 旧附件回收在成功更新消息之后进行，并扫描所有真实引用；其它对话、分支和非活动候选仍有引用时保留文件。清理失败应与消息保存失败分开报告。

实施前还需确定：新增附件是否只开放给用户消息，助手消息如何处理已有附件；移除项采用直接消失、待移除标记或可撤销反馈；保存进行中取消的具体交互与结果归属。Cherry 的角色入口和取消实现不一致，不能用它消除这些产品选择。

重点验证应包括新增/移除/顺序、附件-only 消息移除最后一个附件、取消与异步迟到结果、分阶段保存失败及回滚失败、共享引用、分支与候选版本、重新打开后的持久结果，以及编辑拖入不污染底部草稿。界面验收使用隔离数据；原生文件能力和真实供应商验收另行记录。

## 本轮核验结果

主代理复核官方固定版本的 MessageEditor 保存准备、Message 父回调、useMessageOperations 差集写入和 FileManager 引用数路径，并对照上述 Ayase 本地代码。文档完成固定来源与相对链接、空白和差异检查。本轮没有修改功能，没有运行应用测试或 Cherry/Ayase 界面，也没有提交、推送或修改 Issue。后续实现若涉及接口、跨模块提交或资源生命周期，应依仓库规定进行独立审查。
