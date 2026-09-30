# Issue #80：应用层联网搜索研究记录

日期：2026-09-30。范围：核对 Exa 托管 MCP、Cherry Studio 搜索实现及 DeepSeek 的协议差异，为首期设计提供事实依据；本记录不实现搜索功能。

后续本地实现与验证见 [实现记录](ISSUE-80-IMPLEMENTATION.md)；本记录保留调查时的证据和验证边界。

本次只读取官方文档、公开源码及测试。未调用 Exa MCP 端点、发送实际搜索词、读取凭据或请求模型。下文的“源码行为”不等于托管部署已经通过集成验收。

## 已确认结论

- Exa 官方提供 `https://mcp.exa.ai/mcp`，声明支持受限的匿名访问；OAuth 或 API Key 可提高限额。默认工具为 `web_search_exa`、`web_fetch_exa`。[Exa README][exa-readme]
- 可以将 Exa MCP 封装成应用内部的固定搜索适配器。使用 MCP 传输不要求向用户开放通用 MCP、模型任意调用工具或 Agent；这是本项目的设计边界，详见 [Issue #80 设计](ISSUE-80-EXA-SEARCH-PLAN.md)。
- 两项默认工具返回格式化文本；可选 `web_search_advanced_exa` 则在 MCP 文本块中返回 JSON 编码的归一化响应，仍非 `structuredContent`。首期选择后者以保留字段边界。[搜索源码][exa-search]、[抓取源码][exa-fetch]、[高级搜索源码][exa-advanced]
- Cherry 旧版“本地搜索”依赖隐藏 Electron 页面抓取；当前实现是模型可反复调用的搜索工具。两者都不能直接作为 Ayase 固定搜索流程的完整实现蓝本。[旧主进程服务][cherry-old-service]、[当前搜索工具][cherry-tool]
- DeepSeek 的原生联网能力需区分 API：Responses 文档注明忽略 `web_search`，Claude Code 接入文档则注明 DeepSeek API 支持其 Web Search。不能推导为“DeepSeek 所有接口都不支持搜索”。[Responses][deepseek-responses]、[Claude Code][deepseek-claude]

## 取证版本

| 来源 | 本次固定版本 | 用途 |
| --- | --- | --- |
| Exa MCP 官方仓库 | `f3d71fb6b0ff4b4683f108f05bc2bae61a9f7e97`；包版本 `3.4.1` | 固定工具、HTTP 入口、测试与依赖证据 |
| Cherry Studio `v1.9.13` | `da22fb797343fd3760e5dd2d467eda9bf0017632` | 核对旧版本地搜索 |
| Cherry Studio 当前源码快照 | `c45058a31307231024d514f20bd5eca88fea2bfb` | 核对 provider registry、模型工具、引用 ID |
| MCP 规范 | `2025-11-25` 版本页面 | 描述客户端应遵守的协议契约，非 Exa 线上版本证明 |

Exa 的 [package.json][exa-package] 声明 MCP SDK `^1.12.1`、`mcp-handler` `^1.0.4`；[锁文件][exa-lock] 实际解析为 `1.26.0`、`1.1.0`。这些是仓库依赖版本，不能代替线上 `initialize` 返回的协议版本。

## Exa 托管服务与匿名访问

[README][exa-readme] 把端点列为 Streamable HTTP。`?tools=...` 会替换默认工具集合；首期设计固定选择 `?tools=web_search_advanced_exa`，不调用默认搜索或另发抓取请求。`agent_run` 不属于首期范围。

高级搜索在 [注册表][exa-registry] 中默认关闭，但没有 `requiresUserProvidedApiKey` 标记；[初始化代码][exa-handler] 允许显式选择该工具。[静态模拟测试][exa-handler-test] 明确验证 `userProvidedApiKey: false` 时仍注册高级搜索，而需 Key 的 `deep_search_exa` 不注册。[HTTP 入口][exa-http] 的工具认证门槛检查同一标记。因此公开源码支持匿名选择高级工具；**线上是否一致仍未验证**，不能把模拟注册测试当成真实调用成功。

匿名访问不是无限量或永久免费承诺。[HTTP 入口源码][exa-http] 对匿名 `tools/call` 执行限流，额度受部署环境变量控制；本记录不把代码默认值写成官方线上配额。限流可返回 HTTP 429、`Retry-After` 和 JSON-RPC 错误。

官方同时记录了 API Key 的 URL 参数、Bearer 和 `x-api-key` 方式，以及显式 OAuth 登录端点。匿名模式不应自行升级认证或静默切换服务；用户配置 Key 时优先头部传递，并独立于模型连接凭据管理。[README][exa-readme]；后一句为本项目建议。

公开 [HTTP 入口][exa-http] 也存在按 User-Agent、插件标记或显式登录参数要求认证的分支。因此匿名访问应使用常规端点，不冒充受信客户端、不绕过限流；未来部署要求认证时应展示服务不可用或需要配置。

## 工具输入与输出：以固定源码为准

| 工具 | 输入参数 | 当前源码输出 |
| --- | --- | --- |
| `web_search_exa` | 必填 `query`；可选 `numResults`，默认 10 | `content` 中的 `text` 块；逐条包含标题、URL、发布日期、作者，以及 highlights 或 text |
| `web_fetch_exa` | `urls: string[]`；可选 `maxCharacters`，默认每页 3000 字符 | `content` 文本块；页面标题、URL、可选日期/作者与正文；逐 URL 错误可混在文本中 |
| `web_search_advanced_exa` | 必填 `query`；可选 `numResults`、`textMaxCharacters` 及高级选项 | `content` 文本块内的 `JSON.stringify(sanitized)`；非空结果保留独立 `results` 对象数组及字段 |

上述参数来自 [搜索工具][exa-search]、[抓取工具][exa-fetch]、[高级搜索工具][exa-advanced] 和 [默认配置][exa-config]。SDK 内部向 Exa REST 发出的 `/search`、`/contents` 请求不是 Ayase 需要自行调用的匿名端点。

### 搜索结果

- 搜索源码请求 highlights；无 highlights 时才使用结果 text。不能承诺每条搜索结果已含完整网页正文。[搜索源码][exa-search]
- 当前结果使用 `Title:`、`URL:` 等字段和段落分隔符；没有声明 `outputSchema`，也没有返回 `structuredContent`。`_meta.searchTime` 属于可选诊断数据，不能当作结果 ID。[搜索源码][exa-search]
- 无结果返回普通文本，未标记 `isError: true`；“无结果”和工具错误必须分开归一化。[搜索源码][exa-search]、[模拟测试][exa-search-test]
- 普通搜索格式把来源头与网页 highlights 放在同一字符串中，没有对 highlights 中的分隔符、`Title:` 或 `URL:` 转义。即使语法解析成功，也无法可靠判断模拟来源头究竟来自哪一条网页正文；首期不将这种文本解析成来源卡片，也不作为高级工具失败后的回退。[搜索源码][exa-search]；风险判断为静态推论。

### 首期选择：高级搜索的 JSON 文本

[高级工具][exa-advanced] 把 [清理后的响应][exa-sanitizer] `JSON.stringify` 为文本；结果的 `title`、`url`、`text`、日期等字段与正文字符串的边界由 JSON 编码保留。它未声明 `outputSchema`、未返回 `structuredContent`；客户端仍需解析 JSON 并验证对象、字段类型和 URL，而非直接信任内容。

首期只发送 `query`、受本地范围限制的 `numResults` 和 `textMaxCharacters: 1500`，不启用日期/域过滤、summary、highlights 或 subpages，也不增加这些 UI。这是本项目选型；工具描述推荐普通工具用于简单搜索，但其文本输出不能满足此处可追溯来源的解析需要。

`textMaxCharacters` 映射为每结果正文提取上限，不是整个响应大小上限；还须限制响应字节、采用结果数和最终上下文长度。[高级源码][exa-advanced]。源码未收到 response 时返回非 JSON 的无结果文本；[清理函数][exa-sanitizer] 还会省略空结果数组，因而 JSON 对象不总含 `results: []`。实现前应核定空结果契约；缺字段不得凭猜测当作可信来源，未知格式明确失败且不回退到普通文本解析。本次没有找到高级工具独立的输出单元测试；已读注册测试证明匿名注册分支，清理行为依据源码，线上输出仍待验收。

### 正文抓取与错误

- 默认 3000 字符是每页的提取上限，不能把工具描述的“full content”理解为不截断的全文保证。[抓取源码][exa-fetch]、[配置][exa-config]
- 全部 URL 抓取失败时当前源码返回 `isError: true`；部分成功时返回正文并附逐 URL 错误文本。成功调用不保证所有页面成功。[抓取源码][exa-fetch]、[模拟测试][exa-fetch-test]
- HTTP 错误、JSON-RPC `error`、工具 `isError`、空结果和未知文本格式是不同层次，需要分别处理。[HTTP 入口][exa-http]、[工具错误处理][exa-errors]
- Exa 自己的工具实现包含上游暂时错误重试；Ayase 的“不自动重试”只能约束自身请求，不能承诺 Exa 内部永远只有一次 REST 请求。[错误处理源码][exa-errors]

## 轻量客户端仍需要的 MCP 契约

以下来自 [生命周期规范][mcp-lifecycle] 和 [Streamable HTTP 规范][mcp-transport]；不是线上探针结果。

1. 先 `initialize`，核对返回版本和工具能力，再发送 `notifications/initialized`；只接受客户端明确支持的协商版本。
2. 后续请求带协商后的 `MCP-Protocol-Version`；服务端若返回 `Mcp-Session-Id`，后续请求必须携带该 ID。
3. HTTP POST 的 `Accept` 包含 `application/json` 与 `text/event-stream`；响应既可能是 JSON，也可能是 SSE，不能只实现 JSON happy path。
4. 匹配 JSON-RPC 请求 ID 与终态；通知的成功响应可以是 202 空体。客户端要有超时和响应大小上限。
5. 用户取消或超时后停止本地消费，并按协议尽力发送取消通知；网络断开不等于服务端取消已经生效。
6. 会话过期应重新初始化；是否重新发出搜索由应用策略约束，不能因此自动重放已经发出的 `tools/call`。

Exa [HTTP 入口源码][exa-http] 在成功初始化时回传或生成 Session ID，允许相应 CORS 请求头并暴露 Session ID。它使用 `mcp-handler` 管理传输，未提供可直接当作线上承诺的固定 `protocolVersion`。

实现建议：先评估官方 SDK 的浏览器构建及体积，封装在单个 Exa 适配器内；若选择自写客户端，上述协议处理同样不能省略。工具列表只用于确认白名单工具及 schema，不把服务端任意工具、prompts、sampling 或文件访问能力开放给模型。此项为架构建议，不是本次依赖选型或实现结果。

## Cherry Studio 对照与退役原因边界

旧版 [LocalSearchProvider][cherry-old-provider] 通过 IPC 打开 URL、读取 HTML、解析结果，结束时关闭搜索窗口。[LocalGoogleProvider][cherry-old-google] 依赖搜索结果 DOM 选择器；[SearchService][cherry-old-service] 建立默认隐藏的 Electron `BrowserWindow`，加载网页后读取 `document.documentElement.outerHTML`。这是依赖浏览器页面的抓取，不是 Google 官方搜索 API。

[PR #14443][cherry-pr] 删除 local Google/Bing/Baidu 的 UI 和 provider 工厂入口，其公开理由是后端已经不支持这些 provider。PR 没有给出 Google 警告导致退役的证据，也没有解释后端最初为何停用；该动机保持未知，不能当成已确认的封禁或合规事件。

当前 [provider registry][cherry-registry] 包含 Exa API、Exa MCP、Tavily、SearxNG 等服务，未列旧 local Google/Bing/Baidu。当前 [WebSearchTool][cherry-tool] 让模型决定查询且可多次调用，[webLookup][cherry-lookup] 负责 provider 解析、结果映射和错误输出；[引用工具][cherry-citations] 按每次检索生成带随机前缀的来源 ID，模型回显 ID 后由界面匹配。

可借鉴概念：服务商适配、来源归一化、引用 ID 与展示分离。Ayase 首期仍按用户确认只接 Exa、使用固定搜索流程；不移植 Cherry 的 Agent 工具循环、运行时或其提示词。[Cherry 许可证][cherry-license] 为 AGPL-3.0；本次仅观察行为并记录来源，没有复制代码、提示词或资产。[Exa 许可证][exa-license] 为 MIT；使用依赖或代码时仍需记录实际采用版本和许可声明。

## DeepSeek：协议差异不能合并推断

[Responses 文档][deepseek-responses] 列出 `function` 支持，但 `web_search` 等内置工具会被忽略；返回旧 `web_search_call` 历史项到 input 可被拼回上下文，也不代表当前请求执行新搜索。

[官方 Claude Code 接入指南][deepseek-claude] 使用 DeepSeek Anthropic 兼容地址，并明确说明支持 Claude Code 的 Web Search，相关内容总结可能产生额外模型请求费用。本次没有验证 Ayase 的 Anthropic 搜索映射与该服务的实际兼容性。

所以首期应用层搜索的意义是独立检索后把可追溯资料交给当前模型，不以“某供应商完全缺乏原生搜索”为产品前提；原生能力与应用层检索如何选择由设计文档明确。

## 尚未验证及后续验收

- 托管端点当前实际 `initialize` 版本、高级工具匿名可用性、schema、JSON 文本及空结果与固定源码的差异。
- 匿名线上配额、共享出口 IP 的额度竞争、稳定性及持续可用性；源码默认配置不构成服务保证。
- 开发浏览器与打包 Tauri WebView 的实际 CORS、网络代理、超时、SSE 和 Session ID 行为。
- 中文查询效果、引用解析鲁棒性、部分失败可见性、取消后迟到响应隔离、抓取预算。
- 原生搜索与应用层搜索的选择、失败后是否继续回答、资料如何持久化：由本项目设计决定，不能从第三方实现推导。

上述集成检查应在实现阶段按授权使用最少量无敏感信息请求执行；异常场景通过确定性 mock 验证，不制造真实限流或重复搜索。搜索词和 URL 会发送给 Exa，纳入模型上下文的资料会发送给所选模型服务；检索网页视为不可信资料，不作为修改系统指令的权限来源。此段为本项目验收与数据边界要求。

## 来源

[exa-readme]: https://github.com/exa-labs/exa-mcp-server/blob/f3d71fb6b0ff4b4683f108f05bc2bae61a9f7e97/README.md
[exa-package]: https://github.com/exa-labs/exa-mcp-server/blob/f3d71fb6b0ff4b4683f108f05bc2bae61a9f7e97/package.json
[exa-lock]: https://github.com/exa-labs/exa-mcp-server/blob/f3d71fb6b0ff4b4683f108f05bc2bae61a9f7e97/package-lock.json
[exa-search]: https://github.com/exa-labs/exa-mcp-server/blob/f3d71fb6b0ff4b4683f108f05bc2bae61a9f7e97/src/tools/webSearch.ts
[exa-advanced]: https://github.com/exa-labs/exa-mcp-server/blob/f3d71fb6b0ff4b4683f108f05bc2bae61a9f7e97/src/tools/webSearchAdvanced.ts
[exa-registry]: https://github.com/exa-labs/exa-mcp-server/blob/f3d71fb6b0ff4b4683f108f05bc2bae61a9f7e97/src/toolRegistry.ts
[exa-handler]: https://github.com/exa-labs/exa-mcp-server/blob/f3d71fb6b0ff4b4683f108f05bc2bae61a9f7e97/src/mcp-handler.ts
[exa-handler-test]: https://github.com/exa-labs/exa-mcp-server/blob/f3d71fb6b0ff4b4683f108f05bc2bae61a9f7e97/tests/unit/mcp-handler.test.ts
[exa-sanitizer]: https://github.com/exa-labs/exa-mcp-server/blob/f3d71fb6b0ff4b4683f108f05bc2bae61a9f7e97/src/utils/exaResponseSanitizer.ts
[exa-fetch]: https://github.com/exa-labs/exa-mcp-server/blob/f3d71fb6b0ff4b4683f108f05bc2bae61a9f7e97/src/tools/webFetch.ts
[exa-config]: https://github.com/exa-labs/exa-mcp-server/blob/f3d71fb6b0ff4b4683f108f05bc2bae61a9f7e97/src/tools/config.ts
[exa-http]: https://github.com/exa-labs/exa-mcp-server/blob/f3d71fb6b0ff4b4683f108f05bc2bae61a9f7e97/api/mcp.ts
[exa-errors]: https://github.com/exa-labs/exa-mcp-server/blob/f3d71fb6b0ff4b4683f108f05bc2bae61a9f7e97/src/utils/errorHandler.ts
[exa-search-test]: https://github.com/exa-labs/exa-mcp-server/blob/f3d71fb6b0ff4b4683f108f05bc2bae61a9f7e97/tests/unit/tools/webSearch.test.ts
[exa-fetch-test]: https://github.com/exa-labs/exa-mcp-server/blob/f3d71fb6b0ff4b4683f108f05bc2bae61a9f7e97/tests/unit/tools/webFetch.test.ts
[exa-license]: https://github.com/exa-labs/exa-mcp-server/blob/f3d71fb6b0ff4b4683f108f05bc2bae61a9f7e97/LICENSE
[mcp-lifecycle]: https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle
[mcp-transport]: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
[cherry-old-provider]: https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/src/renderer/src/providers/WebSearchProvider/LocalSearchProvider.ts
[cherry-old-google]: https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/src/renderer/src/providers/WebSearchProvider/LocalGoogleProvider.ts
[cherry-old-service]: https://github.com/CherryHQ/cherry-studio/blob/da22fb797343fd3760e5dd2d467eda9bf0017632/src/main/services/SearchService.ts
[cherry-pr]: https://github.com/CherryHQ/cherry-studio/pull/14443
[cherry-registry]: https://github.com/CherryHQ/cherry-studio/blob/c45058a31307231024d514f20bd5eca88fea2bfb/src/main/services/webSearch/providers/registry.ts
[cherry-tool]: https://github.com/CherryHQ/cherry-studio/blob/c45058a31307231024d514f20bd5eca88fea2bfb/src/main/ai/tools/adapters/aiSdk/builtin/WebSearchTool.ts
[cherry-lookup]: https://github.com/CherryHQ/cherry-studio/blob/c45058a31307231024d514f20bd5eca88fea2bfb/src/main/ai/tools/webLookup.ts
[cherry-citations]: https://github.com/CherryHQ/cherry-studio/blob/c45058a31307231024d514f20bd5eca88fea2bfb/src/main/ai/utils/citationIds.ts
[cherry-license]: https://github.com/CherryHQ/cherry-studio/blob/c45058a31307231024d514f20bd5eca88fea2bfb/LICENSE
[deepseek-responses]: https://api-docs.deepseek.com/guides/responses_api/
[deepseek-claude]: https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code/
