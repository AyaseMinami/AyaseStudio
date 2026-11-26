# #141 DeepSeek 服务端联网工具（`deepseek_web_search` 与 `deepseek_read_url`）设计案

日期：2026-11-26。状态：用户已于 2026-11-26 确认第 1.2 节全部产品决策（命名「DeepSeek 服务端联网」，选定 A1 + B1 + C1）并授权实施；本地代码、确定性测试与契约文档已按本方案落地，未提交、推送、操作远端 `#141` Issue 或发送实时模型请求。

需求：[Issue #141](https://github.com/AyaseMinami/AyaseStudio/issues/141)（所属 Epic：[#139](https://github.com/AyaseMinami/AyaseStudio/issues/139)）。
依据：
- DeepSeek 官方文档（2026-11-26 核对）：[联网工具](https://api-docs.deepseek.com/zh-cn/guides/web_tools/)、[Responses API](https://api-docs.deepseek.com/zh-cn/guides/responses_api/)、[Anthropic API](https://api-docs.deepseek.com/zh-cn/guides/anthropic_api/)、[模型内容安全](https://api-docs.deepseek.com/zh-cn/guides/safety/)；
- 仓库内调研与规范：[#145 Demo 调研报告](ISSUE-145-DEEPSEEK-DEMO-RESEARCH.md)、[协议合同](PROTOCOLS.md)、[架构合同](ARCHITECTURE.md)、[数据合同](DATA-CONTRACTS.md)、[UI 规范](UI-DESIGN.md)。
代码基线：本地 `dev` HEAD `de659192879636bd596c73a601e0849a67ba8bb6`（含本地未提交的 `#140` 独立 Search API 改动）。

---

## 1. 目标、已确认边界与产品决策

### 1.1 已由 `#139` / `#141` 确认的边界

| 项目 | 已确认边界 |
| --- | --- |
| 支持工具 | `deepseek_web_search`（关思考：联网/图搜并附引用；开思考：多步深度思考搜索 `search` / `open_page` / `find_in_page` / 图搜）与 `deepseek_read_url`（识别最后一条用户消息中前 10 个不重复 URL 并由服务端抓取） |
| 协议覆盖 | 仅支持 `anthropic-native`（Messages）与 `openai-responses`（Responses）。**`openai-chat` 下禁用** DeepSeek 服务端联网工具并明确提示（改用 Responses / Anthropic 连接或 `#140` 独立 Search API），不引入 `server_tool_event` / `server_tool_calls` 扩展；**保留 `openai-chat` 原生 `web_search_options` 不变**。`gemini-native` 同样不支持 |
| 协议中立与互斥 | 显式模式声明，绝不按 Base URL 或模型 ID 隐式改写标准 OpenAI/Anthropic 请求；不与标准 `web_search` / `web_search_20250305` / `web_search_options` 或外部搜索源同时声明；不强制 `tool_choice` |
| 非目标参数 | 默认不发送 `safety_check`（即默认 `low`），不发送 `title: { enabled: true }`，不接入 Files API |
| 首版 UI 范围 | 复用 Ayase 现有「折叠思考 + 来源卡片 + 行内引用」，不做多步穿插时间线、右侧来源抽屉或引用悬停卡片重构 |

### 1.2 用户已确认的产品决策（2026-11-26 拍板）

以下三项及入口命名已由用户确认定稿（暂不修改远端 `#141` 正文，也不自动进入开发）：

1. **入口命名与工具拆分（已选定 A1）**
   - 联网搜索选择器新增与 `模型原生` 并列的显式模式 **`DeepSeek 服务端联网`**（内部模式 `"deepseek-server"`），同时将 `#140` 独立 Search API 在选择器中的显示名调整为 **`DeepSeek Search API`**（内部值仍为 `"deepseek"` 不破坏数据）。
   - 选中 `DeepSeek 服务端联网` 时，展开两个紧凑复选框：`联网 / 深度思考搜索`（`deepseek_web_search`）与 `阅读消息链接`（`deepseek_read_url`），默认均勾选、至少保留一项，持久化为 `SessionConfig.deepseekWebTools?: { search: boolean; readUrl: boolean }`。
   - 界面提供清晰提示：仅适用于 DeepSeek 兼容服务（如 `deepseek-flash`，不按域名或模型名封死中转站或自定义别名）、仅支持 Responses / Anthropic 协议；不按域名或模型名暗改标准「模型原生」请求。
2. **不支持协议下的配置与拦截行为（已选定 B1）**
   - 跨模型/协议切换时**不静默清空**会话或助手模板中已保存的 `deepseek-server` 选择；
   - 在 `openai-chat` / `gemini-native` 下，选择器仍可见 `DeepSeek 服务端联网` 但**禁止新选**（已处于该模式时作为不可用当前态显示并附明确原因，切换为其他合法模式后即时恢复正常）；无模型选中时独立显示「未选择模型」，不误判为协议不支持；
   - 沿用现有面板保存语义：助手模板遇请求配置错误时禁用保存（避免新建对话自带不可发送模板），对话设置允许保留待修正值并显示告警，而在普通发送、重新生成与编辑并发送的统一预检中明确拦截并报错（零网络请求、不自动回退到 `web_search_options`）。
3. **拒答终态的来源与查询保留策略（已选定 C1）**
   - 触发 `refusal` / `content_filter` 时，同一次终态快照原子清空被拒正文、思考摘要、`providerReplay`、`search.citations` 与 `continuation`，正文替换为明确拒答提示，消息置为 `incomplete`（不进后续上下文），并**允许用户显式点击「重新生成」**（绝不自动重试）；
   - 保留已执行的 `search.sources` 与 `search.queries`（与官方文档 `output` 保留 `web_search_call` 一致，且 `incomplete` + 合法 `sources`/`queries` + `citations: []` 满足现有备份结构校验）。

---

## 2. 界面入口与模式路由

### 2.1 模式定义与互斥边界

扩展 [src/search/mode.ts](../src/search/mode.ts)：

```ts
export type DeepSeekWebToolsSelection = {
  search: boolean;
  readUrl: boolean;
};

export type SearchMode = "off" | "native" | "deepseek-server" | ExternalSearchProvider;
```

- `isExternalSearch(mode)` 保持仅识别 `"exa-mcp" | "exa-api" | "tavily" | "zhipu" | "deepseek"`（`#140` 外部 REST 搜索）；
- 新增 `isDeepSeekServerSearch(mode)` 识别 `"deepseek-server"`；
- `resolveSearchMode(config)`：
  - `config.webSearch !== true` → `"off"`；
  - `config.webSearchProvider === undefined || config.webSearchProvider === "native"` → `"native"`；
  - `config.webSearchProvider === "deepseek-server"` → `"deepseek-server"`；
  - 合法 `ExternalSearchProvider` → 对应外部搜索源；
  - 未知/损坏值 → `"off"`（绝不隐式激活任何联网服务）。
- `resolveDeepSeekWebTools(config)`（方案 A1）：缺失 `deepseekWebTools` 时纯读取默认 `{ search: true, readUrl: true }`，不自动写回。

### 2.2 工具栏、会话配置与助手默认模板

- **位置**：复用现有 [WebSearchControl.tsx](../src/ui/chat/WebSearchControl.tsx)（[ConversationSettings.tsx](../src/ui/chat/ConversationSettings.tsx) 对话配置 + 助手配置面板）与 `WebSearchToolbarControl`（聊天底部工具栏弹层），保持现有配置弹窗栅格与 [UI-DESIGN.md](UI-DESIGN.md) 交互约定。
- **显示名区分**：
  - `"native"`：`模型原生`
  - `"deepseek-server"`：`DeepSeek 服务端联网`
  - `"deepseek"`（`#140`，开启配置后出现）：`DeepSeek Search API`
- **子工具开关与工具栏交互（方案 A1）**：
  - `WebSearchControl` 与 `WebSearchToolbarControl` 传入 `protocol?: ChatProtocol`（用于协议支持提示与禁用新选）、`deepseekWebTools` 与更新回调；
  - 选中 `DeepSeek 服务端联网` 时，下方紧凑显示两个复选框（`联网 / 深度思考搜索`、`阅读消息链接`）；仅剩一项勾选时禁用取消该项并附无障碍提示“至少保留一项联网工具”；
  - 在工具栏弹层中，切换顶层模式照旧更新并关闭弹层（切到 `deepseek-server` 时保持展开以便查看/微调两项复选框；按 `Escape` 关闭并将焦点返回触发按钮，点击外部关闭弹层且不抢占点击目标焦点）；勾选子复选框时即时持久化且不关闭弹层，保证键盘 `Tab` / 方向键与 `Escape` 回焦一致。
- **官方行为与协议状态提示**：
  - `openai-chat` 提示：*「Chat Completions 不支持 DeepSeek 服务端联网工具；请改用 Responses / Anthropic 连接，或改用 DeepSeek Search API。」*
  - `gemini-native` 提示：*「当前协议不支持 DeepSeek 服务端联网工具；仅支持 Responses 与 Anthropic 协议。」*
  - 未选择模型时：独立显示「未选择模型」，不误判为协议不支持；
  - 在配置面板与工具栏弹层中附简短说明：仅适用于 DeepSeek 兼容服务（如 `deepseek-flash`，官网与兼容中转站均可用），仅支持 Responses / Anthropic 协议；开启后采样参数将被服务端忽略且回复不可续写；开启思考且勾选搜索时服务端进入深度思考搜索（不单独执行阅读链接）；同时明确「模型原生」为标准协议内置搜索（适用 OpenAI / Claude / Gemini / DeepSeek V4 Pro），不暗改请求体；
  - 复用 [parameterCapability](../src/chat/requestMapping.ts#L71-L85)：在支持协议下启用 `"deepseek-server"` 时，对 `temperature` / `topP` / `topK` 提示“DeepSeek 服务端联网模式下服务端会忽略采样参数”（仅提示，不强制报错拦截已有数值配置）。

---

## 3. 请求预检与双协议请求映射

### 3.1 统一冻结与预检（覆盖普通发送、重新生成与编辑并发送）

抽取共享冻结辅助函数（如 `freezeTransportSearchConfig(config, searchMode)`），由以下三条路径**统一调用**（特别修补当前 [useChatSession.ts L898](../src/chat/useChatSession.ts#L898) 与 [编辑发送 L1399-L1400](../src/chat/useChatSession.ts#L1399-L1400) 两处硬编码 `frozenConfig.webSearch = searchMode === "native"` 的分叉）：

1. 外部搜索（`isExternalSearch(searchMode)`）：向 transport 冻结 `webSearch: false`，仅由会话层执行外部检索管线；
2. 服务端模式（`"native"` 或 `"deepseek-server"`）：向 transport 完整保留 `webSearch: true`、`webSearchProvider` 及（方案 A1）`deepseekWebTools`；
3. 统一在 `validateRequestConfig` 与 `buildProtocolBody`（[requestMapping.ts](../src/chat/requestMapping.ts)）执行预检：
   - `searchMode === "deepseek-server"` 时，若 `protocol !== "anthropic-native" && protocol !== "openai-responses"`，直接返回 `RequestConfigError`（零网络请求、不回退 `web_search_options`）；
   - 方案 A1 下若 `search === false && readUrl === false`，返回校验错误，不允许发出空 `tools`；
   - 初始化 `assistantMessage.search` 时，普通发送与编辑发送共用同一条件：`externalSearch ? ... : (searchMode === "native" || searchMode === "deepseek-server") ? initialSearch(true) : undefined`。

### 3.2 `tools` 构造（[nativeSearch.ts](../src/chat/nativeSearch.ts#L67-L75)）

将 `searchRequestBody` 扩展为按 `(protocol, searchMode, deepseekTools)` 生成：
- **`anthropic-native` + `"deepseek-server"`**：
  ```json
  {
    "tools": [
      { "type": "deepseek_web_search", "name": "deepseek_web_search" },
      { "type": "deepseek_read_url", "name": "deepseek_read_url" }
    ]
  }
  ```
  （按 `search` / `readUrl` 分别包含；**不传 `tool_choice`**，**不传 `web_search_20250305`**，**不传 `safety_check` / `title`**。）
- **`openai-responses` + `"deepseek-server"`**：
  ```json
  {
    "tools": [
      { "type": "deepseek_web_search" },
      { "type": "deepseek_read_url" }
    ]
  }
  ```
  （按 `search` / `readUrl` 分别包含；**不传 `name`**，**不传 `tool_choice`**，**不传 `include`**，**不传 `web_search`**，**保持 `store: false`**。）
- **`openai-chat` + `"native"` 及其他协议 `"native"`**：与现有行为 **100% 保持不变**。

### 3.3 预设地址解析核对

实测 [urlResolution.ts](../src/chat/urlResolution.ts#L56-L66) 与 [providerPresets.ts](../src/chat/providerPresets.ts#L15) 现行解析结果如下，直接沿用，不按 URL 隐式改写协议或工具：
- `DeepSeek Responses` 预设裸根 `https://api.deepseek.com` → `https://api.deepseek.com/responses`（与官方示例一致）；
- 用户显式填写 `https://api.deepseek.com/v1` → `https://api.deepseek.com/v1/responses`；
- `DeepSeek Anthropic` 预设 `https://api.deepseek.com/anthropic` → `https://api.deepseek.com/anthropic/v1/messages`。

---

## 4. 双协议响应解码、引用换算与来源合并

### 4.1 Anthropic Messages（`anthropic-native`）

1. **工具调用与结果解码（[searchDecoding.ts](../src/chat/searchDecoding.ts#L133-L157)）**
   - `server_tool_use`（`content_block_start` 原子携带完整 `input`）：
     - `name === "web_search"`：保持现有 Anthropic 标准逻辑不变；
     - `name === "deepseek_web_search"`：标记活跃；`input.action === "search"` 时读取 `input.queries[]`（兼容可选 `input.query`）；`open_page`、`find_in_page` 与图搜（`queries: []`）均标记活跃；
     - `name === "deepseek_read_url"`：标记活跃（`action === "read_link"`）。
   - `web_search_tool_result`（数组 `content`）：
     - 遍历 `web_search_result`，读取合法 `url`、`title` 及 `snippet`（按第 4.3 节预算写入 `excerpt`）；
     - 遇到 `web_search_tool_result_error`（`error_code: "unavailable"`）：记录非致命错误；**多步深度思考搜索兼容**：若本轮已有其他成功搜索/抓取工具结果，不覆盖有效来源与成功态，仅当本轮没有任何成功工具结果时置 `status: "failed"`（仅正文引用带入的来源不覆盖工具失败态，与既有 `searchDecoding.test.ts` 契约一致）。
   - `web_fetch_tool_result`（**单对象 `content`**）：
     - `content.type === "web_fetch_result"`：从 `content.url` 与 `content.content.title` 登记来源（仅 `http:` / `https:`），标记工具已产出；
     - `content.type === "web_fetch_tool_result_error"`：读取 `content.error_code`（`url_not_accessible` / `url_not_allowed` / `unavailable`），遵循上述多步失败原则；
     - `signature` 仅留在回放构造器，不进入 `SearchRecord`。
   - **引用锚点（`citations_delta` / `text.citations`）**：
     - 对无字符偏移的 `web_search_result_location`：计算该 `text` 块去掉尾随空白后的有效终点 `trimmedEnd = textOffset + blockText.trimEnd().length`；当 `trimmedEnd > textOffset` 时使用 `[textOffset, trimmedEnd]`，否则回退 `[textOffset, textEnd]`（保持原始正文一字不改，仅让角标落于换行前）。
2. **流式与非流式错误兼容（[transport.ts](../src/chat/transport.ts#L681-L885)）**
   - 忽略 `ping` 事件与 `: keep-alive` 注释；
   - 流式循环增加两类错误识别：
     - 顶层无 `type: "error"` 但含 `{ error: { message: string, ... } }` 的无名 JSON 错误帧；
     - `event.event === "error"` 且 `event.data` 为非 JSON 纯文本时，按 `providerFailure("stream_error", event.data)` 上报（其他非 `error` 帧若 `JSON.parse` 失败仍报 `protocol` 错误，不静默跳过畸形帧）；
   - 流式或非流式 `200 OK` `{ type: "error", error, usage }` 若携带 `usage`，先发出 `usage-update` 再发出 `failed`。

### 4.2 OpenAI Responses（`openai-responses`）

1. **工具项与流式事件解码（[transport.ts](../src/chat/transport.ts#L294-L464)、[searchDecoding.ts](../src/chat/searchDecoding.ts#L51-L91)）**
   - 流式按 `output_index` / `item.id` 跟踪 `response.output_item.added`、`response.web_search_call.in_progress / searching / completed`、`response.output_item.done`，以及终态 `response.completed` / `response.incomplete` 的完整 `response.output[]`（支持并行多调用先全部 `added` 再陆续完成）。
   - 解析 `web_search_call`：
     - `kind` ∈ `search | deep_search | image_search | deep_image_search | read_link`；
     - `action.type === "search"`：读取 `action.queries[]`（兼容单数 `action.query`）与 `action.sources[]`（`url`、`title`、`snippet` 预算截断为 `excerpt`）；
     - `action.type === "open_page"`：从 `item.page`（`{ url, title, published_at }`）登记来源；
     - `action.type === "find_in_page"`：标记活跃；
     - `item.status === "failed"`：读取 `item.error?.code`（`url_not_accessible` / `url_not_allowed` / `unavailable`），按多步部分失败原则处理。
   - **思考摘要**：复用现有 [ResponseThinking](../src/chat/responseThinking.ts#L35)（已支持 `reasoning_text` 与多段 `\n\n` 分隔），补充多步深度思考搜索回归测试。
   - **非流式与流式终止判定顺序（与第 6 节严格一致）**：
     - 流式与非流式**先判定**是否为 `status === "incomplete"` 且 `incomplete_details?.reason === "content_filter"`：若是，则跳过正文/思考/回放发布，提取可选 `refusal` 解释文本并直接发出带 `refusal` 的终态；即使 `response.output_text` 为空也不报畸形响应；
     - 若**不是** `content_filter`（例如标准 OpenAI 正常返回的拒绝回复），当 `output` 含 `message.content[].type === "refusal"`（包括非流式响应**仅有** `refusal` 块而 `output_text === ""` 的情况）时，按普通正文文本正常输出，不触发审核清空。

2. **`url_citation` 按内容块归并与 Unicode 码点换算**
   - **严格协议隔离**：仅当本次请求为 `"deepseek-server"`（或响应中观测到 DeepSeek 扩展 `web_search_call.kind`）时启用 Unicode 码点 → UTF-16 换算；标准 OpenAI Responses `"native"` 保持既有 UTF-16 偏移。
   - **按内容块归并（防止流式与终态重复累加错位坐标）**：
     - 在 `SearchDecoder` 中按 `(outputIndex, contentIndex)` 维护每个内容块的原始注解暂存（保存未换算的原始 `start_index`、`end_index`、`url`、`title` 与注解序号/身份），不把未收齐前的临时 UTF-16 偏移直接永久并入全局去重表；
     - 每次依据该内容块**当前已发布的实际文本 `partText`** 与完整基准偏移 `offset` 计算一次 UTF-16 坐标（`codePointOffsetToUtf16(partText, index)` 逐码点推进，4 字节代理对如 `🚀`、`👨‍👩‍👧‍👦` 精确加 2）；
     - 当终态 `response.completed` 或长度截断的 `response.incomplete`（非 `content_filter`）到达并携带该内容块的权威注解时，**整块替换**该 `(outputIndex, contentIndex)` 的暂态注解再统一换算；若终态快照省略注解，则保留流式期间已收集的有效注解；
     - 任何换算后不满足 `0 <= start < end <= fullText.length` 的坐标安全丢弃，永不产生越界引用。

### 4.3 有界稳定来源 ID、来源合并与摘要预算（同步修补既有缺陷）

同步升级 [SearchDecoder](../src/chat/searchDecoding.ts#L159-L163) 与 [mergeSearch](../src/chat/nativeSearch.ts#L45-L55)：

1. **有界稳定的来源 ID（解决 513 字符 URL 卡住备份导出的隐患）**：
   - 核对 [validation.ts L34](../src/backup/validation.ts#L34) 与 [L193](../src/backup/validation.ts#L193)：`source.id` 受 `id()` 限制为最多 **512 个 UTF-16 码元**，而 `source.url` 允许长达 32,768 字符。
   - 改为按规范化 URL 去重，对新产生的来源分配确定性有界短 ID（如 `src-1`、`src-2`…，或在超过 512 码元/统一全部原生与 DeepSeek 路径生成稳定短 ID，同时 `mergeSearch` 按 `source.url` 合并去重并将续写引用重映射到保留的 `source.id`）；完整合法 URL 单独存于 `source.url`（截断或拒绝超 32,768 字符及非 `http:`/`https:` 的地址）。兼容已有历史数据中以 URL 作为 `id` 的旧记录，不迁移改写旧消息。
2. **保留首次编号且只增补不倒退**：
   - 同 URL 再次到达时保留首次编号顺序；
   - 仅当原 `title` 为空或等于 `url` 占位且新 `title` 为真实非空标题时更新 `title`；
   - 仅当原 `excerpt` 为空且新 `excerpt` 非空时补齐 `excerpt`；绝不用后到无摘要或 URL 标题的 citation 覆盖先到的完整搜索结果。
3. **严格服从备份摘要限额（[validation.ts L192-L195](../src/backup/validation.ts#L192-L195)）**：
   - `excerpt` 按 Unicode 码点截断：单条 ≤ 1500 码点，单条消息所有来源 `excerpt` 累计 ≤ 8000 码点（超出后后续来源省略 `excerpt`，仍保留 `id`/`url`/`title`）。

---

## 5. 多轮回传（`providerReplay`）与上下文预算协同

### 5.1 统一回放数据结构

扩展 [ProviderReplay](../src/chat/nativeSearch.ts#L29-L35)：

```ts
export interface ProviderReplay {
  protocol: "anthropic-native" | "openai-responses";
  /** Local metadata (`${connectionId}|${baseUrl}`), never sent upstream. */
  scope: string;
  content: Record<string, unknown>[];
  responses?: Record<string, unknown>[][];
}
```

- `anthropic-native`：`content` 为可回放的 Anthropic `assistant.content` 块数组（保留 `responses` 兼容既有 `pause_turn` 多段续写）；
- `openai-responses`：`content` 为可回放的 Responses `web_search_call` item 数组（`responses` 禁止出现在 `openai-responses` 回放中）。

### 5.2 按协议精准裁剪与共享身份校验

新增共享纯模块 `src/chat/deepseekReplay.ts`，由 **Transport 产出**、**`planContextBudget` 预算估算** 与 **`buildProtocolBody` 请求映射** 三处共用同一份资格校验与展开函数，确保预算与实际请求 100% 一致：

1. **严格资格校验（[requestMapping.ts L340](../src/chat/requestMapping.ts#L340) 与 [contextBudget.ts L131](../src/chat/contextBudget.ts#L131)）**：
   - 历史 `assistant` 消息的 `providerReplay` 必须同时满足：
     - `replay.scope === request.replayScope`（同连接 ID 与 Base URL）；
     - `replay.protocol === protocol`（扩展联合类型后**强制校验协议匹配**，防止同连接改协议后跨协议误回放）。
   - **同连接换模型与关闭工具策略**：
     - 同一 DeepSeek 连接与协议下，若后续轮次用户关闭了 `deepseek_read_url` 或改用普通聊天，只要仍命中同一 `replayScope` + `protocol`，历史 `read_link` 回放继续发送以还原网页上下文（符合官方文档）；
     - 同一连接内若切换为同一协议下的另一模型，仅在同 `replayScope` + `protocol` 内沿用既有 `scope` 规则（不按模型名白名单猜测）；切换连接、改 Base URL 或切协议后自动隔离不回传。
2. **Anthropic DeepSeek 服务端模式裁剪**：
   - 仅收集 `web_fetch_tool_result` 中满足 `kind === "read_link"`、`content.type === "web_fetch_result"` 且 `typeof signature === "string" && signature.trim().length > 0` 的合法 `tool_use_id`；
   - 仅保留成对存在的 `server_tool_use`（`type`、`id`、`name`、`input`、`caller`、`kind`）与 `web_fetch_tool_result`（原样保留 `kind`、`signature`、`content`），失败结果、缺签名结果及孤立调用块一律成对剔除；
   - 若合法 `read_link` 对数为 0（如仅做普通/深度思考搜索），**不生成 `providerReplay`**；
   - 存在合法对时，将上述配对块与剥除 `citations` 后的回答文本块（相邻文本拼接，被省略的思考/搜索块隔开处用 `\n\n` 连接）存入 `providerReplay.content`。
   - 标准 Anthropic `native` 搜索与 `pause_turn` 保持既有回放行为不变。
3. **OpenAI Responses DeepSeek 服务端模式裁剪**：
   - 仅保留 `type === "web_search_call"`、`status === "completed"`、`kind === "read_link"` 且 `typeof signature === "string" && signature.trim().length > 0` 的 item（规范化保留 `type`、`id`、`status`、`kind`、`action`、`page`、`signature`）；
   - 数量为 0 时**不生成 `providerReplay`**；
   - `buildProtocolBody`（[requestMapping.ts L286-L308](../src/chat/requestMapping.ts#L286-L308)）中，命中合格 `openai-responses` 回放的历史 `assistant` 轮次先展开 `web_search_call` items，再接 `{ type: "message", role: "assistant", content: [{ type: "output_text", text: message.content }] }`；无回放时维持原 `{ role: "assistant", content: message.content }`。
4. **上下文预算同步（[contextBudget.ts](../src/chat/contextBudget.ts#L131-L160)）**：
   - `messageTokens` 与最终输出历史共用上述资格校验与展开结果：
     - `anthropic-native` 按展开后的全部块（包含旧多段 `responses`）估算；
     - `openai-responses` 按展开后的 `web_search_call` items + 回答正文估算；
   - 历史消息输出不再硬编码仅 `protocol === "anthropic-native"` 保留 `providerReplay`，改为按当前协议与资格校验结果保留。
5. **绑定原问答：仅保存用户消息编辑时失效关联回放（[messageEdits.ts L147-L149](../src/chat/messageEdits.ts#L147-L149)）**：
   - 编辑助手消息时 `editedMessage` 已清空自身 `providerReplay`；
   - **补齐盲点**：当用户对某条 `user` 消息执行「仅保存」编辑（例如修改或删掉原消息中的 URL）时，其直接关联的可见 `assistant` 回复（`replyToId === editedUser.id`）若仍保留旧 `read_link` `providerReplay`，DeepSeek 服务端会在后续轮次把旧网页拼到已编辑的新用户消息末尾导致上下文错配。因此在「仅保存」更新 `user` 消息的同一事务中，同步清除该条直接关联可见 `assistant` 回复的 `providerReplay`（历史 `roundVersions` 非活动候选保留各自原配对不受影响）。

---

## 6. 拒答安全暂存、原子终态快照与续写守卫

### 6.1 统一拒答事件契约

在 [ChatEvent](../src/chat/types.ts#L55-L63) 的 `completed` 终态与 `failed` 终态明确拒答清理信号：

```ts
| {
    type: "completed";
    finishReason?: string;
    usage?: TokenUsage;
    refusal?: {
      reason: "refusal" | "content_filter";
      explanation?: string;
    };
  }
| {
    type: "failed";
    error: ChatFailure;
    clearRefusedContent?: boolean;
  }
```

- **Anthropic 拒答锁定**：一旦在流中收到 `message_delta.delta.stop_reason === "refusal"`，transport 立即锁定 `refused = true`（记录可选脱敏 `stop_details.explanation`）；此后无论正常收到 `message_stop`（发出 `completed` + `refusal`），还是发生 EOF、解析错误、供应商错误或用户中止（发出 `failed` + `clearRefusedContent: true` 或 `aborted` 清理路径），**一律执行同一份敏感内容清理**。非流式 `stop_reason === "refusal"` 同理发出 `completed` + `refusal`。
- **Responses 拒答判定**：流式 `response.incomplete` 或非流式 `response.status === "incomplete"` 且 `incomplete_details?.reason === "content_filter"` 时，提取可选脱敏 `refusal` 说明并发出 `completed` + `refusal`；未命中 `content_filter` 的普通 OpenAI `refusal` 文本块不触发清理，照常按正文展示。

### 6.2 DeepSeek 待审核流式内容的安全落盘保护

针对现有流程在流式每 500ms 持久化正文/思考（[useChatSession.ts L1277-L1280](../src/chat/useChatSession.ts#L1277-L1280)）而冷启恢复仅把 `streaming` 改为 `aborted`（[sessionStore.ts L20-L24](../src/chat/sessionStore.ts#L20-L24)）的残留风险：

- 当本次请求为 **`"deepseek-server"`** 模式且处于流式接收阶段时：
  - 实时流式正文、`thinkingSummary`、`citations` 与未定稿 `providerReplay` 仅在内存中驱动界面流式渲染；
  - 持久化队列在收到明确终态（`completed` / `aborted` / `failed`）之前，**只将安全占位写入 IndexedDB**（`status: "streaming"`、空 `content`、无 `thinkingSummary`、无 `providerReplay`、无 `citations`，可写入 `generationMetrics` 与已完成来源元数据）；
  - 收到明确非拒答终态（正常完成、长度截断、用户停止或普通断流）时，一次性落盘完整最终内容；收到拒答终态或拒答后异常时，一次性落盘清理后的拒答快照。
- *已知权衡（明确记录）*：仅影响 `"deepseek-server"` 流式进行中突然强杀进程/断电的场景——冷启恢复后该未完成轮次保留为空白已停止占位而非半截未审核正文，换取“未通过审核内容绝不残留于数据库”的确定性保障；其他所有模式保持原有 500ms 增量持久化不变。

### 6.3 原子终态清理规则

收到 `completed(refusal)` 或 `failed(clearRefusedContent)`（以及锁定拒答后的用户停止）时，在**同一次** `workingMessages` 构造与持久化中原子执行：
1. `content`：设为明确拒答文案（默认 `「该回复因内容安全审核被拒答。」`，存在脱敏 `explanation` 时附带展示）；
2. `thinkingSummary`：置 `undefined`；
3. `providerReplay`：置 `undefined`；
4. `search`：保留 `enabled` 与已执行的合法 `sources` / `queries`，**强制 `citations: []`**；
5. `continuation`：置 `undefined`；
6. `status`：正常拒答终态置 `"incomplete"`（不进后续上下文，允许用户显式「重新生成」）；拒答后遇断流/错误置 `"failed"`。

### 6.4 续写守卫（覆盖全部入口）

1. **不产生续写状态**：普通发送（[useChatSession.ts L1053](../src/chat/useChatSession.ts#L1053)）与编辑发送（[useChatSession.ts L1431](../src/chat/useChatSession.ts#L1431)）在 `searchMode === "deepseek-server"` 时均**不初始化 `continuation`**；`completionStatus` 对 `"deepseek-server"` 或含 DeepSeek 工具块的回复，即使 `anthropic-native` 意外返回 `pause_turn` 也返回 `"incomplete"` 而非 `"paused"`。
2. **续写入口显式兜底拒绝（[useChatSession.ts L837-L870](../src/chat/useChatSession.ts#L837-L870)）**：进入 `resumeMessageId` 路径时，额外校验并拒绝以下暂停记录（给出“该回复使用了 DeepSeek 联网工具，不支持继续生成，请重新发送。”提示）：
   - `resume.continuation.config` 解析为 `"deepseek-server"`；
   - `resume.providerReplay.protocol !== "anthropic-native"`；
   - `resume.providerReplay.content` 或 `responses` 中包含 DeepSeek 工具块（`name` 为 `deepseek_web_search` / `deepseek_read_url`，或含 `kind` 扩展字段）。

---

## 7. 数据契约、模块版本与备份兼容

经对照 [DATA-CONTRACTS.md](DATA-CONTRACTS.md)、[compatibility.ts](../src/backup/compatibility.ts)、[dataContract.ts](../src/storage/dataContract.ts#L65-L79) 与 Codex 复核确认，采用 **`search v5` + `chat v4` + 保持 `session v1`**，Dexie schema `v9`、备份文档 `v5`、加密信封 `v1` 均保持不变：

| 模块 / 入口 | 具体变更与严格门禁 |
| --- | --- |
| **`search` 模块：`v4` → `v5`（`minimumReaderVersion: 5`）** | 沿用 `#82` / `#140` 既定分工，由 `search` 模块统一管辖跨模块搜索模式选择。`ayase-studio.search.v1` 本地独立搜索配置记录本身保持 **v4**，不新增外部 profile 或凭据。<br>- 在 `validateAdditionalSearchCompatibility`（[compatibility.ts L98](../src/backup/compatibility.ts#L98)）中，于**参数过滤与版本重标之前**，递归检查助手 `defaultConfig`、对话 `settings` / `creationConfig`、历史 `legacyConversationConfigs[].generationConfig`：只要出现 `webSearchProvider === "deepseek-server"` 或（方案 A1）`"deepseekWebTools" in config`（**即使当前 `webSearch` 为 `false`**），均要求备份原始声明 `modules.search.version >= 5`（旧 v1–v3 文档一律拒绝）。<br>- 实测 [dataContract.ts L73](../src/storage/dataContract.ts#L73) 的 `filterOptionalParameters` 禁止名称命中 `tool` 的未知键，因此旧客户端绝不会将未知的 `deepseekWebTools` 静默过滤；新客户端将其加入已知字段策略后完整保留。 |
| **`chat` 模块：`v3` → `v4`（`minimumReaderVersion: 4`）** | 拥有 `ProviderReplay.protocol` 扩展支持 `"openai-responses"`。<br>- 复用 `validateGenerationMetricsCompatibility`（[compatibility.ts L64](../src/backup/compatibility.ts#L64)）的递归消息遍历（覆盖可见消息与 `roundVersions.pairs`），在版本重标前要求凡出现 `providerReplay.protocol === "openai-responses"` 均须原始声明 `modules.chat.version >= 4`（旧 v1–v3 文档与旧 `chat` v1–v3 拒绝）。<br>- 副本恢复或不含连接的恢复继续由 [restorePlan.ts L124-L125](../src/backup/restorePlan.ts#L124-L125) 递归移除 `providerReplay`。 |
| **`session` 模块：保持 `v1`** | 无独立采样参数格式迁移；`SessionConfig` 严格读入口（[sessionConfig.ts L73](../src/chat/sessionConfig.ts#L73)）在 A1 下接受可选 `deepseekWebTools`（校验仅含布尔 `search` / `readUrl`、禁止未知键、禁止两者皆 `false`；旧记录缺失时保持缺失、纯读取默认 `{ search: true, readUrl: true }`，零自动写回）。 |
| **穷尽字段策略与真实投影** | - `dataPolicies.ts`：方案 A1 在 `dataPolicies.session` 新增 `deepseekWebTools: "backup"` 并注册穷尽 `dataPolicies.deepseekWebTools = { search: "backup", readUrl: "backup" }`；<br>- `snapshot.ts`：`session()` 真实投影 `deepseekWebTools`；<br>- `messageData.ts` & `validation.ts`：共用 `ProviderReplay` 校验规则——`openai-responses` 仅允许挂在 `assistant` 消息上、禁止 `responses` 字段、且 `content` 仅接受带非空 `signature` 的合法 `read_link` `web_search_call` 项；<br>- **补齐仓储读/写校验**：[repository.ts](../src/chat/repository.ts#L60-L72) 与 [snapshot.ts](../src/backup/snapshot.ts#L41) 接入与 `messageData.ts` 一致的 `providerReplay` 校验（不覆盖既有宽容范围之外的无关字段，但确保非法回放结构在读取、保存及投影前被拦截并保留原文）。 |

---

## 8. 拟修改模块与实施顺序

| 阶段 | 范围与核心文件 | 产出与独立验证 |
| --- | --- | --- |
| 1. 数据契约、模式与版本门禁 | `src/search/mode.ts`、`src/chat/sessionConfig.ts`、`src/chat/nativeSearch.ts`、`src/chat/messageData.ts`、`src/chat/repository.ts`、`src/storage/dataPolicies.ts`、`src/storage/dataRegistry.ts`、`src/backup/snapshot.ts`、`src/backup/validation.ts`、`src/backup/compatibility.ts` | 完成 `"deepseek-server"`（及 A1 `deepseekWebTools`）、双协议 `ProviderReplay`、`search v5` / `chat v4` 门禁与跨版本备份恢复单测；跑通 `npm.cmd run check:data-contracts` |
| 2. 协议映射、解码、回放与预算 | 新增 `src/chat/deepseekReplay.ts`；修改 `src/chat/requestMapping.ts`、`src/chat/searchDecoding.ts`、`src/chat/contextBudget.ts`、`src/chat/types.ts`、`src/chat/transport.ts`、`src/chat/messageEdits.ts` | 完成双协议 `tools` 映射、Anthropic/Responses 解码、按块归并的 Unicode 码点引用换算、有界来源 ID 与增量合并/摘要预算、无名/纯文本错误帧、`read_link` 裁剪回放、用户仅保存编辑失效关联回放与拒答事件 |
| 3. 会话协调与 UI 接入 | `src/chat/useChatSession.ts`、`src/ui/chat/WebSearchControl.tsx`（及 CSS）、`src/ui/chat/SessionConfigPanel.tsx`、`src/ui/chat/ConversationSettings.tsx`、`src/ui/chat/ConversationNavigation.tsx`、`src/ui/chat/SearchResults.tsx` | 接入统一冻结模式 helper、DeepSeek 流式安全占位落盘、拒答原子终态快照、续写入口全量守卫、工具栏/配置面板选项与禁用/忽略采样参数提示 |
| 4. 文档同步与验收门禁 | `docs/PROTOCOLS.md`、`docs/DATA-CONTRACTS.md`、`docs/UI-DESIGN.md`（及必要派生设计摘要）、`docs/PLAN.md` | 全量门禁（`npm.cmd run check`、`cargo check`、`git diff --check`）、独立只读审查与隔离内置浏览器 UI 验收 |

---

## 9. 确定性测试与验收矩阵

| 验收组 | 必须覆盖的确定性场景 |
| --- | --- |
| 协议边界与全入口预检 | `openai-chat` 禁用 `deepseek-server` 且零请求、不回退 `web_search_options`；`openai-chat` 原生 `web_search_options` 不变；`gemini-native` 拦截；`deepseek-server` 与标准 `native` / `#140` 互斥、不传 `tool_choice` / `safety_check` / `title`；普通发送、重生成与**编辑并发送**共用同一冻结模式与预检；无模型时独立提示 |
| Anthropic 流式与非流式 | 普通搜索（`queries[]` + `snippet` 预算截断 + 块尾空白前引用锚点）、图搜（`queries: []`）、多步深度思考搜索（`thinking` + `search` + `open_page` + `find_in_page` + 单步失败不淹没成功来源）、阅读链接（`web_fetch_tool_result` 单对象成功与三类错误码）、无名 JSON 错误帧与 `event: error` 纯文本帧、真正畸形帧仍报 `protocol` 错误 |
| Responses 流式与非流式 | `web_search_call`（`search` / `deep_search` / `read_link` / `image_search` / 并行多调用按 `output_index` 乱序完成 / `status: "failed"`）、`reasoning_text` 多段思考；按 `(output_index, content_index)` 归并的含 emoji（`🚀`、`👨‍👩‍👧‍👦`）与 CJK 扩展字 Unicode 码点 → UTF-16 换算（验证流中增量 + 终态替换**不产生 `[0,1]`+`[2,3]` 重复坐标**、覆盖 `completed` 与长度截断 `incomplete`）；标准 OpenAI Responses `native` 维持原 UTF-16 偏移 |
| 有界来源 ID 与合并 | 超 512 字符（如 600 字符）合法 HTTPS URL 生成有界短 ID 且通过备份导出/校验；`addSources` 与 `mergeSearch` 保留首次编号、真实标题替换 URL 占位、后到 citation 不覆盖已有标题与摘要；`snippet` 满足单条 ≤ 1500、单消息合计 ≤ 8000 码点 |
| 多轮回传、预算与编辑 | Anthropic 仅回传带有效 `signature` 的成对 `read_link`（缺签名/孤立/失败剔除，不回传 `thinking` 与搜索结果）；Responses 展开 `web_search_call` 至 `input[]` + `message`；同时校验 `scope` 与 `protocol`；`planContextBudget` 与 `buildProtocolBody` 共用展开结果（含旧 Anthropic `responses` 多段）；关闭工具后同 `replayScope` 仍回传，切连接/改协议不回传；**仅保存用户消息编辑**同步失效直接关联回复的 `providerReplay` 且保留历史候选原配对 |
| 拒答、安全落盘与续写守卫 | DeepSeek 流式期间数据库仅存安全占位，终态后落盘；Anthropic `stop_reason: "refusal"`（流式先出正文与思考、非流式、带 `stop_details.explanation`、**锁定拒答后遇 EOF/错误/用户停止**）与 Responses `incomplete_details.reason: "content_filter"`（空 `output_text` 与图片拦截 `refusal`）均原子清空正文/思考/`providerReplay`/`citations`/`continuation` 且通过备份校验、允许显式重生成；不误伤 `max_tokens` 与标准 OpenAI 正常 `refusal` 文本（含非流式仅 `refusal` 块）；普通/编辑发送不建 `continuation`，续写入口拒绝 DeepSeek 暂停记录 |
| 数据契约与备份 | 旧 v1–v5 备份与旧本机记录零写入兼容；`search v5`（覆盖 `deepseek-server` 与关闭态下的 `deepseekWebTools`）与 `chat v4`（覆盖可见消息与 `roundVersions.pairs` 的 Responses 回放）在过滤和重标前拒绝旧版本声明；非法结构零写入保留原文；完整导出 → 合并/副本/替换恢复（验证副本/无连接移除回放）→ 再导出 → 私有日志回滚闭环 |
| UI 与隔离浏览器 | 浅色/深色主题与窄窗口下工具栏弹层、对话配置与助手配置页中 `DeepSeek Search API` 与 `DeepSeek 服务端联网`（A1 子复选框即时保存、不误关弹层、至少选一保护、键盘导航与 `Escape` 回焦、`openai-chat` 提示、保持配置弹窗栅格）无溢出；真实供应商实测与原生交互单独列为人工验收项 |

---

## 10. 独立设计复核记录

- **复核方式**：由 Codex（只读沙箱）对照本地 `dev@de659192` 源码与数据合同独立审查，并由主代理逐项核对 `urlResolution.ts`、`useChatSession.ts`、`validation.ts`、`dataContract.ts`、`restorePlan.ts` 与 `messageEdits.ts` 后全部修订吸收：
  - 确认模块版本策略统一为 **`search v5` / 最低读者 5、`chat v4` / 最低读者 4、`session v1` 保持不变**（验证 `dataContract.ts:73` 过滤器本身会拦截未知 `tool` 键）；
  - 补齐了拒答后流中断/持久化的安全占位落盘机制、Responses `content_filter` 与普通 `refusal` 优先级一致、按 `(output_index, content_index)` 归并防止重复引用坐标、`editAndSend` 冻结配置与续写入口守卫、仅保存用户编辑失效关联回放、有界来源 ID 规避 512 字符备份校验上限，以及 `urlResolution.ts` 裸根 `/responses` 精确路径说明。
- **范围声明**：本节为设计阶段交叉复核证据，不代表代码实现、测试运行、真实供应商探测或界面验收已完成。
