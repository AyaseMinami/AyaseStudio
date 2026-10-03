# 窗口、弹窗与浮层整改清单

盘点日期：2026-10-02。基于当前 dev 工作区源码（含本轮未提交 UI 修改）。本轮只收集，不实施整改；下列是可追踪的入口清单，不代表已逐一打开验收。按用户可见功能分项，共用实现单独标出，避免把一个组件的多个场景漏掉或重复重做。

## 边界

- 现有主导航聊天、绘图和六个设置页已完成本轮逐页调整，不作为新的整页重做对象。
- 应用当前只有一个配置的原生主窗口：见 [tauri.conf.json](../src-tauri/tauri.conf.json) 与 [lib.rs](../src-tauri/src/lib.rs)。大多数“窗口”实际是这个窗口里的 React 弹层。
- 备份恢复是同一主窗口内重新加载的独立工作区，不能按普通关闭弹窗处理。
- 操作系统文件选择／保存窗口单独登记，应用 CSS 不能统一其内部样式。
- 优先参考 [UI-DESIGN.md](UI-DESIGN.md)；材质和毛玻璃仍后置。本文优先级是整改建议，不是新增功能授权。

## A. 独立工作区及特殊页面

| 编号 | 页面／状态 | 入口 | 实现与整改范围 |
| --- | --- | --- | --- |
| A01 | Ayase 备份与恢复工作区 | 数据管理 → 进入备份与恢复 | [BackupWorkspace.tsx](../src/ui/settings/BackupWorkspace.tsx)、[CSS](../src/ui/settings/BackupWorkspace.css)。导出、加密密码、恢复文件、解密、预览、冲突、合并／副本／替换、凭据确认、结果及失败状态一起盘点；当前只改过外面的入口页。 |
| A02 | 启动检查／数据恢复异常页 | 启动配置检查或回滚失败 | [BackupApp.tsx](../src/backup/BackupApp.tsx)。加载、失败、重试整理及恢复入口；应保留错误信息与数据保护边界。 |

## B. 配置、资源与预览弹窗

2026-10-03 进度更新：B02 编辑对话配置已进入首版试调，沿用 B01 的尺寸、留白、分组和固定底栏。对话标题单独归入“对话信息”，模型与搜索／思考归入“模型与能力”；提示恢复默认只更新模型与配置草稿，不改标题，保存后生效。#116 后续已用共享选择器替换原生下拉，保留原有保存、校验和取消行为。本条取代下方早期“B02 暂未推广”的进度记录。

| 编号 | 用户可见窗口／变体 | 触发入口 | 实现 |
| --- | --- | --- | --- |
| B01 | 新建助手、编辑助手 | 助手栏新建／管理菜单编辑 | [ConversationNavigation.tsx](../src/ui/chat/ConversationNavigation.tsx) → [SessionConfigPanel.tsx](../src/ui/chat/SessionConfigPanel.tsx)。大表单、模型与思考参数、头像、固定操作区。 |
| B02 | 编辑当前对话配置 | 对话列表编辑／调整配置 | [ConversationSettings.tsx](../src/ui/chat/ConversationSettings.tsx) → 同一 SessionConfigPanel。与助手共用外壳，保存对象不同。 |
| B03 | 聊天模型选择 | 输入区模型入口 | [ModelPicker.tsx](../src/ui/chat/ModelPicker.tsx)。搜索、分组、当前选择、失效模型及保存状态。 |
| B04 | 已发送附件预览 | 消息附件入口 | [SentAttachmentPreview.tsx](../src/ui/chat/SentAttachmentPreview.tsx)。图片切换、PDF、文本／Markdown，以及不支持正文预览的文件信息状态。 |
| B05 | 助手头像选择 | 助手编辑器头像入口 | [AssistantAvatarEditor.tsx](../src/ui/chat/AssistantAvatarEditor.tsx)、[AvatarLibrary.tsx](../src/ui/avatar/AvatarLibrary.tsx) 的 AssistantAvatarSelector／AvatarModal。 |
| B06 | 供应商头像选择 | 连接配置 → 供应商头像操作 | [ConnectionSettings.tsx](../src/ui/settings/ConnectionSettings.tsx) → 同一 AvatarModal／AvatarLibraryPanel。 |
| B07 | 头像导入、替换、裁切／重新裁切 | 头像设置、头像库及助手头像编辑 | [AvatarLibrary.tsx](../src/ui/avatar/AvatarLibrary.tsx)、[AvatarSettings.tsx](../src/ui/settings/AvatarSettings.tsx)。独立 AvatarCropDialog 和头像库内切换视图均需覆盖。 |
| B08 | 背景图库 | 外观 → 选择背景 | [BackgroundLibraryDialog.tsx](../src/ui/settings/BackgroundLibraryDialog.tsx)。选择、导入、管理、错误、删除确认及取景子视图。 |
| B09 | 背景取景 | 调整取景中心／背景导入后编辑 | [BackgroundFocusDialog.tsx](../src/ui/settings/BackgroundFocusDialog.tsx)、[App.tsx](../src/App.tsx)。独立 dialog 与图库内 BackgroundFocusEditor 两条入口。 |
| B10 | 手动添加模型 | 连接详情 → 手动添加 | [ConnectionSettings.tsx](../src/ui/settings/ConnectionSettings.tsx) 的 AddModelDialog。原生 HTML dialog。 |
| B11 | 获取模型目录、筛选与添加 | 连接详情 → 获取模型列表 | 同一 ConnectionSettings 的 model-catalog-backdrop。自定义遮罩模态层，含加载、失败、筛选、选择和批量添加。 |
| B12 | 提示词预设：另存、更新、编辑、删除 | 绘图 → 提示词预设操作 | [DrawingPresets.tsx](../src/ui/drawing/DrawingPresets.tsx)。同一 Portal 表单的四种状态，删除也要单独验收。 |
| B13 | 参考图大图预览 | 绘图 → 点击参考图 | [DrawingReferences.tsx](../src/ui/drawing/DrawingReferences.tsx)。加载、失败、原图及关闭／切换行为。 |

## C. 确认框与危险操作

| 编号 | 场景 | 当前形态／实现 |
| --- | --- | --- |
| C01 | 清空当前对话 | [ChatHeader.tsx](../src/ui/chat/ChatHeader.tsx)，自定义 message-confirm-dialog。 |
| C02 | 删除单条消息 | [MessageList.tsx](../src/ui/chat/MessageList.tsx)，同名样式、独立 ConfirmationDialog 实现。 |
| C03 | 删除助手：迁移对话／永久删除全部 | [ConversationNavigation.tsx](../src/ui/chat/ConversationNavigation.tsx)，ManagementDialog 含二次状态。 |
| C04 | 删除头像库所选图片 | [AvatarLibrary.tsx](../src/ui/avatar/AvatarLibrary.tsx)，独立模态框或选择器内部视图，保留使用中资源说明。 |
| C05 | 删除背景图片 | [BackgroundLibraryDialog.tsx](../src/ui/settings/BackgroundLibraryDialog.tsx)，图库内部确认状态，不是另一原生窗口。 |
| C06 | 删除绘图任务历史 | [DrawingWorkspace.tsx](../src/ui/drawing/DrawingWorkspace.tsx)，TaskConfirmationDialog；单项及批量共用。 |
| C07 | 重新生成绘图任务 | 同一 TaskConfirmationDialog，保留可能重复计费及任务状态已变化提示。 |
| C08 | 删除绘图成果 | 同一 TaskConfirmationDialog，单项及批量共用；与删除历史范围不同。 |
| C09 | 删除绘图预设 | B12 的删除变体，不能遗漏。 |
| C10 | 放弃未保存模型编辑 | [ConnectionSettings.tsx](../src/ui/settings/ConnectionSettings.tsx)，window.confirm。 |
| C11 | 恢复连接内置默认值 | 同文件，window.confirm，明确保留 Key 和模型。 |
| C12 | 删除供应商及其连接／模型 | 同文件，window.confirm。 |
| C13 | 修改连接协议影响已有模型 | 同文件，window.confirm。 |
| C14 | 删除连接及其模型 | 同文件，window.confirm。 |
| C15 | 删除模型 | 同文件，window.confirm，含助手默认模型提示。 |
| C16 | 模型测试费用确认 | 同文件，window.confirm。 |
| C17 | 绘图队列未结束时退出 | [useDrawingWorkspace.ts](../src/drawing/useDrawingWorkspace.ts)，window.confirm。 |
| C18 | 生成图片尚未保存时退出 | 同文件，window.confirm。 |

初次盘点发现 **9 个 window.confirm 调用点**：连接设置 7 个、绘图退出 2 个。2026-10-03 已全部迁移为应用异步确认，C10–C18 表格中的 window.confirm 是原实现记录；当前入口复用 useConfirmation。C01–C09 统一现有确认布局（预设删除已在 B12 完成），保留原取消、重复操作和退出阻断语义。定向测试、独立审查与隔离空闲启动关闭通过，原生忙碌退出和视觉仍待用户验收。

## D. 菜单、快捷面板与提示浮层

2026-10-03：D01–D13 本轮统一样式，规则集中在 [FloatingSurfaces.css](../src/ui/FloatingSurfaces.css)。共用操作菜单覆盖助手、对话、供应商、连接和参考图；重命名单独表单排布。思考、联网搜索、生成统计、供应商模板、绘图更多及帮助浮层保持原功能结构。窄窗口搜索定位修复，绘图任务保留行内展开。定向测试 34 项通过，类型检查与生产构建通过；浏览器使用隔离数据检查代表性菜单、重命名、统计及 390px 搜索边界，完整主题／尺寸组合仍待体验。

2026-10-03：用户确认短列表样板后，#116 已全面实施。[SelectField.tsx](../src/ui/SelectField.tsx) 覆盖聊天、设置、绘图的短列表；[SearchSelectField.tsx](../src/ui/SearchSelectField.tsx) 共享模型／复制连接／预设长列表搜索与分组。B01、B02 的默认模型和 B03 复用 ModelPicker；D08 的力度与 D10 的回复／请求使用短列表。src 原生 `<select>` 声明从 30 处归零，没有系统控件保留项。主代理逐个展开检查了各字段，含助手／对话五项参数分别检查、四种绘图协议和版本差异；浅深主题与窄窗口证据见 [覆盖记录](ISSUE-116-IMPLEMENTATION.md)。这是下拉框专项验收，不代表上述所有弹窗流程均已完成真实桌面验收。

| 编号 | 浮层／入口 | 实现与复用关系 |
| --- | --- | --- |
| D01 | 助手管理菜单 | [ConversationNavigation.tsx](../src/ui/chat/ConversationNavigation.tsx) → [ActionMenu.tsx](../src/ui/ActionMenu.tsx)。 |
| D02 | 对话管理菜单 | 同一 ActionMenu，更多与右键／键盘入口。 |
| D03 | 供应商管理菜单 | [ConnectionSettings.tsx](../src/ui/settings/ConnectionSettings.tsx) → ActionMenu。 |
| D04 | 连接管理菜单 | 同一 ActionMenu。 |
| D05 | 供应商／连接重命名 | 同一 ActionMenu 切换 role=dialog 并显示小表单；不能只验收普通菜单。 |
| D06 | 管理内置供应商 | ConnectionSettings 的 provider-create-menu，details 展开的菜单。 |
| D07 | 参考图操作菜单 | [DrawingReferences.tsx](../src/ui/drawing/DrawingReferences.tsx) → ActionMenu。 |
| D08 | 聊天思考设置 | [ThinkingControl.tsx](../src/ui/chat/ThinkingControl.tsx)，thinking-popover；不同协议显示不同选项。 |
| D09 | 聊天联网搜索选择 | [WebSearchControl.tsx](../src/ui/chat/WebSearchControl.tsx)，web-search-popover。 |
| D10 | 生成统计详情 | [GenerationStats.tsx](../src/ui/chat/GenerationStats.tsx)、[CSS](../src/ui/chat/GenerationStats.css)，details 触发的向上浮层。 |
| D11 | 绘图成果“更多” | [DrawingWorkspace.tsx](../src/ui/drawing/DrawingWorkspace.tsx)，drawing-result-more；窄屏已有行内展开适配。 |
| D12 | 绘图任务“更多” | 同文件 drawing-task-more；与成果操作分开验收。 |
| D13 | 问号帮助浮层 | [SettingsHelp.tsx](../src/ui/settings/SettingsHelp.tsx)、[CSS](../src/ui/settings/SettingsHelp.css)，多页面共用，包含最新关于页反馈说明。 |

## E. 相邻内联界面（不是弹窗，统一时不要漏看）

| 场景 | 位置／说明 |
| --- | --- |
| 对话删除确认、助手／对话列表编辑状态 | [ConversationNavigation.tsx](../src/ui/chat/ConversationNavigation.tsx)，区分行内操作与 C03 大确认框。 |
| 消息编辑 | [MessageList.tsx](../src/ui/chat/MessageList.tsx)，消息内编辑及保存／取消，不是独立窗口。 |
| 模型编辑、供应商创建、接口／请求地址详情 | [ConnectionSettings.tsx](../src/ui/settings/ConnectionSettings.tsx)，行内编辑／展开。 |
| Cherry 导入预览、重复策略、导入结果 | [DataImportSettings.tsx](../src/ui/settings/DataImportSettings.tsx)，当前已调整外层样式，流程子状态仍应查看。 |
| 绘图任务详情／诊断、队列说明、成果元数据 | [DrawingWorkspace.tsx](../src/ui/drawing/DrawingWorkspace.tsx)，details 行内展开。 |
| 搜索来源、思考正文 | [SearchResults.tsx](../src/ui/chat/SearchResults.tsx)、[ThinkingSummary.tsx](../src/ui/chat/ThinkingSummary.tsx)，消息内容披露，不按模态框处理。 |
| 附件拖入提示、复制成功提示 | [ChatWorkspace.tsx](../src/ui/chat/ChatWorkspace.tsx)、[AboutSettings.tsx](../src/ui/settings/AboutSettings.tsx) 等，短暂状态层／行内反馈。 |

## F. 系统窗口（记录入口，不改系统外观）

| 系统交互 | 代码入口 |
| --- | --- |
| 选择／保存 Ayase 备份 | [ayase_backup.rs](../src-tauri/src/ayase_backup.rs) |
| 选择 Cherry 备份 | [cherry_import.rs](../src-tauri/src/cherry_import.rs) |
| 选择背景图片 | [background.rs](../src-tauri/src/background.rs) |
| 导出绘图图片／带参数 PNG 保存位置 | [drawing.rs](../src-tauri/src/drawing.rs) |
| 选择聊天附件、参考图、头像图片 | HTML file input：[Composer.tsx](../src/ui/chat/Composer.tsx)、[DrawingReferences.tsx](../src/ui/drawing/DrawingReferences.tsx)、[AvatarLibrary.tsx](../src/ui/avatar/AvatarLibrary.tsx) |
| 打开文件夹／外链 | 系统资源管理器／浏览器，应用只统一触发入口与失败反馈。 |

## 建议整改顺序

1. **助手／对话配置（B01–B02）做大弹窗样板**：标题、表单分组、滚动区、底部操作、宽窄尺寸。两者共用外壳，优先收益高。
2. **确认框（C）做小弹窗样板**：先统一现有应用确认框；系统 confirm 的迁移作为单独行为改造，退出确认尤其独立处理。
3. **模型选择与目录（B03、B10–B11）**：搜索、列表密度、选择反馈和底部操作。
4. **资源库与预览（B04–B09、B13）**：统一外壳，但分别保留图片、PDF、裁切和图库的内容需求；检查嵌套弹层。
5. **绘图预设（B12）与所有小浮层（D）**：菜单共用 ActionMenu，问号共用 SettingsHelp；不强行把不同职责全部做成同一种外观。
6. **独立备份工作区与启动状态（A）**：按完整流程重新排布，保持数据确认和恢复规则；与普通视觉修整分开验收。

每项后续记录：未开始／试调／用户确认。B01 已进入首版试调：新建／编辑助手分为基本信息（名称与头像）、模型与能力，再接系统提示词和参数；固定底栏突出创建／保存，保留恢复默认。其余项尚未开始本轮统一整改，部分控件以前已有局部样式改善。B02 暂未推广新样式。

## 后续检查重点

2026-10-03：B12 绘图预设另存／更新／编辑／删除统一样式试调，整理表单与底部主次操作，待用户视觉确认。

2026-10-03：B13 绘图参考图预览沿用 B04 图片预览的收窄外框、标题与关闭按钮样式，待用户视觉确认。

2026-10-03：B09 背景取景进入样式试调，整理画布、缩放、位置与效果预览，保留固定底栏及原取景逻辑。

2026-10-03：B08 背景图库进入排布试调，收紧图库列、统一缩略图和右侧参数层级；B09 取景编辑内容未改。

2026-10-03：B07 头像裁切完成轻量样式试调，保留裁切交互与低高度窗口缩小预览规则，待用户视觉确认。

2026-10-03：B05 头像选择进入试调，整理当前头像、候选分区、导入说明与吸附操作栏；共用 inline 选择区的供应商头像同步获得格子与底栏样式，裁切内容未重新设计。

2026-10-03：B11 远端模型目录进入试调：统一横向留白、名称／ID 两层文字、轻分组边界及添加状态，待用户视觉确认。

2026-10-03：B10 手动添加模型进入试调，统一小弹窗留白、字段说明和底部操作，保留原有添加与取消语义，待用户视觉确认。

2026-10-03：B03 模型选择进入轻量试调，保留现有搜索与连接分组，整理对齐、组间分隔、长名称及选中／悬停反馈，待用户视觉确认。

- 外观：标题与关闭位置、间距、边界、按钮层级、长文案、错误位置、窄窗口滚动。
- 行为：打开聚焦、Tab 范围、Escape／点遮罩关闭、关闭回焦、未保存草稿、忙碌／禁用、嵌套层级。
- 资源／数据／退出弹窗保留原安全语义；独立备份工作区不改为普通弹窗关闭。
- 这次是源码盘点：检索实际 dialog、role、Portal、菜单、details、confirm、原生窗口配置和文件入口；未操作真实数据、触发供应商请求或系统文件窗口。清单不是运行时视觉验收或缺陷审计。
