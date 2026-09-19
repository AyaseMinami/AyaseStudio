# Issue #6：协议原生联网搜索

日期：2026-09-19。用户确认按本次调整后的范围验收通过，并授权提交、推送及关闭 #6；OpenAI 真实线路兼容性转入低优先级 [#18](https://github.com/AyaseMinami/AyaseStudio/issues/18)。

## 范围与本次调整

一个 #6 内实现四协议搜索开关、正文引用角标、底部来源/搜索词、Gemini 搜索建议、保存恢复及 Anthropic 手动续接。工具搜索另留后续 Issue；本次没有客户端工具执行器、MCP 或网页抓取。

按用户最新要求简化先前草案：不引入模型白名单、能力探针、证据缓存、凭据修订或未知模型发送拦截。开启即按当前协议发送原生参数，支持情况由供应商回答；不自动改模型、降级或重试。关闭表示不声明新搜索，搜索专用模型本身可能始终联网，按钮提示说明此限制。

## 请求与展示

| 协议 | 开启时新增字段 |
| --- | --- |
| OpenAI Responses | `tools:[{type:"web_search"}]`、`tool_choice:"auto"`、`include:["web_search_call.action.sources"]`；保持 `store:false` |
| OpenAI Chat | `web_search_options:{}` |
| Gemini GenerateContent | `tools:[{googleSearch:{}}]` |
| Anthropic Messages | `tools:[{type:"web_search_20250305",name:"web_search"}]` |

地球按钮沿用助手共享配置，旧配置默认关闭，发送时冻结。开启只表示允许搜索；状态和来源由结构化响应产生，不从正文里的普通链接或“我已搜索”推断。

协议适配器把 URL、标题、查询和引用归一化到 `SearchRecord`，原始正文保持不变。来源按 URL 去重，编号在单条消息内复用。底部“来源”数量是返回的网页数，不冒充搜索次数或正文引用次数。正文角标由 SafeMarkdown AST 的可见边界渲染，不插入 HTML，也不改复制的 Markdown 原文。无法定位的引用仍保留来源。

Responses 处理 annotation 与最终 output（含 incomplete），局部引用转为整条消息位置。Chat 读取运行时 annotations，SDK 没有声明此 delta 字段不构成前置拦截理由；线路不返回元数据时无法生成角标。关闭时若模型仍返回结构化搜索证据，也正常展示。

Gemini 只用候选 0，排除 thought 文本，非流式按 Part 的 UTF-8 字节坐标转换为 UTF-16。流式 chunk 的局部 parts 下标不是稳定的全局 Part ID，优先用 segment.text 在累积回答中的唯一精确匹配定位；缺少文本时，仅单个非 thought 文本 Part 的流可用字节坐标。无法可靠定位时保留来源，不编造角标。Anthropic 网页引用属于文本块，等 block_stop 后定位于最终块末尾；不拿来源摘录 cited_text 搜索回答位置。

## 会话与继续生成

展示数据通过现有 repository/SessionStore 保存，不新增数据库表。重新请求得到新数据；分支复制；编辑正文清除对应引用及 replay。删除历史会使暂停续接失效，避免隐藏的旧请求继续使用已删内容。

Anthropic 原始 content blocks 与展示引用分离保存，包括工具结果、加密内容、thinking 和签名。相同连接作用域内由适配器回传；跨协议/连接仅使用普通正文。上下文预算计入原始块。

`pause_turn` 显示“继续生成”，每次点击发送一次请求，不自动循环。冻结首次请求的配置与输入历史，完整保存每次响应的独立 content 数组。UI 可拼为一个回答，协议回传仍逐个展开。切换连接或模型后需切回原组合再继续。快照不保存 API Key，发送时使用当前连接凭据。

## Gemini 建议与外链

建议使用独立 scriptless iframe，`sandbox="allow-same-origin"`，不授予 scripts/popups/forms/top-navigation。允许同源是为了可信父组件绑定链接事件和调整高度；供应商文档不能执行脚本。srcDoc 独立 CSP，加上移除脚本、自动跳转、嵌套框架和表单；HTML/CSS 不进入主 DOM。此实现取代草案里的复杂原生子 WebView。

来源、正文与建议链接经过统一 HTTP(S) URL 入口，桌面通过只允许 HTTP(S) 的 Tauri opener 在系统浏览器打开。没有文件打开授权，也不自动抓取第三方 favicon。

当前工程实现将建议 HTML 和引用随本机聊天保存；没有自动过期删除。Google 关于 Grounded Results、建议共同展示和长期存储的条款适用仍需产品发布时核实；实现及 Cherry 的相似行为都不是许可证明。没有以此增加用户发送拦截，也不声称条款问题已经解决。[Gemini API 条款](https://ai.google.dev/gemini-api/terms#grounding-with-google-search)

## 验证边界

遵循用户要求，只运行新功能相关定向测试、TypeScript/Vite 构建、Rust 编译及差异检查，不运行全量测试。重点是协议真实形状、中文引用位置、搜索错误、原始块回传、手动续接和安全显示。桌面启动与实际交互验证分别记录，不能相互替代。

初始实现仅使用合成响应，后续用户授权了 Gemini 真实诊断，并提供 Gemini 与 Anthropic 桌面成功截图。官方合同不证明特定中转支持，尤其 Chat 流式 annotations。用户确认将此前五个子 Issue 合并实施，取消前置能力探测、缓存与型号白名单。

本次定向解析/UI/会话测试、前端构建和 Rust 编译通过。浏览器合成样本验证了引用角标、来源区、scriptless 建议和宿主链接处理。Tauri 开发启动先遇到已有 1420 端口，复用该服务后仍因现有进程锁定 ayase-studio.exe 无法替换；保留现有进程，未把新权限下的桌面外链交互标为通过。

## Gemini 真实线路诊断补充

用户提供 Cherry Studio 1.9.13 成功请求后，对比发现其工具字段是 `googleSearch`。临时 Key 的流式与非流式 `google_search` 请求都返回 HTTP 200，但没有 grounding 元数据。保持同 Key、地址、模型、问题和其余请求体不变，只改为 `googleSearch` 的一次流式请求返回 3 条搜索词、9 个来源、8 处引用与 searchEntryPoint；现有适配器成功解析。这为该线路的字段兼容问题提供直接证据，不能推广为 Google 官方停用下划线字段。

修正统一使用 `googleSearch`，无需附加 Cherry 的思考或安全配置，不增加重试。脱敏原始结果留在被 Git 忽略的本地诊断文件中；新格式发送边界由定向测试验证。

## 最终验收（2026-09-19）

- Gemini：授权探针和用户桌面截图验证实际搜索、来源、正文角标和 Google 建议展示。
- Anthropic：用户在 Ayase Studio 使用向量引擎 `claude-opus-5`，截图显示“已联网搜索 · 10 个来源”、搜索查询和正文角标，用户确认通过。
- OpenAI：请求映射与合成协议测试通过；未取得真实线路成功搜索证据，原因未定，转入 [#18](https://github.com/AyaseMinami/AyaseStudio/issues/18)，不阻塞本次验收。
- 最终定向回归：3 个测试文件、20 项测试通过；TypeScript/Vite 构建、`cargo check` 通过。不运行全量测试或新增真实调用。
- 用户确认的是本次功能范围；不把截图外的桌面外链、重启恢复、Anthropic 暂停续接交互或 Google 长期存储条款标记为完成实测/发布审核。此前独立代码审查及确定性验证仍为相应实现的验证依据。

## 协议依据

- [OpenAI 搜索](https://developers.openai.com/api/docs/guides/tools-web-search)与[Responses 流式事件](https://developers.openai.com/api/reference/resources/responses/streaming-events)。
- [Gemini GenerateContent 搜索](https://ai.google.dev/gemini-api/docs/generate-content/google-search)与[GroundingMetadata/Segment](https://ai.google.dev/api/generate-content#GroundingMetadata)。
- [Anthropic Web Search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)、[引用](https://platform.claude.com/docs/en/build-with-claude/citations#streaming-support)与[服务端工具](https://platform.claude.com/docs/en/agents-and-tools/tool-use/server-tools#the-server-side-loop-and-pause_turn)。

## 补充：Cherry Studio 1.x 的 Gemini 实现参考

用户提醒 2.x 可能已调整内置搜索后，本次定向检查旧版 **v1.9.13**，固定 revision `da22fb797343fd3760e5dd2d467eda9bf0017632`。本结论不评价 2.x 是否支持，也不声称该版本就是截图版本。检查方式为 GitHub 源码静态阅读，未安装或运行 Cherry。

| 环节 | 旧版实际实现 | 对 Ayase 的意义 |
| --- | --- | --- |
| 元数据接入 | AI SDK 的 finish-step 携带 Google groundingMetadata 时，转为原生搜索完成消息，完整 metadata 放入结果。 | 证明底部来源和建议来自协议元数据；无需另建客户端搜索工具。 |
| 引用列表 | groundingChunks 映射 URL/标题，以数组位置加一编号，并附带 groundingSupports。 | 可参考统一来源记录与引用关系；Ayase 仍需处理去重和多 Part 坐标。 |
| 正文角标 | 将 UTF-8 字节偏移转成 JS 字符位置，逆序插入引用标记，再生成带 sup 的 Markdown/HTML 标签；跳过部分代码区域。 | 字节转换与逆序避免偏移的思路有依据；Ayase 保持 AST/React 装饰，不复制字符串 HTML 注入路径。 |
| Google 搜索建议 | CitationBlock 从 searchEntryPoint.renderedContent 取 HTML，经主题/背景/边框替换后用 dangerouslySetInnerHTML 渲染到 div；窄屏规则还会隐藏该区。 | 这条组件路径不是隔离 iframe/WebView，也没有在该组件内做 HTML 清洗。不能用它证明安全隔离和展示许可已解决。 |
| 历史保存 | 原生搜索结果存入 CitationMessageBlock.response，BlockManager 触发块保存，普通对话的 Dexie 数据源整体 bulkPut 消息块；加载时恢复块。 | 代码路径表明 metadata（包括返回时存在的建议 HTML）进入本地消息持久化，不仅是当次临时展示。未做实际重启测试。 |

固定 revision 的证据入口：

- [元数据接入：AiSdkToChunkAdapter.ts](https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/src/renderer/src/aiCore/chunk/AiSdkToChunkAdapter.ts#L321-L331)
- [来源归一化：messageBlock.ts](https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/src/renderer/src/store/messageBlock.ts#L116-L134)
- [角标：citation.ts](https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/src/renderer/src/utils/citation.ts)
- [搜索建议展示：CitationBlock.tsx](https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/src/renderer/src/pages/home/Messages/Blocks/CitationBlock.tsx)
- [引用块写入：citationCallbacks.ts](https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/src/renderer/src/services/messageStreaming/callbacks/citationCallbacks.ts)
- [持久化入口：BlockManager.ts](https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/src/renderer/src/services/messageStreaming/BlockManager.ts#L93-L101)、[保存整块：DexieMessageDataSource.ts](https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/src/renderer/src/services/db/DexieMessageDataSource.ts#L144-L154)

借鉴结论：采用“正文 + 结构化引用 + 底部来源 + Google 建议独立区域”的交互和数据分工。技术上历史恢复已有实现参考；仍保留 Ayase 的 HTML 安全边界，并将 Google 展示/存储适用条款作为待核实事项，不能把 Cherry 的实现当作供应商授权证明。无需把这次参考调查扩大成 Cherry 架构迁移或引入其工具系统。

源码许可记录：该 revision 的 [LICENSE](https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/LICENSE) 为 AGPL-3.0；本次仅记录行为与来源，不复制实现、样式或资产进入 Ayase。
