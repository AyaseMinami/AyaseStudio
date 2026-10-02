# Ayase Studio v0.1 Plan

## Chat generation statistics #107 (2026-10-02)

用户确认统计随回复保存，并按 Harness 截图放在输入框底部。四种聊天协议统一输入／输出、缓存读取／写入、思考 Token 及请求计时；未知与零区分，暂停／继续按请求保存，失败／停止保留部分用量。详情可查看回复及请求，备份包括轮次历史。没有费用、全局累计或任务步数；中转站长对话／真实正缓存命中由用户后续验证，不再追加实时探测。见 [实现与验证](ISSUE-107-IMPLEMENTATION.md)；本地完成不代表提交、推送或关闭 Issue。

## Drawing single-page task panel #111 (2026-10-02)

用户授权实施单页布局并补充左上角横向任务／日志标签的表格截图。配置下方为独立限高任务面板，队列状态和控制迁入标题区；右侧预览和历史常驻。保留完整参数展开、50 项独立分页、任务操作及风险提示，不改变队列或持久数据，也不扩大 #108／#109／#110。相关设计以 [UI 约定](UI-DESIGN.md) 为准；验证结果与人工边界见 [实施记录](ISSUE-111-IMPLEMENTATION.md)。本地实现不代表提交、推送或远端 Issue 关闭。

## Session reference preparation #110 (2026-10-02)

参考图改为当前会话选择，先捕获原字节并预览；显式提交时冻结顺序、准备受管原图，再原子登记整批任务。新增独立取消准备、二进制导入和按来源隔离的中断导入恢复记录；旧草稿绑定保守保留，新会话参考图不写入草稿或可移植备份。原字节、格式、尺寸和透明度不转换。实现、隔离测量与接受边界见 [#110 实施记录](ISSUE-110-IMPLEMENTATION.md)；真实供应商、原生文件窗口／关闭重启及远端交付分别处理。

## Drawing protocol completion #101 (2026-10-01)

用户授权功能优先、本地实施，不重新设计 UI。Gemini 可选温度／统一四类安全阈值／输出模式接入草稿、快照、复用、显式参数 PNG 和绘图设置备份；移除 Gemini 借用字符上限，OpenAI 按 Unicode 码点校验 32,000 字符。补齐 GNBP 单对象响应及有界 CR/LF／合法 data-URL 兼容。绘图设置模块 v2／最低读者 2，文档 v5、信封 v1、schema v8 保持。官方和固定版本参考已重新核对；验证与独立审查见 [#101 实施记录](ISSUE-101-IMPLEMENTATION.md)。远端交付／关闭、真实服务和 #94 压力接受分别处理。

## Persistent data contracts #105 (2026-10-01)

用户授权本地实现统一模块数据注册、实际类型字段策略、纯迁移、备份 v4 兼容声明和限定参数降级，并将这些规则写入未来开发合同。当前注册覆盖 13 张表／8 个偏好键；连接 v2 → v3、搜索 v1 → v2 及会话读取共享迁移基础。工作区非法结构在事务写入前拒绝。新备份保持信封／加密 v1，历史文档 v1/v2/v3 严格读取；只过滤兼容未来会话的声明可选参数，报告路径并保留再次导出可能丢失参数的警告，不改写原文件。

开发者须随数据变化同步注册、嵌套字段策略与真实投影、迁移／默认政策、确定性测试和独立 Sol/high 审查，无需用户提醒。静态检查不保证任意动态键或语义迁移，旧客户端也不会因此自动支持新格式。详见 [持续开发合同](DATA-CONTRACTS.md) 和 [本地实施／验证记录](ISSUE-105-IMPLEMENTATION.md)。

#93 已本地接入 `drawingSettings`／`drawingPresets`，使用独立字段投影和维护协调取代旧绘图范围禁用规则；#105 的 v4 基础历史保持，新导出由 #93 升为 v5。范围不包括自动草稿提示词、参考图、任务／结果历史或图片；旧 #83 全图库备份提案由最新决定明确取代。#105 接入和确定性跨版本样例已补齐，剩余实际原生接受项与 #94 压力独立验收。用户随后授权提交推送本项及必要基础代码、关闭 #93；#105 和 #94 保持打开，交付结果见 #93 评论。

2026-10-02 #105 收尾修正搜索／外观未知结构的持久覆盖风险，补齐真实数据库重开回归；全量门禁及独立复审通过。隔离备份专用原生入口已完成 staging／applying 两种跨进程恢复、快照精确回滚和日志附件清理；内置浏览器实际恢复三种策略、旧版与未来参数及加密预览通过。用户明确确认本轮系统文件对话框／合成备份人工验收通过，#105 本地收尾完成。完整应用生命周期、真实用户数据和 #94 压力边界保持独立；用户随后授权提交、推送及关闭 #105，实际交付以远端验收评论及 Git 历史为准。具体证据见 [收尾记录](ISSUE-105-IMPLEMENTATION.md#实际运行结果与人工交接)。

## Drawing settings and explicit preset backup #93 (2026-10-01)

用户授权本地规划及实施，本地代码门禁、定向回归和独立 Sol/high 审查已完成。新导出文档 v5／信封 v1，严格保留旧 v1–v4 合同及 v4 原七模块集合。`drawing.settings`、`drawing.presets` 独立可选并匹配模块声明；新导出包含两类，预设为空与类别缺失语义不同。设置投影不带 prompt／references，显式预设保持正文空白及同名不同 ID。绘图读入口共享克隆、默认与结构验证，不新增 schema 或 OpenAI 尺寸文本字段长度限制，生成尺寸由 transport 校验。

合并／副本保留本机设置；替换只应用包含的绘图类别，补丁更新设置但保留当前 prompt／references，旧包或缺失类别不清空绘图。原始当前草稿／预设仅参与私有恢复日志与原子提交；旧日志未捕获时跳过对应类别。历史、图片及未决本地保存日志保留，目标变化按冻结的供应商／连接 ID、协议／地址／实际上游模型 ID 报告，恢复不发请求、不操作绘图文件。正常入口同步封锁聊天／绘图并排空既有操作；活动请求／自动命名需先完成或明确取消，仅内存图片拒绝重载，queued 项保留。原生绘图文件锁加入启动恢复围栏，备份回滚先于绘图初始化和 GC。

已完成隔离数据及模拟文件／请求的恢复、回滚、兼容、维护和预算回归、本地代码门禁及独立 Sol/high 审查。隔离内置浏览器通过实际 Dexie 恢复验证提示词保留、未来参数过滤警告和再次导出；隔离 Tauri 编译／启动确认进程。隔离浏览器浅色宽窗口与深色／自定义主题窄窗口视觉验收已完成，截图已检查且无横向溢出；原生文件窗口和真实关闭重启单列为 #94 人工接受项，真实供应商待另行授权。具体运行范围与证据见 [#93 记录](ISSUE-93-IMPLEMENTATION.md)；完整图库压力仍由 #94 承担，本地实现不代表交付／Issue 关闭。

## List sorting #99 (2026-10-01)

用户授权继续完成助手／聊天拖动排序。供应商与连接配置树的既有切片保持；新增两类导航列表的把手／名称长按、插入提示、边缘滚动、取消与误点击隔离、菜单上下移和独立持久化。聊天首次实际手动换序后固定同助手顺序，新建聊天置顶；工作区与备份保存顺序。实现与验证见 [开发指南](DEVELOPMENT.md#list-sorting-99-2026-10-01)。实施检查后用户已授权提交、推送及关闭 #99；实际交付状态以 [Issue 评论](https://github.com/AyaseMinami/AyaseStudio/issues/99) 为准，原生关闭重启验收边界保持。

#87 queue is locally implemented: batches 1–99, persistent FIFO, concurrency 1–4, pause/resume, cancellation and conservative restart recovery. [#87 implementation](ISSUE-87-IMPLEMENTATION.md) records the initial subset; [#88 lifecycle implementation](ISSUE-88-IMPLEMENTATION.md) adds batch cancellation, regeneration/source deduplication, terminal history cleanup, local recovery inventory and sanitized diagnostics. Native interaction and #94 pressure acceptance remain separate. No remote delivery or issue closure is implied.

## Drawing prompt presets and parameter reuse #90 (2026-10-01)

Local implementation adds pure-text name/content presets in database v8, explicit CRUD and save-as, direct text-only application, and task prompt copying/full parameter reuse through the existing result reuse path. It keeps per-protocol controls and ordered input references independent, reports invalid targets/missing files and never generates implicitly. The historical pre-#93 backup gate included presets and is superseded by #93's projection and maintenance coordination; PNG parameter export remains #89, old PNG import remains #92, and drawing/chat exchange remains #91. See [#90 implementation and verification](ISSUE-90-IMPLEMENTATION.md); local work does not imply Git delivery or remote acceptance.

## Beta drawing scope #23 / #83 (2026-09-30)

2026-10-01 用户授权 #85 OpenAI 兼容 Images 文生图，并要求核对 GPT／Gemini 当前尺寸与分辨率文档。本地实现共享配置、按协议隔离的参数、Base64 单请求生成及既有保存／预览闭环；新版选项和具体兼容边界见 [#85 实施记录](ISSUE-85-IMPLEMENTATION.md)。#86 参考图和其他后续范围不因此提前纳入；真实服务、远端交付与 Issue 关闭仍分别验收。

User approval includes implementing #84 directly (2026-10-01). The local slice adds the production navigation/page, independent Gemini drawing configuration, single text-to-image task, cancellation, durable private saving/recovery, automatic large preview, plain PNG export and parameter reuse. It introduces drawing database v7 and explicit old-backup maintenance protection until #93. #85 adds OpenAI Images; [#86 implementation](ISSUE-86-IMPLEMENTATION.md) adds ordered reference inputs and result reuse as references, preserving original bytes without additional input caps or preprocessing. Batching/concurrency, full gallery management, presets, parameter export and chat exchange remain subsequent Issues. Local implementation/test evidence is recorded in [#84 implementation](ISSUE-84-IMPLEMENTATION.md); no commit, push, Issue closure or live-provider acceptance is implied.

The user confirmed an independent drawing module as the second business workspace, sharing the service-settings entry but isolating chat/drawing protocols, models, parameters and data. Same-prompt batches use one image request per task, with global concurrency 1–4 (default 1). Results/parameters and drafts/reference images persist locally; ordinary export omits generation metadata. Restart leaves queued work paused until the user continues it, and never resends possibly dispatched tasks automatically.

The independent Beta includes #84–#90, #93, #94 and [#101 protocol follow-up](https://github.com/AyaseMinami/AyaseStudio/issues/101) from the 2026-10-01 audit. #91 chat exchange and #92 reading legacy PNG parameters remain later; #89 owns optional parameter-bearing PNG export. #93/#94 do not depend on #91/#92. The user authorized remote requirement reconciliation; historical records and CLOSED #84–#86 remain intact. See [confirmed scope and audit](ISSUE-83-DRAWING-SPEC.md#14-2026-10-01-全面核对与需求修订). The old sketch is illustrative, not current acceptance evidence.

Audit decisions: batches 1–99/no additional queue-count cap; global concurrency 1–4/default 1; single save failure does not pause later work. Pure-text presets and history reuse load directly. Special terminal histories may be removed after an extra warning without deleting saved results. Zoom/pan/reset, reference clearing, prompt copying and optional completion sound are follow-ups. Gemini advanced parameters default to model behavior, not fixed 0.9. These are requirements, not implemented capabilities.

## Custom context menus #74 scope revision (2026-09-30)

The user revised #74 to suppress default WebView context menus throughout the application while retaining native editing menus in inputs, textareas and editable text. Only assistant rows, conversation rows, provider rows and connection rows (tree and provider overview) receive custom object menus. Message actions remain in their existing buttons; blank list areas do not open a menu. Existing business operations, generation guards and deletion confirmations remain authoritative. This supersedes the original issue's message-menu direction and adds provider/connection menus. The user has tested and accepted the result and authorized syncing the remote issue to this scope, committing, pushing and closing it. Current interaction rules are recorded in [UI-DESIGN.md](UI-DESIGN.md).

## Exa external search #80 scope revision (2026-09-30)

The user's later instruction splits external search into Exa API (required Key) and Exa MCP (optional Key), each with independent saved endpoint, credentials and result count. Conversation/assistant controls choose either explicitly; no automatic fallback. Legacy MCP settings remain MCP, existing native search remains native. Both share the bounded retrieval-to-answer pipeline and sources. New backups use document v3, with v1/v2 import compatibility and unchanged encryption envelope. This supersedes the earlier MCP-only scope without adding arbitrary MCP, OAuth, a tool runtime or autonomous research. See [implementation](ISSUE-80-IMPLEMENTATION.md).

## Ayase data backup and restore #79 (2026-09-30)

The user's latest request supersedes the previous category checkboxes and mandatory encryption rule: export always includes connection configuration and API Keys, exposing only a default-off encryption switch button. Connection configuration includes provider groups, connection names, protocols, addresses and configured models. The switch alone decides the envelope type: plaintext backups need no password or extra export confirmation; encrypted backups require password confirmation by equality only, with no length or character restrictions (including Chinese and empty matching values). Password input is used as entered, without trimming or normalization. Show a brief plaintext credential warning when applicable. Decrypt and validate encrypted backups locally before content preview or any persistent write; an incorrect password, corruption or tampering leaves current data unchanged. Passwords are not retained or uploaded, and forgotten passwords cannot be recovered by Ayase. Older backups excluding connections or keys remain readable.

Preview and results explicitly state the connection, credential and encryption status. Newly restored connections without credentials require re-entry; merging into retained existing connections must not erase their credentials because a backup omits them. Restoring included credentials requires an explicit conflict decision and must not silently overwrite existing keys. Build exports from explicit allowed fields instead of archiving raw application/browser storage; excluded keys must not appear in export payloads or temporary export files. Excluded fields do not promise to remove secrets users have embedded in chat text or attachments. [Cherry Studio research](ISSUE-79-BACKUP-RESEARCH.md) is a reference, not Ayase's security contract. The user has confirmed that current code behavior is authoritative for #79: credentials are always included and encryption remains an independent default-off switch. The remote issue description has been updated to record this scope revision. Local implementation and verification are recorded in [the development guide](DEVELOPMENT.md#ayase-backup-verification-79), with native interaction acceptance tracked separately.

Issue #79 also records the shared data-management settings page, persistence consistency and independent security-review gates. The user has confirmed successful Cherry import; preserve that existing behavior. The dev workspace contains the local format/export/preview/restore implementation described in [the backup guide](AYASE-BACKUP.md), including merge/copy/replace policies and startup rollback gating. Native file dialogs, real user backup restore and restart/power-loss acceptance remain separate manual checks.

## Cherry chat backup import #77 (2026-09-30)

Local chat-only import preserves assistant grouping, titles, messages, thinking and supported internal attachments. The user clarified that importing model/provider configuration is outside this task; imported chats have no Cherry model binding. Parallel replies and historical branches become independent conversations so all supported paths remain readable. Preview selection and skip/copy duplicate handling protect existing data; files are staged and verified before one atomic metadata commit. Supported pinned formats and remaining real-export/native interaction acceptance are documented in [CHERRY-IMPORT.md](CHERRY-IMPORT.md) and [ISSUE-77-IMPLEMENTATION.md](ISSUE-77-IMPLEMENTATION.md). The remote Issue remains unchanged.

## Built-in color presets #66 (2026-09-29)

七套本地内置方案：晴蓝、纸页、青竹、海盐、鸢尾、蔷薇、琥珀，均包含浅深两组组件、画布及双方气泡颜色。按用户最新要求，顶部恢复跟随系统/浅色/深色/阅读四个并列按钮，下方保留七个配色缩略选项。阅读快捷应用浅色纸页，保留 `reading` ID 及既有浅色主要颜色；退出阅读恢复默认方案，其他状态切换明暗保留方案。

切换方案或“恢复方案配色”只清除颜色微调，保留明暗模式、图片、取景、透明度、连接与聊天状态。单项微调继续即时持久化，重启恢复；全局恢复外观沿用原行为，回到晴蓝并恢复透明度、停用背景且保留图库。不扩展 #71 的命名自定义方案管理。尚未提交、推送或关闭 Issue。

## Local background library #70 (2026-09-29)

用户确认增加独立持久缩略图以降低大图库开销：新导入生成、旧库按需补生成，图库按可见范围加载小图，候选大预览继续原图。缩略图随原图实际清理成对删除，仍被当前背景引用时成对保留。此项不改变原图分辨率，不引入 2K/4K 降采样存储策略。

后续用户确认：在背景库弹窗内提供适配、遮罩、模糊及取景编辑，外观页继续可编辑。弹窗修改仅用于候选预览，最终“应用背景”保存所选图片参数并应用；取消放弃未应用参数。不同图片的临时参数互不覆盖，保存失败可重试。维持完整原图私有副本及独立显示参数的既有保存方式。该调整取代原 #70“不在图库内复制配置表单”的范围限制。

用户本次确认与头像库统一操作语义：图库是收藏，当前背景独立持有图片版本及显示参数。删除只移出图库；替换仅改变库中的图片，当前背景保留旧版本，明确“应用背景”才切换。此规则取代远端 #70 的“删除当前背景后停用”要求。横向纯图片宫格、独立管理模式、多选/全选/批量删除、单选替换取代逐图菜单及“不做批量管理”的旧限制；不再提供命名输入或重命名，文件名用于提示。批量管理不包括批量导入。

外观页“选择背景”打开库弹窗，候选预览不改变真实背景。成功导入保存到库并选为候选，取消弹窗不撤销已保存的导入或管理操作。替换先预览再明确保存，保留适配/遮罩/模糊并重置新图取景，之后可在外观页调整；失败保留原条目。每个库图片保存独立参数，当前背景调整仅更新相同图片版本的库条目，不能污染已替换的新版本。

停用背景保留当前图片和参数，可重新启用。恢复默认外观重置颜色及透明度并停用背景，保留图库与当前图片参数。旧单背景连同全部取景和显示参数兼容入库；缺失或损坏资源保留记录并安全显示基础画布。所有图片仅存在本机私有目录，不上传、不进入聊天请求。用户授权本地实施与验证，未授权提交、推送或修改远端 Issue。

## Local avatar library #69 (2026-09-28)

后续用户修订：头像库改为小间距纯头像宫格，管理模式提供多选批量删除和单图替换；删除确认后整批原子保存，保留已应用的图片。移除名称输入和重命名功能，导入默认采用文件名供悬停与无障碍识别。以上取代此前命名及独立条目菜单的界面约定，远端未修改。

后续界面确认：用户头像与头像库合并为一张卡片，唯一导入入口放在当前头像旁。裁切命名并保存到库后自动选中新图片，仍由「用作用户头像」明确应用；取消导入保留原候选，助手选择器不变。

当前用户确认四项规则：库保存默认裁切，对象独立裁切；替换库图片保留已有对象的旧版本；从库中删除不影响已有头像，保留显示、独立裁切及重启恢复；助手编辑中已保存到库的图片不因取消编辑而删除。删除规则按用户后续要求替代“使用中阻止删除”，删除时原子解除来源关系，已选草稿保存时也可转为独立图片。旧版本仅由使用对象持有，对象更换/移除或删除后释放，不另建历史版本库。既有用户头像一次性兼容迁移，旧助手头像原样保留，不强制入库。

设置 → 头像直接管理共享库，保留当前用户头像、聊天预览及新助手内置默认值。导入与应用分开；助手选择器仅回填草稿，保存助手才生效。支持命名、重命名、替换、从库中删除及恢复默认。图片仅本地使用，不扩展到 #70 背景库、市场、同步或自动生成。上述规则取代远端 Issue 中对应的待确认建议；当前未授权修改远端、提交或推送。验证记录见开发指南。

## Assistant avatars #67 (2026-09-28)

以选图、正方形裁切、重裁和移除替换助手 Emoji 选择器，复用用户头像处理。每个助手独立保存原图、缩略图与取景；裁切先进入编辑草稿，保存助手后生效。侧栏与既有助手消息显示当前头像。内置四种矢量默认头像，可为单个助手选择，也可设置以后新助手的初始默认值；旧 Emoji 兼容显示。图片损坏回退默认，头像不进入会话配置或模型请求。本轮不包含共享头像库；远端 Issue 未修改。

## User avatar #32 / #34 (2026-09-28)

本地实现独立头像设置页、全局用户消息头像、正方形缩放/位置裁切、保留原图重裁、更换及移除。原图/裁切参数/缩略图原子保存于独立本地 IndexedDB，不进入模型请求。按用户最新确认，未设置、移除或无法读取时显示默认人形头像，聊天双方头像尺寸已调整为 40px；用户与助手头像独立且同时显示，助手布局见 #67。

这是 Epic #68 的首个限定范围实现；助手头像见上方 #67，共享头像/背景库留待后续。定向自动验证和内置浏览器验收完成，主观视觉及原生选图/桌面重启验收待用户确认。远端 Issue 未更新或关闭。

## Goal

Build a fast, local-first desktop chat client with a deliberately small feature set. Ayase Studio is a new implementation, not a Cherry Studio fork.

### Issue #19 chat content width

聊天标题栏的展开/收窄按钮同步调整消息列与输入框。默认窄屏居中（最大 48rem），宽屏占满聊天工作区并保留左右留白；空间不足时均随可用宽度收缩。布局作为本机全局偏好保存，切换助手、对话或设置页及重启均保留；不改变侧栏状态、窗口尺寸或生成状态。

## v0.1 scope

### Issue #63 lightweight attachments

2026-09-27 用户确认首批范围：CSV/TSV/JSON/XML/YAML/日志及常见代码、配置文本按 UTF-8 正文发送；DOCX/XLSX/PPTX 仅经 Responses 原文件内联发送，Office 本地仅展示信息。无本地 OCR、内容提取、格式转换、Office 正文预览或新增依赖；音视频留待后续。Office 只检查 ZIP 文件头，完整可解析性由上游判断，这取代远端 Issue 对全部损坏/伪造文件预先拒绝的宽泛要求。未知模型和中转站能力不臆断，失败不自动重试。远端 Issue 未修改。

### Issue #31 automatic conversation titles

按 2026-09-27 用户修订采用两步命名：首条消息提交后立即以原文命名（合并空白，最多 40 个 Unicode 码点；仅附件用文件名），后台使用同一模型概括后替换。失败保留原文标题，替代远端 Issue 的默认标题回退要求。每个对话只尝试一次；手动改名优先，后续消息及重试不反复命名。后台命名不阻塞主聊天与导航，不读取附件正文，不引入专用模型设置页。远端 Issue 未修改。

### Desktop UI #44–#47

按 2026-09-26 至 27 用户反馈实施：#44 统筹三页风格；#45 保留级联悬浮导航，外框圆角 8px、间隙 4px，用户消息继续跟随浅蓝默认或自定义强调色，消息操作常显图标；#46 小圆角分组卡片、独立标题及宽屏固定双消息预览；#47 供应商、连接渠道两级导航及右侧模型管理。设置框架采用小圆角卡片，两页统一外层边距与页面标题。字体层级和中文字体观感尚待用户共同精调，本次提交是阶段性基线，不代表最终视觉验收。用户后续要求停止截图验收，由其亲自反馈；远端 Issue 不在本轮修改或关闭。

### Issue #38 about and feedback

后续样式确认：将问题与建议合并为一个“反馈与建议”入口，使用紧凑列表替代双卡片，移除宣传文案和装饰图标；此要求替代 Issue 原先区分两个入口的验收。邮箱保留展示与复制。

按用户确认，设置中的“关于”页面承载应用信息及反馈，替代 Issue #38 原先的独立反馈页面。复用应用图标，版本读取 Tauri 配置，作者为 AyaseMinami；提供预填问题/建议的 GitHub 链接、可复制邮箱 ayasechikage@gmail.com、版本复制及项目主页。仅用户主动点击时打开链接或复制公开信息，不自动附带本地数据。许可证待确定后补充；当前邮箱入口仅支持复制，不启动邮件客户端。远端 Issue 未修改。

- Ordinary Tauri 2 desktop window using React, TypeScript, Vite, and Tailwind CSS.
- Plain-text multi-turn chat with streamed Markdown rendering.
- Assistant presets used as templates for new conversations, independent full conversation settings, multiple saved conversations, and safe deletion.
- User-configured base URL, API key, and model.
- Protocol-aware base URL normalization with the resolved request endpoint shown to the user.
- Four explicit protocol adapters:
  - OpenAI Chat Completions
  - OpenAI Responses
  - Gemini native GenerateContent
  - Anthropic native Messages
- Stop generation with `AbortController`.
- Local conversation persistence through a small repository interface backed by Dexie/IndexedDB.
- Message copying, editing while preserving history, user-message edit-and-send with confirmed history truncation, single-message deletion, explicit regeneration, and independent conversation branches.
- Clear terminal states for success, cancellation, HTTP failure, network failure, and malformed streams.
- Persistent semantic appearance customization with safe accent/canvas colors and validated local PNG, JPEG, or WebP backgrounds copied into app-private storage.
- Issue #5 local attachments: draft picker/drop/image paste, explicit send, private copies and references for sent messages without a post-send image cache, read-only previews, and protocol-specific official input limits instead of shared 10/20 MB caps.

## Explicitly out of scope

- Agents, arbitrary MCP servers/tools, RAG and knowledge bases. Issue #80 approves only a fixed Exa MCP external search step, without a general client tool runtime or model tool loop.
- Provider Files API uploads, audio/video attachments, local Office parsing/conversion, and unsent attachment persistence.
- Saved edit/regeneration versions and arrow navigation (separate Issue #17).
- Accounts, cloud sync, telemetry, auto-update, plugins, and marketplace features.
- Global shortcuts, tray behavior, frameless-window tricks, and multi-window behavior.
- Provider-managed conversation state. OpenAI Responses uses local history with `store: false`.
- Rendering raw HTML from model output. `rehype-raw` is prohibited.
- Conversation search, folders, and pinning.
- Unverified relay-specific reasoning extensions (including Chat `reasoning_content`).

## Module seams

Chat generation knows only the `ChatTransport` interface and neutral `ChatEvent` values. Each generation adapter owns endpoint construction, headers, request mapping, SSE decoding, unknown-event handling, and provider-specific errors. The separate, user-triggered model-directory action uses the neutral `ModelCatalogClient`; its protocol-specific GET routes, pagination, headers, and response mapping remain hidden from React.

Conversation storage sits behind `ChatRepository`; UI code does not call Dexie directly.

URL resolution sits in `src/chat/urlResolution.ts`, shared by settings preview, generation transports, and model discovery. The UI supplies the configured base URL; the resolver returns the normalized base URL and final endpoint. Adapters do not independently duplicate normalization rules.

## Configuration model

The connection configuration slice uses a three-level supplier, connection, and configured-model hierarchy:

```text
ProviderGroup
- id
- name
└─ ConnectionProfile[]

ConnectionProfile
- id
- name
- protocol
- baseUrl
- apiKey
└─ ConfiguredModel[]
   - id
   - modelId
   - displayName (optional)

Assistant
- defaultModelId
- defaultConfig
└─ Conversation[]
   - title
   - settings (independent modelId + config snapshot)
   - messages
```

- A supplier is only a UI grouping. It has no inherited Base URL, key, model, or runtime behavior.
- One supplier may hold any number of connections. Protocol is a dropdown property of a connection, and repeated connections using the same protocol are valid.
- Built-in OpenAI, Google Gemini, and Anthropic entries are read-only creation templates. Their created providers and connections use the same editable runtime model as custom providers.
- Selecting a connection in settings only changes the model list being browsed. Selecting a configured model makes its model ID, parent connection, protocol, Base URL, and key the atomic chat target.
- Each assistant's defaults and each conversation's independent model ID and generation settings are persisted and restored on startup. The settings page marks the selected assistant's default model; the chat selector uses the current conversation's model.
- Missing, deleted, or corrupt active-model references become an explicit unselected state. Deletion never silently switches to another connection or model.
- Each connection can fetch a protocol-aware remote model catalog on demand. Catalog entries are candidates only; users add them explicitly or add an arbitrary model ID manually.
- A user may explicitly test one configured model. The test is cancellable, reports latency/failure, may consume tokens, and is never retried automatically.
- Keys remain local and are never copied into conversations or tracked by Git. Keychain storage remains a later security upgrade.
- Migration deterministically preserves valid non-empty values from the legacy `ProviderProfiles` storage shape.

## Conversation roadmap

Issue #4 extends the original `current` state into assistant-owned conversations. Under the revised Issue #28 contract, assistants provide defaults for new conversations; each conversation owns a full configuration snapshot without copying credentials. Requests freeze the current conversation's settings. Issue #14 branches copy that configuration and can then be edited independently. Editing an assistant does not change existing conversations; restoring assistant defaults is an explicit draft action that takes effect on save. Search, folders, and pinning remain separate later decisions. Automatic titles follow the revised Issue #31 contract above.

## Delivery stages

1. **Transport tracer bullet**: one public streaming interface, deterministic tests, all four adapters, and Tauri HTTP wiring.
2. **Single-conversation UI**: settings, Markdown transcript, composer, streaming, stop, and visible errors.
3. **Persistence**: conversations/messages in Dexie with throttled writes and unfinished-message recovery.
4. **Acceptance**: packaged Tauri smoke tests against the configured relay, including cancellation and provider switching.

## Protocol-aware URL slice

Issue #13 implements protocol-aware URL resolution before expanding the feature set:

- Trim whitespace and redundant trailing slashes.
- For OpenAI Chat and Responses only, append `/v1` when the configured URL has no path.
- Preserve an existing `/v1` suffix and any non-root custom path.
- Do not change scheme, host, or port, and do not perform fallback network requests.
- Resolve Gemini and Anthropic automatically from a relay root by appending their complete versioned resource paths (`/v1beta/models/...` and `/v1/messages`); do not prepend an extra generic `/v1` to their normalized base.
- Show the exact final request endpoint below the Base URL field before sending.
- For Gemini without an explicitly selected model on that connection, show the normalized base and a clear prompt instead of a fictitious final endpoint.
- Cover root, trailing-slash, existing-version, custom-path, port, and invalid-URL cases with deterministic tests.

## Alpha release preparation

- Render ordinary Markdown single newlines as visible line breaks in messages and thinking summaries, preserving source text, code, mathematics and search citation offsets. Cover this behavior with regression tests; raw HTML remains inert.
- Freeze the corrected application identifier `io.github.ayaseminami.ayasestudio` before the first installer. Existing development profiles under the previous spelling require both Windows data directories to be migrated while the app is closed; see [the development guide](DEVELOPMENT.md#application-identity-and-existing-development-data).
- A production frontend build is not an installer acceptance result. Verify the packaged application, clean installation, upgrade and retained local data before publishing Alpha.

## Issue #3 generation configuration slice

按用户 2026-09-20 最新确认，助手是新对话模板，对话独立保存完整配置；编辑底部可恢复助手当前默认值，保存后生效。此前助手统一管理及稀疏覆盖方案被此规则取代。四协议请求映射、非流式、上下文预算与安全校验保持原合同。自动数值省略可选请求字段；Anthropic 必填 `max_tokens` 自动模式使用标明为 Ayase 回退的 4096。流式默认开启是 Ayase 产品推荐。未知模型的能力不从模型 ID 或目录身份信息猜测。自定义 JSON 按协议隔离，并在最终请求构造处安全校验。旧会话配置本地备份后退出运行配置，桌面交互与确定性测试共同组成验收证据。远端 Issue 尚未同步此调整。

## Acceptance gates

### Issue #15 Markdown and math (2026-09-19)

按用户本轮实施指令实现用户消息、助手正文与思考摘要的安全 Markdown/LaTeX 混排，支持美元及反斜线括号分隔符。用户消息同时开放安全 Markdown；代码中的公式保持原样。覆盖中文、列表、表格、矩阵、分式、上下标、多行公式、流式前缀、非法语法降级、货币/转义、搜索引用、安全边界及恢复后的原文复制和请求。浅深主题及窄窗口长公式滚动用浏览器检查。本轮允许全量确定性测试，不使用 computer use，不调用真实模型。

这取代远端 #15 创建时“仅记录待办，本次不修复”的时间性说明。2026-09-19 修正短公式因 KaTeX 上下标右侧 2px 溢出而出现多余滚动条的问题后，用户确认“目前效果完美”，验收通过，并授权提交、推送及将 #15 标记通过。仅完成本功能不代表其他 Alpha 验收项或真实线路均已通过。

### Issue #14 message operations (2026-09-19)

按用户确认，两类消息均提供复制 Markdown 原文、编辑、单条删除、重新请求和分支。Issue #37 将保存编辑改为保留后续历史且不请求、不清理附件；仅用户消息可“编辑并发送”。2026-09-27 用户进一步确认：编辑发送、重新请求均直接执行、不弹确认；最新一轮保留问答候选，旧轮操作仍移除后续记录。删除前仍明确确认。分支保留切点并复制可见历史为同助手下独立对话，使用 `(N)` 后缀，不显示来源、不请求网络；创建快照仅作记录。按 Issue #28 的本轮修订，分支复制完整对话配置，后续独立修改。附件清理按所有对话及保留候选的引用执行。

本轮将 [Issue #17](https://github.com/AyaseMinami/AyaseStudio/issues/17) 收窄为最新一轮问答版本：最新提问编辑发送或重新生成新增候选，箭头同时切换问答；下一轮消息提交并核验附件成功后丢弃其他候选，失败或停止的网络生成不恢复它们。仅保存编辑修改当前候选，不另存编辑历史；不做多轮版本树，无法恢复此前已丢弃内容。与 #50 一起实现输入和编辑快捷键。该范围替代远端 #17 的广义消息编辑历史要求，远端 Issue 未修改。

### Issue #16 protocol thinking extension (2026-09-19)

在 #10 Gemini 首版上扩展 OpenAI Chat 的强度、Responses 的强度与摘要，以及 Anthropic 的协议模式、预算、effort 与可读摘要。复用灯泡弹层、冻结请求和本地摘要存储；按 #28 的后续修订，配置由对话独立保存，新建时复制助手默认值。按用户 2026-09-19 修订，移除型号白名单；任意模型 ID 均可设置所选协议的思考选项，服务端负责参数兼容性判断。切换型号保留设置，不再拦截预算/输出或思考/采样组合。默认不请求摘要，显式已保存的摘要偏好继续保留；错误展示完整响应正文及 HTTP 状态并脱敏。Chat 官方接口不承诺可读摘要，未确认的中转扩展不启用。参数与多轮历史合同见 [PROTOCOLS.md](PROTOCOLS.md#issue-16-thinking-controls-and-readable-summaries)。

Issue 原文的未知模型默认限制、切换型号重置与供应商预算/采样兼容性前置拦截，以及“仅记录后续需求，本次不开始实现”，均被用户 2026-09-19 的实施与修订指令取代；未修改远端 Issue。真实线路验收需要单独授权，确定性测试与桌面启动不代表中转站兼容性通过。

### Issue #10 Gemini first slice (2026-09-16)

以下为 2026-09-16 首版历史记录，型号限制已由上述 #16 修订取代。本轮按用户要求将思考摘要展示纳入首版，仅实现 Gemini Native。输入区提供按明确型号能力变化的强度/预算菜单及独立的摘要开关，沿用当前助手共享配置（不同于原 Issue 的按对话保存）。Gemini 3 使用型号声明的档位，2.5 使用预算；未知型号省略思考参数。摘要独立于正文保存和折叠展示，不作为聊天历史回传。没有收到摘要时不显示空框，不推断模型思考用时。其他协议和中转站专属兼容规则留待后续；远端 Issue 未修改。

Issue #4 adds create/switch/rename/delete, assistant ordering/default configuration, restart selection recovery, idempotent legacy migration, and transactional safe deletion. Issue #28 makes each conversation's configuration independent. Issue #53 allows concurrent generation across conversations, with at most one task per conversation from preparation through terminal persistence. Request settings remain frozen and all deltas, errors, cancellation and saves remain bound to their original conversation. Other conversations remain editable and sendable; finishing or stopping one task does not unlock another. Browser interaction checks supplement deterministic tests; desktop acceptance is performed by the user.

- Streamed text is incremental and ordered.
- A request produces exactly one terminal outcome: completed, failed, or aborted.
- Deterministic tests cover HTTP 429, HTTP 500, network failure, malformed SSE, and cancellation; real providers are not required to manufacture failures.
- Unknown SSE event types are ignored without losing later standard events.
- URL normalization is deterministic and idempotent, and the endpoint shown in settings exactly matches the requested URL.
- Restart restores the last selected model and resolves its complete parent connection; corrupt stored selection becomes explicitly unselected.
- Model-provided single newlines remain visually distinct without enabling raw HTML.
- Secrets and local probe configuration are ignored by Git.
- Custom appearance survives restart, invalid or missing backgrounds fall back safely, and unreferenced private copies are cleaned without deleting source files.
- `npm test`, TypeScript build, Rust check, and production bundle build pass.

## Reference policy

Official provider documentation is authoritative. Relay behavior is verified by probes. Cherry Studio may be inspected only for a specific UX or compatibility question; its architecture is not imported and code is not copied without an explicit license review and source record.

## Issue #6 用户范围调整（2026-09-19）

本次在同一 Issue 实现四协议原生搜索、输入区开关、正文角标、底部来源/查询、Gemini 建议及历史保存，Anthropic 暂停提供手动继续。客户端工具搜索留后续 Issue。不引入模型白名单、前置能力探针或自动重试。用户确认功能验收通过：Gemini、Anthropic 实际搜索及展示通过；OpenAI 真实线路验证转入低优先级 [#18](https://github.com/AyaseMinami/AyaseStudio/issues/18)，不阻塞 #6。按用户要求仅做必要定向验证。详见 [实施记录](ISSUE-6-NATIVE-SEARCH-PLAN.md)。
