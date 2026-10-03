# #116 下拉框实施与逐项验收

2026-10-03，dev 本地工作树。用户确认舒适行距的短列表样板后授权全面实施，并要求每个下拉框完成后自行检查视觉效果。本记录不代表提交、推送或关闭远端 Issue。

## 实施范围

原基线 `git grep -n '<select' HEAD -- src` 有 30 处声明：聊天 8、设置 6、绘图 16。现有 src 生产代码的原生 `<select>` 为 **0**，没有保留项。数字参数声明会重复渲染；助手和对话的五个参数分别展开检查，没有用单个参数代替其他字段。

短列表统一 SelectField，保留至少 36px 行距、选中勾号和字重、活动项独立反馈及键盘焦点。绘图触发器与其同排输入／操作等高。菜单按内容适当加宽，并在视口内上下定位及滚动。长列表统一 SearchChoiceDialog：聊天模型沿用 ModelPicker，其他模型／复制连接／预设使用 SearchSelectField；完整标签与说明可搜索，分组适用于有明确分组的数据，长名称完整换行。

没有修改持久化格式、协议映射、请求行为或草稿保存边界。参数自动／自定义、模型切换后的协议能力、无效引用、异步保存失败及禁用状态沿用原业务；打开、搜索、导航和取消不提交选择。新增连接继续通过隐藏字段提交原 FormData 字段，取消后丢弃临时选择。

## 逐控件视觉记录

主代理使用 [隔离真实组件页面](../scripts/select116/README.md) 逐个点击展开，查看截图后继续下一项。默认浏览器视口 1280×720，窄窗口 390×844。浅深主题均覆盖；助手浅色宽屏／深色窄屏，对话深色宽屏／浅色窄屏，绘图参数浅色宽屏／深色窄屏分别检查。设置及统计也分别检查两种主题。所有数据为合成名称，未读取真实密钥或发起供应商请求。

下表每个字段均已展开查看。截图存于本地忽略目录 `scripts/select116/.local/visual/`，链接仅在本工作区有效，不随 Git 提交。早期助手／对话 fixture 漏载了生产 `AssistantConfig.css`，相关截图只能记录选择器交互，不能证明完整生产面板排版；本轮补齐局部样式和名称字段结构，重新检查能力区，以下续调记录取代早期能力区布局结论。其他场景不受该局部样式遗漏影响。

| 场景／字段 | 实现 | 已查看的截图 |
| --- | --- | --- |
| 助手默认模型／连接 | ModelSelectField → ModelPicker | [窄屏长名称](<../scripts/select116/.local/visual/075-默认模型 - 连接.jpg>) |
| 对话当前模型／连接 | ModelSelectField → ModelPicker | [搜索与当前选择](<../scripts/select116/.local/visual/084-当前对话模型 - 连接.jpg>) |
| 助手／对话联网搜索 | WebSearchControl → SelectField | [助手](../scripts/select116/.local/visual/capabilities-compact-assistant-search.jpg)、[对话](../scripts/select116/.local/visual/capabilities-compact-conversation-search.jpg) |
| 助手／对话思考强度 | ThinkingControl → SelectField | [助手](../scripts/select116/.local/visual/capabilities-compact-assistant-strength.jpg)、[对话](../scripts/select116/.local/visual/capabilities-compact-conversation-strength.jpg) |
| 助手／对话思考力度 | 同上 | [助手](../scripts/select116/.local/visual/capabilities-compact-assistant-effort.jpg)、[对话](../scripts/select116/.local/visual/capabilities-compact-conversation-effort.jpg) |
| 助手／对话 Temperature 自动／自定义 | SessionConfigPanel → SelectField | [助手](../scripts/select116/.local/visual/070-Temperature.jpg)、[对话](../scripts/select116/.local/visual/079-Temperature.jpg) |
| 助手／对话 Top-P 自动／自定义 | 同上 | [助手](../scripts/select116/.local/visual/071-Top-P.jpg)、[对话](../scripts/select116/.local/visual/080-Top-P.jpg) |
| 助手／对话 Top-K 自动／自定义 | 同上 | [助手](../scripts/select116/.local/visual/072-Top-K.jpg)、[对话](../scripts/select116/.local/visual/081-Top-K.jpg) |
| 助手／对话本地输入历史预算自动／自定义 | 同上 | [助手](<../scripts/select116/.local/visual/073-本地输入历史预算 (Token).jpg>)、[对话](<../scripts/select116/.local/visual/082-本地输入历史预算 (Token).jpg>) |
| 助手／对话最大输出自动／自定义 | 同上 | [助手](<../scripts/select116/.local/visual/074-最大输出 (Token).jpg>)、[对话](<../scripts/select116/.local/visual/083-最大输出 (Token).jpg>) |
| 输入栏思考弹层内的力度 | ThinkingToolbarControl → SelectField | [玻璃父容器内正确定位](../scripts/select116/.local/visual/057-思考力度（当前会话）.jpg) |
| 统计回复 | GenerationStats → SelectField | [回复列表](../scripts/select116/.local/visual/055-选择回复统计.jpg) |
| 统计请求 | 同上 | [请求与状态](../scripts/select116/.local/visual/056-选择生成请求.jpg) |
| 新增连接协议 | ConnectionCreateOptions → SelectField | [新增表单](../scripts/select116/.local/visual/061-协议类型.jpg)、[深色](../scripts/select116/.local/visual/063-协议类型.jpg) |
| 复制连接地址／密钥 | ConnectionCreateOptions → SearchSelectField | [完整名称／协议](../scripts/select116/.local/visual/062-复制地址和密钥（可选）.jpg)、[深色](../scripts/select116/.local/visual/064-复制地址和密钥（可选）.jpg) |
| 连接详情协议 | ConnectionSettings → SelectField | [详情](../scripts/select116/.local/visual/060-协议类型.jpg) |
| Tavily 搜索深度 | NetworkSearchSettings → SelectField | [深色](../scripts/select116/.local/visual/065-搜索深度.jpg)、[窄屏](../scripts/select116/.local/visual/085-搜索深度.jpg) |
| 智谱搜索引擎 | 同上 | [深色](../scripts/select116/.local/visual/066-搜索引擎.jpg)、[窄屏](../scripts/select116/.local/visual/086-搜索引擎.jpg) |
| 背景图片适配方式 | BackgroundDisplayControls → SelectField | [窄屏](../scripts/select116/.local/visual/087-图片适配方式.jpg) |
| 绘图模型 | DrawingWorkspace → SearchSelectField | [协议分组及完整名称](../scripts/select116/.local/visual/092-绘图模型.jpg) |
| 提示词预设 | DrawingPresets → SearchSelectField | [名称与说明](../scripts/select116/.local/visual/093-提示词预设.jpg) |
| OpenAI 尺寸 | DrawingWorkspace → SelectField | [浅色](../scripts/select116/.local/visual/040-尺寸.jpg)、[深色窄屏](../scripts/select116/.local/visual/094-尺寸.jpg) |
| OpenAI 画质 | 同上 | [浅色](../scripts/select116/.local/visual/041-画质.jpg)、[深色窄屏](../scripts/select116/.local/visual/095-画质.jpg) |
| Grok 版本契约 | 同上 | [浅色](<../scripts/select116/.local/visual/042-Grok 版本契约.jpg>)、[深色窄屏](<../scripts/select116/.local/visual/096-Grok 版本契约.jpg>) |
| Grok 宽高比 | 同上 | [浅色](<../scripts/select116/.local/visual/043-Grok 宽高比.jpg>)、[深色窄屏](<../scripts/select116/.local/visual/097-Grok 宽高比.jpg>) |
| Grok 分辨率 | 同上 | [浅色](<../scripts/select116/.local/visual/044-Grok 分辨率.jpg>)、[深色窄屏](<../scripts/select116/.local/visual/098-Grok 分辨率.jpg>) |
| Grok 画质 | 同上 | [legacy 禁用项](<../scripts/select116/.local/visual/045-Grok 画质.jpg>)、[深色窄屏](<../scripts/select116/.local/visual/099-Grok 画质.jpg>) |
| Seedream 版本契约 | 同上 | [版本列表](<../scripts/select116/.local/visual/049-Seedream 版本契约.jpg>)、[深色窄屏](<../scripts/select116/.local/visual/100-Seedream 版本契约.jpg>) |
| Seedream 尺寸 | 同上 | [4.5](<../scripts/select116/.local/visual/050-Seedream 尺寸.jpg>)、[5.0-pro](<../scripts/select116/.local/visual/053-Seedream 尺寸.jpg>)、[深色窄屏](<../scripts/select116/.local/visual/101-Seedream 尺寸.jpg>) |
| Seedream 输出格式 | 同上 | [4.5 禁用项](<../scripts/select116/.local/visual/051-Seedream 输出格式.jpg>)、[5.0-pro 可用项](<../scripts/select116/.local/visual/054-Seedream 输出格式.jpg>)、[深色窄屏](<../scripts/select116/.local/visual/102-Seedream 输出格式.jpg>) |
| Seedream 水印 | 同上 | [浅色](<../scripts/select116/.local/visual/052-Seedream 水印.jpg>)、[深色窄屏](<../scripts/select116/.local/visual/103-Seedream 水印.jpg>) |
| Gemini 宽高比 | 同上 | [浅色](../scripts/select116/.local/visual/038-宽高比.jpg)、[深色窄屏](../scripts/select116/.local/visual/088-宽高比.jpg) |
| Gemini 分辨率 | 同上 | [浅色](../scripts/select116/.local/visual/039-分辨率.jpg)、[深色窄屏](../scripts/select116/.local/visual/089-分辨率.jpg) |
| Gemini 安全阈值 | 同上 | [英文标签修正后](<../scripts/select116/.local/visual/036-Gemini 安全阈值.jpg>)、[深色窄屏](<../scripts/select116/.local/visual/090-Gemini 安全阈值.jpg>) |
| Gemini 输出模式 | 同上 | [浅色](<../scripts/select116/.local/visual/037-Gemini 输出模式.jpg>)、[深色窄屏](<../scripts/select116/.local/visual/091-Gemini 输出模式.jpg>) |
| 原生 HTML dialog 内短／长选择器 | 隔离组合验证，共享组件 | [短列表](../scripts/select116/.local/visual/058-对话框短列表.jpg)、[长列表](../scripts/select116/.local/visual/059-对话框长列表.jpg) |

补查 OpenAI Chat、Responses、Gemini、Anthropic 的思考选项，以及 Grok 2.0、Seedream 5.0-pro 动态参数。Grok 2.0 的宽高比／分辨率／画质截图为 046–048。共享背景适配组件在独立卡片检查；图库及取景的草稿隔离通过对应组件测试，未把图库所有操作流程记为视觉通过。

检查后修复三处问题：玻璃输入栏使固定思考子菜单定位偏移，改 body portal 并保留父菜单点击所有权；中文组合输入的 Escape／方向键误交给父层，增加组合输入隔离；安全阈值英文标签断词，按自然宽度加宽并预留勾号及滚动条。修正后重新展开相关控件查看。

## 联网／思考排版续调

交付前同步协议名称：Anthropic 使用“思考模式”与“思考力度”，Gemini／OpenAI 保留“思考强度”。可见名称、可访问标签和输入栏浮层标题同步，配置值及请求映射不变。补看 [助手交付版](../scripts/select116/.local/visual/capabilities-final-assistant.jpg) 和 [对话交付版](../scripts/select116/.local/visual/capabilities-final-conversation.jpg) 的模式菜单及收起排版；全量 2775 项测试、16 项数据契约检查、构建及 locked Rust 检查再次通过，独立收尾复核无明确缺陷。

最终对齐修正：思考力度和预算标签预留图标位，与思考强度文字起点一致；预算输入、已应用值及显示勾选沿下拉框左侧对齐。两页共用同一局部样式；见 [对话对齐版](../scripts/select116/.local/visual/capabilities-aligned-conversation.jpg)、[助手对齐版](../scripts/select116/.local/visual/capabilities-aligned-assistant.jpg)、[预算对齐](../scripts/select116/.local/visual/capabilities-aligned-budget.jpg)、[窄屏对齐](../scripts/select116/.local/visual/capabilities-aligned-narrow.jpg)。以下截图保留之前试调过程。

第一版试调将助手和对话配置的能力区改为单列表单；用户随后指出控件过长、希望保留原先并排关系，该版被否定，以下旧截图仅保留试调过程。

当前版恢复联网和思考左右两列，标签与选择器在各列横排，下拉框最大 15rem，思考力度及勾选在思考列内对齐。620px 以下纵排，仍保留短下拉与短预算输入。助手／对话两页分别展开联网、强度和力度查看，另检查预算、主题和窄屏；见 [助手当前版](../scripts/select116/.local/visual/capabilities-compact-assistant-light.jpg)、[对话当前版](../scripts/select116/.local/visual/capabilities-compact-conversation-light.jpg)、[对话预算](../scripts/select116/.local/visual/capabilities-compact-conversation-budget.jpg)、[390px 对话](../scripts/select116/.local/visual/capabilities-compact-conversation-narrow.jpg)。输入栏思考浮层的力度标签完整一行修复保留。没有改变配置值、协议映射或保存语义。

逐项展开联网、思考强度和力度检查，查看 [助手浅色](../scripts/select116/.local/visual/capabilities-assistant-light.jpg)、[助手深色](../scripts/select116/.local/visual/capabilities-assistant-dark.jpg)、[390px 助手](../scripts/select116/.local/visual/capabilities-assistant-narrow.jpg)、[对话预算宽屏](../scripts/select116/.local/visual/capabilities-conversation-light-budget.jpg)、[对话预算窄屏](../scripts/select116/.local/visual/capabilities-conversation-narrow-budget.jpg)。预算改为 2048 并显式应用后确认已应用值更新。另看 Gemini、OpenAI Chat 的选项及协议说明；复查 [输入栏思考力度菜单](../scripts/select116/.local/visual/capabilities-toolbar-effort.jpg)、[思考浮层](../scripts/select116/.local/visual/capabilities-toolbar.jpg) 和 [窄屏浮层](../scripts/select116/.local/visual/capabilities-toolbar-narrow.jpg)。

首版续调后 `npm.cmd run check` 通过：16 项数据契约测试、163 文件／2775 项测试、TypeScript 与生产构建。恢复并排的后续修改仅涉及 CSS，隔离页面构建及 `git diff --check` 通过；补查 [助手深色](../scripts/select116/.local/visual/capabilities-compact-assistant-dark.jpg)、[对话深色](../scripts/select116/.local/visual/capabilities-compact-conversation-dark.jpg) 和 [390px 助手](../scripts/select116/.local/visual/capabilities-compact-assistant-narrow.jpg)。Rust 检查沿用首轮通过记录。原生交互仍待手工体验。

## 交互、验证及边界

- 浏览器实测短列表方向键／End 只移动活动项，Enter 才更新；禁用入口不能展开。长列表搜索／方向键不改变当前模型，Escape 后值不变并回焦入口；显式点击切换绘图模型后展示对应协议参数。
- 浏览器检查短列表上下展开、滚动、选中／活动区别、主题、长文字、窄屏边界和原生 dialog 子层；子层 Escape 后原生 dialog 保持打开，焦点返回长列表入口。浏览器无 console error。
- `npm.cmd run check` 通过：数据契约检查 16 项，应用测试 163 文件／2775 项，类型检查及生产构建通过。最后测试断言改为查询 body portal 后另跑 SelectField 2 项通过。构建保留已有大 chunk 提示。
- `cargo check --locked --manifest-path src-tauri/Cargo.toml` 通过；`git diff --check` 通过。隔离 fixture 自身类型检查和构建通过。
- 独立 comprehensive_reviewer 复核共享选择层及后续宽度修正，确定问题已修复，未留下明确 P1/P2。审查不代替上述视觉检查。
- 浏览器不支持发送触控事件，未把鼠标点击或窄屏截图称为真实触屏验收。真实触屏、Windows 高对比主题及 Tauri 原生交互仍待设备体验；本轮没有 native 改动，没有为 UI 验收启动或操作真实供应商。

本地实施和浏览器逐项检查完成。用户最终主观体验、真实设备验收和远端 Issue 关闭分别处理。
