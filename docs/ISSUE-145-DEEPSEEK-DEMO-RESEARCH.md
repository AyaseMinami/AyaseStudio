# #145 DeepSeek 官方开源 Demo（deepseek-ai/chat-demo）调研与 Chat 架构对照

调查日期：2026-11-26。本文为只读源码调研与工程对照报告，服务于 `#141`（DeepSeek 服务端联网工具）方案设计，并面向 Ayase Studio 整体 Chat 实现（SSE 传输、流式渲染、消息列表、搜索引用、持久化与历史导入可行性）提炼可复用参考。本轮未运行 `chat-demo`、未发送真实 API 请求、未修改 Ayase 运行时代码，亦未操作远端 Issue 或 Git 交付。

## 固定版本与边界说明

- **上游固定版本**：`deepseek-ai/chat-demo`，提交 [`cdf9617c5f265d58e0e1805635b2c10a3d41284d`](https://github.com/deepseek-ai/chat-demo/tree/cdf9617c5f265d58e0e1805635b2c10a3d41284d)（[package.json](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/package.json#L1-L6) 声明版本 `0.1.4`）。
- **许可证边界**：上游采用 MIT License（[LICENSE](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/LICENSE#L1-L21)）。本文仅归纳协议细节、交互行为与工程设计模式，不直接复制上游代码、文案或视觉资产；所有建议均受 Ayase 协议中立、`SafeMarkdown` 安全边界、[PROTOCOLS.md](PROTOCOLS.md)、[ARCHITECTURE.md](ARCHITECTURE.md) 与 [DATA-CONTRACTS.md](DATA-CONTRACTS.md) 约束。
- **Ayase 本地对照基线**：`dev` 分支 HEAD `de659192879636bd596c73a601e0849a67ba8bb6`（含当前工作区未提交的 `#140` 独立 Search API 改动）。
- **证据分层**：
  - **直接源码行为**：由逐行阅读上游或本地源码直接确认的逻辑与字段。
  - **对照差距 / 条件风险**：结合双方实现推导的兼容性风险、边界缺陷或架构权衡。
  - **未验证范围**：`chat-demo` 仅接入了 Anthropic 兼容 Messages API（`/anthropic/v1/messages`），**未包含 OpenAI Responses API 客户端实现**；此外未执行实时联网探测、性能基准压测或真实界面验收，相关结论不能替代后续确定性测试与实测验收。

---

## 一、对 `#141`（DeepSeek 服务端联网工具）的协议核对与排雷

### 1.1 请求体、工具路由与预设边界（直接源码行为）

| 维度 | `chat-demo` 源码行为 | 上游出处 | 对 `#141` 的设计启示 |
| --- | --- | --- | --- |
| 工具声明 | `deepseek_read_url` 与 `deepseek_web_search` 为两个独立 `tools` 条目（`{ type, name }` 同名）；Demo 默认常驻 `deepseek_read_url`，由搜索开关决定是否追加 `deepseek_web_search` | [types.ts L163-183](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/src/services/api/types.ts#L163-L183)、[store.ts L55-64](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/src/services/chat/store.ts#L55-L64) | 协议层两者可解耦独立声明。Ayase 当前 `webSearchProvider: "deepseek"` 已由 `#140` 独立 REST 搜索占用（[mode.ts](../src/search/mode.ts#L4-L8)），原生工具仅按协议映射（[nativeSearch.ts](../src/chat/nativeSearch.ts#L67-L75)）。`#141` 方案需显式定义入口/开关、与 `#140` 的组合或互斥规则，并让普通发送、重新生成与编辑发送共用同一预检和冻结配置 |
| 扩展模式副作用 | 声明任一 DeepSeek 联网工具或 `safety_check: { level: 'high' }` 均会触发扩展模式；Demo 固定开启 `safety_check` 并对无标题会话传 `title: { enabled: true }` | [types.ts L4](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/src/services/api/types.ts#L4)、[store.ts L48-49](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/src/services/chat/store.ts#L48-L49)、[L1030-1034](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/src/services/chat/store.ts#L1030-L1034) | 按 Epic `#139` 与 `#141` 已确认范围：Ayase **不发送** `safety_check` 与 `title`，仅在用户显式启用 DeepSeek 服务端联网工具时声明对应 `tools` |
| 鉴权、Beta 头与路径 | 使用 `x-api-key` 请求 `/anthropic/v1/messages`；`anthropic-beta: files-api-2025-04-14` 仅在 Files API 或 `file_id` 引用时携带，纯文本/联网工具请求无需携带 | [client.ts L16](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/src/services/api/client.ts#L16)、[L86-91](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/src/services/api/client.ts#L86-L91) | Ayase DeepSeek Anthropic 预设已配置 `https://api.deepseek.com/anthropic`（[providerPresets.ts](../src/chat/providerPresets.ts#L15)），与现有 `anthropic-native` 鉴权头兼容；若用户手填裸根地址则会解析到 `/v1/messages`，方案应沿用现有显式地址预览，不按 URL 隐式猜测改写 |

### 1.2 Anthropic 协议流式块与事件形态（关键排雷点）

| 块 / 事件类型 | 精确字段与边界 | 上游出处 | 与 Ayase 现有实现的关键差异 |
| --- | --- | --- | --- |
| `server_tool_use` | **原子下发**：`content_block_start` 即携带完整 `input`（不依赖 `input_json_delta`）；`kind` 为 `search \| deep_search \| read_link \| image_search \| deep_image_search`；`input.action` 分四种：`search`（`queries: string[]`, `query?`）、`open_page`（`url`）、`find_in_page`（`url`, `pattern`）、`read_link`（`url`） | [types.ts L29-55](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/src/services/api/types.ts#L29-L55)、[parseEvent.ts L50-83](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/src/services/api/parseEvent.ts#L50-L83) | Ayase [searchDecoding.ts](../src/chat/searchDecoding.ts#L135-L139) 当前仅识别 `name === "web_search"` 与单数 `input.query`，尚不识别 `deepseek_web_search` / `deepseek_read_url` 及 `input.queries[]` |
| `web_search_tool_result` | `content` 为**数组**，元素为 `web_search_result`（含 `title`、`url`、`snippet`、`site_icon`、`site_name`、`page_age`、`encrypted_content`、`image_url?`）或 `web_search_tool_result_error`（`error_code: 'unavailable'`）；成功无结果时为 `[]` | [types.ts L57-86](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/src/services/api/types.ts#L57-L86)、[parseEvent.ts L84-113](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/src/services/api/parseEvent.ts#L84-L113) | Ayase [searchDecoding.ts](../src/chat/searchDecoding.ts#L140-L146) 已能递归处理 `content` 错误数组、保留失败状态并继续收集后续来源；主要缺口在于尚未读取 `snippet`（写入 `excerpt` 时需服从 [validation.ts](../src/backup/validation.ts#L192-L195) 单条 1500 字、单消息合计 8000 字的备份限额）以及多步结果如何汇总 |
| `web_fetch_tool_result` | `content` 为**单个对象**（非数组）：`web_fetch_result`（`url`、`content.title`、`published_at`，`source.data` 恒为空串）或 `web_fetch_tool_result_error`（`error_code`: `'url_not_accessible' \| 'url_not_allowed' \| 'unavailable'`）；`kind` 为 `read_link \| deep_search`；**`signature` 仅在 `read_link` 成功时返回** | [types.ts L88-114](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/src/services/api/types.ts#L88-L114)、[parseEvent.ts L114-140](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/src/services/api/parseEvent.ts#L114-L140) | Ayase 当前未处理 `web_fetch_tool_result`；接入时必须按单对象解析其内层 `content`，区分成功与三类错误码，并原样保留 `signature` 供多轮回传 |
| `text` 与 `citations_delta` | `TextCitation` 含 `type: 'web_search_result_location'`、`url`、`title: string \| null`、`cited_text`、`encrypted_index: ""`，**无字符偏移字段**；服务端在挂过引用的 `text` 块之后另起新 `text` 块，引用锚点位于块尾空白之前 | [types.ts L11-24](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/src/services/api/types.ts#L11-L24)、[view.ts L154-181](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/src/services/chat/view.ts#L154-L181) | Ayase [searchDecoding.ts](../src/chat/searchDecoding.ts#L152-L155) 已有无偏移 `web_search_result_location` 分支，采用 `[textOffset, textEnd]`；当文本块末尾含换行时直接取 `textEnd` 可能把角标推到下一行，建议保留原文不变、仅将 UTF-16 锚点终点收紧到块尾空白之前 |
| 流中无名错误帧与保活 | 服务端可能发 `: keep-alive`、`ping`；等待超时等异常时会发送**无 `event: error` 且无 `type: "error"` 的 JSON 错误帧** `{"error":{"message":"..."}}`，随后关闭连接 | [client.ts L160-189](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/src/services/api/client.ts#L160-L189)、[types.ts L252-260](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/src/services/api/types.ts#L252-L260) | **高优先级排雷**：Ayase 的 Gemini 传输已识别 JSON `error`（[transport.ts](../src/chat/transport.ts#L566)），但 Anthropic 流式路径（[transport.ts](../src/chat/transport.ts#L826-L837)）仅判断 `payload.type === "error"`，会静默忽略无名错误帧，直到 EOF 才误报为 `Anthropic stream ended before message_stop` |

### 1.3 多轮回传（`signature`）、拒答最终快照与续写边界

1. **精准的多轮回传裁剪与上下文预算一致（`reply.ts` L215-284）**
   - `chat-demo` 构建历史 `assistant` 消息时：
     - **丢弃**历史 `thinking` 块（仅续写本轮时保留非空白思考与签名）；
     - **丢弃**所有搜索类工具块（`search` / `deep_search` / `image_search` / `deep_image_search`）；
     - **仅保留 `kind === 'read_link'` 的 `server_tool_use` 与 `web_fetch_tool_result`**（原样保留 `signature`），且若某条成功的 `read_link` 结果缺少有效 `signature`（`!block.signature?.trim()`），则通过 `unsignedReadLinks` 集合将对应的调用块与结果块**成对剔除**；
     - 文本块剥除 `citations`；相邻文本直接拼接，被思考或工具块隔开的文本用 `\n\n` 连接（省略历史思考后仍保持空行分隔）。
   - **对 Ayase 的直接启示**：
     - Ayase 目前在 Anthropic 路径（[transport.ts](../src/chat/transport.ts#L846-L849)）仅在 `pause_turn` 或存在非 `not-used` 搜索记录时发出整组 `providerReplay`，同作用域且已完成、有正文的轮次进入普通历史回放（[requestMapping.ts](../src/chat/requestMapping.ts#L339-L343)、[contextBudget.ts](../src/chat/contextBudget.ts#L95-L115)）。
     - [contextBudget.ts](../src/chat/contextBudget.ts#L131-L132) 已估算 `JSON.stringify(message.providerReplay.content)`，但尚未计入 `providerReplay.responses` 实际可能展开的全部块。
     - 若将整包保存/整包回传直接套用到 DeepSeek 多步深度思考搜索，会把海量 `thinking` 与带 `encrypted_content` 的搜索结果塞回后续请求。`#141` 设计应单列 Anthropic `read_link` 的成功、失败与孤立配对裁剪规则，并让**上下文预算估算与最终请求映射共用同一份裁剪结果**；Responses 侧当前只发本地角色正文且固定 `store: false`（[requestMapping.ts](../src/chat/requestMapping.ts#L286-L308)），其 `web_search_call` 回放结构及数据策略须单独核证并满足 [DATA-CONTRACTS.md](DATA-CONTRACTS.md)（同步字段策略、实际备份投影、严格读取、模块版本与恢复规则）。

2. **安全拒答（`stop_reason: 'refusal'` / `content_filter`）的原子终态快照（`reply.ts` L143-160、`AssistantMessage.tsx` L50-68）**
   - 流式响应中已下发的 `thinking` 与 `text` 不能在网络层撤回；`chat-demo` 在 `stop_reason === 'refusal'` 收尾时丢弃全部 `thinking` 与 `text` 块，只保留工具块与拒绝提示，且该轮次不进入后续上下文。
   - **对 Ayase 的关键风险补齐**：
     - Ayase 的 `ChatEvent`（[types.ts](../src/chat/types.ts#L55-L63)）已有状态与终态事件，但缺少“撤回/替换已接收内容”的语义；[useChatSession.ts](../src/chat/useChatSession.ts#L103-L110) 会将 `refusal` 归为 `incomplete`（不会进入下轮上下文），但此前流式下发并落盘的正文与 `thinkingSummary` 仍会残留。
     - **仅替换正文和思考还不够**：如果不同步清理 `providerReplay` 与 `search.citations`，一方面原始被拒内容仍会留在可导出的 `providerReplay` 里（[snapshot.ts](../src/backup/snapshot.ts#L59)），另一方面旧 `citations` 坐标可能超出新拒答文案长度，直接触发备份校验失败（[validation.ts](../src/backup/validation.ts#L196)：`c.end <= v.content.length`）！
     - 因此 `#141` 设计应在**同一次终态快照提交中**原子处理：`content`、`thinkingSummary`、`providerReplay`、`search.citations` 与 `continuation`；同时明确非流式拒答、收到拒答标记后断流/取消、持久化失败、以及此前流式过程快照的边界，且不得破坏普通截断、其他供应商的原生拒答文案及用户显式重新生成能力。

3. **续写禁令需要显式守卫（`reply.ts` L166-191）**
   - `chat-demo` 明确禁止含任何服务端工具调用/结果块（包括 `read_link` 和孤立结果块）、`refusal`、`tool_use` 或 `isTemplate` 的回复作为续写前缀。
   - **对 Ayase 的影响**：Ayase 当前只要 Anthropic 返回 `pause_turn` 就会将消息置为 `paused` 并展示续写按钮（[useChatSession.ts](../src/chat/useChatSession.ts#L104)、[L1053-L1057](../src/chat/useChatSession.ts#L1053-L1057)）。不能预先假设 DeepSeek 永远不返回相关状态，必须在 `#141` 设计中显式约束：启用 DeepSeek 服务端联网工具的回复不进入续写流程，不保存或暴露可误触的 `continuation` 入口。

4. **未覆盖项提醒（Responses API）**
   - `chat-demo` 全程仅实现 Anthropic 兼容协议，**不包含** OpenAI Responses 的 `web_search_call`、`url_citation`（Unicode 码点索引转 UTF-16）与 `incomplete_details.reason: "content_filter"` 实码。这部分在 `#141` 设计与实现阶段须直接对照 DeepSeek Responses 官方文档，并补足含 emoji / 代理对字符的确定性测试。

---

## 二、面向 Ayase 整体 Chat 实现的系统性参考

以下按模块对比 `chat-demo` 与 Ayase 现状，明确区分**可借鉴项（附落地边界）**与**不宜照搬项**。

### 2.1 SSE 解析器、连接释放与流式错误防御

通用 SSE 层只负责切帧与取消，具体错误信封与终态判定仍由各协议 adapter 负责，保持 [PROTOCOLS.md](PROTOCOLS.md) 边界清晰。

| 检查项 | `chat-demo` 做法 | Ayase 当前现状 | 评估与建议 |
| --- | --- | --- | --- |
| 换行符与跨分片 CRLF / CR | 按 WHATWG 规范处理 `CRLF / LF / CR`，显式挂起 chunk 末尾单独 `\r` 等下一片判断（[sse.ts L18-56](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/src/services/api/sse.ts#L18-L56)） | [sse.ts](../src/chat/sse.ts#L65-L77) 共享解析器供 Gemini 与 Anthropic 使用（OpenAI Chat/Responses 走 `openai` SDK）；其 `split("\n")` + 去尾 `\r` 已能正确处理跨分片 CRLF，但遇到**纯 `\r`（CR）**换行会错误合并帧 | **建议借鉴**：补齐纯 `\r` 换行支持，并增加纯 CR 与跨分片 CRLF 的确定性夹具 |
| 中止时主动取消 Reader | `readServerSentEvents(stream, signal)` 绑定 `abort` 监听，立刻调用 `reader.cancel(signal.reason)`（[sse.ts L105-114](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/src/services/api/sse.ts#L105-L114)） | Tauri HTTP 插件底层已监听 `abort` 并释放响应体；但 [sse.ts](../src/chat/sse.ts#L52-L54) 本身未接收 `signal`，在非 Tauri / 浏览器或未传递 abort 到响应体的流中挂起在 `reader.read()` 时不会立即退出 | **建议借鉴**：给 `parseServerSentEvents` 增加可选 `signal?: AbortSignal` 在 abort 时主动 `reader.cancel()`，并用挂起流夹具验证 |
| `Content-Type` 与 HTTP 200 JSON 报错 | 收到 2xx 后先检查 `Content-Type` 包含 `text/event-stream`，否则按错误响应体读取（[client.ts L160-163](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/src/services/api/client.ts#L160-L163)） | Gemini / Anthropic 传输（[transport.ts](../src/chat/transport.ts#L554)、[L736](../src/chat/transport.ts#L736)）未区分 200 JSON 响应；中转站若以 HTTP 200 返回 JSON 报错会直接进入 SSE 切帧 | **建议谨慎处理（B 类权衡）**：为避免误杀漏设 `Content-Type` 的小众中转站，优先对明确 `application/json` 的 200 响应直接按错误/协议体处理，而非一刀切拒绝缺省 `Content-Type` |
| 无名 / 纯文本 `error` 帧 | 解析 JSON 失败时仅 `event === 'error'` 抛错；含 `error.message` 的无名 JSON 帧亦识别为 `stream` 错误（[client.ts L165-178](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/src/services/api/client.ts#L165-L178)） | Gemini 已识别 JSON `error`（[transport.ts](../src/chat/transport.ts#L566)）；Anthropic 流式（[transport.ts](../src/chat/transport.ts#L738)、[L826](../src/chat/transport.ts#L826)）直接 `JSON.parse` 且仅认 `payload.type === "error"` | **强烈建议借鉴**：在 Anthropic adapter 识别无名 `{"error": ...}` 与 `event: error` 纯文本帧；同时**保留** Ayase 对真正畸形数据帧报明确 `protocol` 错误的保守合同，不可静默跳过损坏数据 |
| EOF 未空行结尾帧与缺 `message_stop` | WHATWG 规范丢弃 EOF 残帧（[sse.ts L48-56](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/src/services/api/sse.ts#L48-L56)）；已收到 `stop_reason` 仅缺 `message_stop` 时仍判 `done`（[store.ts L1088-1090](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/src/services/chat/store.ts#L1088-L1090)） | [sse.ts](../src/chat/sse.ts#L85-L94) 在 EOF 会派发缺末尾空行的帧（甚至可借此收到 `message_stop`）；但缺少 `message_stop` 时严格报未确认失败（[transport.ts](../src/chat/transport.ts#L868-L875)） | **保持 Ayase 现有策略**：保留 EOF 兼容以免破坏非标中转站与现有单测；保留缺终态帧的保守失败判定，不猜测未确认响应 |

### 2.2 流式渲染节流与 Markdown 渲染性能

| 检查项 | `chat-demo` 做法 | Ayase 当前现状 | 评估与建议 |
| --- | --- | --- | --- |
| 流式状态提交 | 使用 `requestAnimationFrame` 合并增量；页面 `hidden` 时同步 `flush`（[store.ts L995-999](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/src/services/chat/store.ts#L995-L999)、[L1053-1057](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/src/services/chat/store.ts#L1053-L1057)） | [useChatSession.ts](../src/chat/useChatSession.ts#L1245-L1281) 以 `32ms` / `500ms` 作为文本/思考增量到达时的节流门槛（非后台定时器），`search-update`、`usage-update` 与终态均立即提交 | 现有分层清晰；固定 32ms 门槛在长回复渲染变慢时不会自动降频 |
| 自适应 Markdown 渲染节流 | `useThrottleMarkdownRender` 测量上次提交耗时 `cost`，将下次允许渲染推迟 `min(2000ms, cost × 2)`；流式结束立刻关闭节流（[useThrottleMarkdownRender.ts L1-44](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/src/components/markdown/useThrottleMarkdownRender.ts#L1-L44)） | [SafeMarkdown.tsx](../src/chat/SafeMarkdown.tsx#L155-L170) 对未变历史消息已有 `memo`，但流式活跃消息每次已提交正文或搜索数据变化都会同步重跑完整 `react-markdown` + KaTeX 管线 | **建议作为独立可测优化**：先对长表格、重数学公式做耗时测量；仅延迟流式展示，停止或终态立即刷新全文，不更换 `SafeMarkdown` 安全架构 |
| 禁用 `codeIndented` | `fromMarkdown` 显式禁用 `codeIndented`，减少带前导空格列表被误判为代码块（[parse.ts L40-41](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/src/services/markdown/parse.ts#L40-L41)） | Ayase 沿用标准 CommonMark + `remark-gfm` | **单列为 Markdown 语义变更**：改动会影响依赖 4 空格缩进代码块的现有渲染语义，须单独确认与回归验证，不隐式夹带 |
| Raw HTML 策略 | 对 `<br>` 渲染为 `<br />`，其余输出原文（[MarkdownAstRenderer.tsx L16-21](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/src/components/markdown/MarkdownAstRenderer.tsx#L16-L21)） | `AGENTS.md` 禁止任何 raw HTML 渲染与绕过；Gemini 搜索建议的无脚本 sandbox iframe 属既有隔离特例 | **明确不照搬**：DeepSeek 正文与来源均走 `SafeMarkdown` 纯文本及现有安全外链入口 |

### 2.3 消息列表滚动跟随、版本切换锚定与重绘隔离

| 检查项 | `chat-demo` 做法 | Ayase 当前现状 | 评估与建议 |
| --- | --- | --- | --- |
| 动态高度变化贴底 | `ResizeObserver` 监听内容列与滚动容器；仅在跟随态下于图片加载、折叠切换或输入框增高时自动贴底（[MessageList.tsx L72-82](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/src/components/messages/MessageList.tsx#L72-L82)） | [MessageList.tsx](../src/ui/chat/MessageList.tsx#L96-L110) 仅在 `messages` 变化时贴底，不响应异步图片解码、思考折叠或输入框高度变化 | **强烈建议借鉴**：在遵循 [UI-DESIGN.md](UI-DESIGN.md) 滚动合同的前提下引入 `ResizeObserver`（严格仅在跟随态生效，验收用户上滚、异步图片、折叠与输入框增高） |
| 历史消息重绘隔离 | `AssistantMessage` / `UserMessage` 拆分为 `memo` 组件，版本映射保持未变对象引用稳定（[branches.ts L39-74](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/src/services/chat/branches.ts#L39-L74)） | [MessageList.tsx](../src/ui/chat/MessageList.tsx#L189-L260) 将消息项内联在 `.map()` 中，且每行调用 `retryUser(messages, message.id)`（[messageOperations.ts](../src/chat/messageOperations.ts#L17-L24) 每次重扫全数组，导致单次渲染为 $O(N^2)$） | **强烈建议借鉴**：先将 `retryUser` 映射预计算为一次线性遍历并稳定回调 props，再把单条消息拆为 `memo` 子组件，否则行级 `memo` 无法生效 |
| 切换版本视口锚定 | 切换版本前记录切换按钮的 `getBoundingClientRect().top`，渲染后按差值补偿 `scrollTop`（[MessageList.tsx L85-97](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/src/components/messages/MessageList.tsx#L85-L97)） | [MessageList.tsx](../src/ui/chat/MessageList.tsx#L117-L123) 切换 `roundVersions` 后只恢复按钮焦点，未补偿视口位置 | **建议借鉴**：版本切换时独立补偿视口位置并保留既有焦点恢复逻辑 |

### 2.4 搜索结果、来源元数据与行内引用交互

| 检查项 | `chat-demo` 做法 | Ayase 当前现状 | 评估与建议 |
| --- | --- | --- | --- |
| 来源去重与渐进补齐 | `SourceRegistry` 按 URL 首次出现顺序编号；后续结果仅补齐缺失的 `title`/`siteName`/`snippet`/`siteIcon`/`publishedAt`，不覆盖已有好字段，且严格 `isWebUrl`（[view.ts L109-152](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/src/services/chat/view.ts#L109-L152)、[url.ts L1-8](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/src/utils/url.ts#L1-L8)） | [searchDecoding.ts](../src/chat/searchDecoding.ts#L159-L163) 的 `addSources` 与 [nativeSearch.ts](../src/chat/nativeSearch.ts#L45-L55) 的续写 `mergeSearch` 均按 `id` 后者整条覆盖前者；合成流已可复现后到的 citation 把完整标题覆盖回 URL 占位 | **强烈建议修复（直接修正现有缺陷）**：同时升级 `addSources` 与 `mergeSearch`，保留首次编号、允许真实标题替换 URL 占位、缺省字段增量补齐且不覆盖已有摘要；摘要长度服从备份预算 |
| 行内引用悬停预览 | `CitationLink` + `HoverCard`（300ms 悬停、100ms 离开缓冲、自动上下翻转），展示站点名、日期、标题与摘要（[HoverCard.tsx L1-56](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/src/components/search/HoverCard.tsx#L1-L56)、[SourceCard.tsx L1-30](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/src/components/search/SourceCard.tsx#L1-L30)） | [SafeMarkdown.tsx](../src/chat/SafeMarkdown.tsx#L135-L137) 仅提供原生 `title` 提示；完整列表在底部 `<details>` 折叠区 | **后续独立 UI 增强**：按 `#141` 已确认范围首版沿用现有 UI，后续可做全搜索模式通用的来源悬停卡片 |
| 活跃态与中断态文案 | 流式 1s ticker 显示“正在思考 / 正在搜索 / 正在浏览网页 / 正在阅读链接 / 已思考 N 秒”（[view.ts L357-408](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/src/services/chat/view.ts#L357-L408)） | [ThinkingSummary.tsx](../src/ui/chat/ThinkingSummary.tsx#L6-L15) 已有接收中与“思考内容 · 已中断”态；[SearchResults.tsx](../src/ui/chat/SearchResults.tsx#L11-L24) 已有搜索中、完成、未使用、失败、取消及外部搜索文案 | `#141` 保持轻量复用即可，可在 `SearchResults` 按需微调阅读链接活跃提示，不做多步穿插时间线重构 |
| 原始协议块与视图分离 | 持久化与回传读取原始 `blocks`，视图由纯函数 `buildReplyView` 派生（[view.ts L12-15](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/src/services/chat/view.ts#L12-L15)） | Ayase 已分离 `content`、`search` 与 `providerReplay` | 继续坚持展示数据与 `providerReplay` 解耦 |

### 2.5 持久化、内存缓存与可靠性边界

| 检查项 | `chat-demo` 做法 | Ayase 当前现状 | 评估与建议 |
| --- | --- | --- | --- |
| 闲置会话缓存回收 | 列表仅持 `SessionSummary`，详情 LRU 缓存上限 5 条（豁免当前、生成中、未保存、删除中）（[store.ts L129-155](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/src/services/chat/store.ts#L129-L155)） | [useConversationWorkspace.ts](../src/chat/useConversationWorkspace.ts#L35-L36) 同时维护 `stores` 与 `views` 两个 Map，长期切换大量长对话会持续驻留正文引用 | **单列为后续可靠性优化**：若做回收，必须**同时释放 `stores` 和 `views` 中的消息引用**、保留未发送草稿，并严格避开当前活动、生成中、编辑中、暂停续写、未提交及保存失败的会话 |
| 隐藏 / 退出前落盘 | 监听 `visibilitychange === 'hidden'` 与 `pagehide`，先 flush 内存增量再触发落盘（[store.ts L235-261](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/src/services/chat/store.ts#L235-L261)） | 正常退出经 [prepareForClose](../src/chat/useChatSession.ts#L1536-L1547) 等待编辑、生成任务与 `flushSessionWrites()`；[SessionStore.flush()](../src/chat/sessionStore.ts#L60-L63) 已支持重试最后一次失败的写入；托盘隐藏走独立路径 | **审慎评估**：隐藏事件最多只能尽力提交生成任务手里的最新内存快照，单调 `flush()` 只能排空已入队写操作，`pagehide` 亦不能保证异步 IndexedDB 事务完成；应优先验收失败后补存最新版本、切换重载与真实退出 |
| 错误归类与诊断 | `errors.ts` 做结构化状态归类，不写死文案（[errors.ts L3-44](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/src/services/api/errors.ts#L3-L44)） | Ayase 已有中性 `ChatFailureKind` 并保留脱敏后的完整供应商响应正文 | **保留 Ayase 做法**：脱敏完整响应体更利于排查中转站问题，不引入特定供应商的充值链接硬编码 |
| 数据迁移与 Files API 自动重传 | `db.ts` 不迁移旧结构（[db.ts L59](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/src/services/chat/db.ts#L59)）；附件依赖远端 Files API 并在 400 `file_id` 失效时自动退避重传重发（[store.ts L1076-1087](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/src/services/chat/store.ts#L1076-L1087)） | Ayase 坚持 [DATA-CONTRACTS.md](DATA-CONTRACTS.md) 迁移/备份合同、纯本地无状态内联附件及零静默重试原则 | **明确不照搬**：Ayase 现有数据契约、附件全局引用保护与保守重试边界更严格，必须维持 |

---

## 三、DeepSeek 官方聊天历史导出格式摸底（供未来单独立项评估）

依据 [history/README.md](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/src/services/chat/history/README.md) 与 [format.ts](https://github.com/deepseek-ai/chat-demo/blob/cdf9617c5f265d58e0e1805635b2c10a3d41284d/src/services/chat/history/format.ts)：

1. **归档容器与目录结构**
   - 单卷未加密 ZIP32（STORE / DEFLATE，不支持 ZIP64/分卷），文件名约定 `deepseek_data-日期.zip`。
   - 条目布局：`manifest.json`（首个条目，含 `{ export_format_version: 3 }`）→ 可选 `user.json`（跳过）→ `chat_sessions/{session_id}.json` → `chat_session_index.json` → `chat_sessions/{session_id}_files/{file_id}_{file_name}`（也兼容会话 JSON 与图片交错、索引置尾）。
2. **消息树与片段结构**
   - 会话文件含 `id`、`title`、`pinned`、`current_message_id`、`inserted_at` / `updated_at`（UTC RFC 3339）及 `messages[]`。
   - 消息采用自增整数 `id` + `parent_id` 构成消息树（角色严格交替、根为 `USER`），含 `status`（`FINISHED | INCOMPLETE | WIP | FAILED | CONTEXT_LENGTH_EXCEEDED | TIMEOUT | CONTENT_FILTER`）、`thinking_enabled`、`search_enabled` 与有序 `fragments[]`。
   - `fragments` 涵盖 `REQUEST`、`RESPONSE`（引用标记已剥除）、`THINK`（含 `elapsed_secs`）、`TEMPLATE_RESPONSE`、`TOOL_SEARCH`、`TOOL_OPEN`、`TOOL_FIND`、`READ_LINK`（含 `signature` 与可选 `url`/`title`）、`FILE`（仅图片带 `export_path` 原件，非图片仅元数据），以及展示层忽略的 `TIP`、`CONTENT_RISK`、`PARTIAL_FILE_READ`、`TOOL_IMAGE_SEARCH`。
3. **未来在 Ayase 单独立项“导入 DeepSeek 历史记录”（对标 `#77`）的可行性**
   - **可行性高**：格式版本明确、校验规则在 MIT 参考源码中完全公开；消息树分支可参照 `#77`（[PLAN.md](PLAN.md#L113-L115)）将历史分支拆分为独立对话。
   - **数据契约边界**：Ayase 当前消息来源校验仅接受 `source === "cherry"`（[messageData.ts](../src/chat/messageData.ts#L72-L77)、[validation.ts](../src/backup/validation.ts#L184-L185)），因此非图片缺失原件虽可复用现有 `unavailableAttachments` 展示能力，但**须单独定义新的导入来源数据契约与备份模块版本**，而非直接复用 `"cherry"` 字段。归档不含 API Key/模型配置/行内引用角标/用量明细，`READ_LINK.signature` 亦不得在无模型绑定状态下跨供应商回放。建议后续按需单独立项，不混入 `#141`。

---

## 四、给后续工作的优先级路线图

1. **直接纳入 `#141` 方案设计（前置必选）**：
   - 明确 `deepseek_web_search` 与 `deepseek_read_url` 的显式入口、与 `#140` 的命名区分及互斥/组合规则，统一普通发送、重生成、编辑发送的预检与冻结配置；
   - 补齐 Anthropic 解码（`server_tool_use` 原子 `input` + 四种 `action`、`web_search_tool_result` 的 `snippet` 预算截取、`web_fetch_tool_result` 单对象与 `signature`、块尾空白前 UTF-16 锚点、流中无名/纯文本错误帧）；
   - 明确 Anthropic `read_link` 签名配对裁剪（上下文预算与请求映射共用）及 Responses `web_search_call` 回放/Unicode 码点引用坐标核证，并同步 `DATA-CONTRACTS.md` 注册、实际投影、严格读取与模块版本；
   - 设计拒答终态的原子清理快照（同步处理 `content`、`thinkingSummary`、`providerReplay`、`search.citations`、`continuation`），并显式禁止 DeepSeek 联网工具回复进入续写。
2. **全 Chat 通用底座正确性修复（P1，建议先行或随 `#141` 独立小切片落地）**：
   - 修复 `SearchDecoder.addSources` 与 `mergeSearch` 的来源覆盖缺陷（保留首次编号、真实标题替换 URL 占位、缺省字段增量补齐）；
   - 升级 `src/chat/sse.ts` 支持纯 `\r` 换行与可选 `AbortSignal` 主动取消（保留既有 EOF 兼容，补全纯 CR、跨分片 CRLF、挂起取消、HTTP 200 JSON 报错与真正畸形帧夹具）。
3. **消息列表与 Markdown 体验优化（P2，各自独立验证）**：
   - `MessageList.tsx`：先预计算 `retryUser` 消除 $O(N^2)$ 并稳定 props，再做行级 `memo`；加入仅跟随态生效的 `ResizeObserver` 贴底与 `roundVersions` 切换视口锚定；
   - `SafeMarkdown.tsx`：先测长表格与重公式流式开销，再按需引入仅延迟展示的自适应节流（停止/终态立即刷新）；禁用 `codeIndented` 作为独立 Markdown 语义变更另行评估。
4. **可靠性与远期扩展（P3，按需立项）**：
   - 双缓存（`stores` + `views`）安全回收、失败后补存最新版本验收；
   - 全搜索模式通用的行内引用悬停预览卡片；
   - DeepSeek 官方 ZIP 历史记录导入（独立扩展来源数据契约）。

---

## 本轮核验与交叉审阅记录

- **上游核对**：浅克隆 `deepseek-ai/chat-demo` 固定提交 `cdf9617c5f265d58e0e1805635b2c10a3d41284d`，逐行核对 `src/services/api/*`、`src/services/chat/*`、`src/components/search/*`、`src/components/markdown/*`、`src/components/messages/*` 与 `src/services/chat/history/*`。
- **Codex 只读交叉复核与独立核实**：已通过 `codex-review` 对本报告与 Ayase `dev@de659192` 本地源码进行交叉复核，并由主代理逐项核实后吸收修订：
  - 修正了 `sse.ts` 对跨分片 CRLF 与纯 CR 的现状描述、补充了 Gemini/Anthropic 与 Tauri HTTP abort 传递差异；
  - 修正了 `searchDecoding.ts` / `SearchResults.tsx` / `ThinkingSummary.tsx` / `contextBudget.ts` / `useChatSession.ts` / `sessionStore.ts` 的现有能力边界；
  - 补齐了拒答终态未清理 `providerReplay` 与 `search.citations` 会触发备份校验失败与原始内容残留的关键盲点，以及 `snippet` 备份限额、`mergeSearch` 同步修复、`retryUser` $O(N^2)$ 前置优化、`stores`+`views` 双缓存回收与 `#77` 来源校验约束。
- **范围声明**：本轮仅产出本地调研报告，未修改任何运行时代码，未运行应用测试或界面验收，未提交、推送或修改远端 Issue。
