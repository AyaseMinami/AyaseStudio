# #143 DeepSeek 思考强度控制核验与 Anthropic 思考 Token 用量统计设计案

日期：2026-11-26。状态：已按本设计案在 `dev` 完成实施、全量门禁验证与 Codex 独立只读交叉复核（含实施复核阶段的溢出/无主思考数收口修订）；2026-11-26 用户确认 `#143` 验收通过并授权提交、推送及关闭远端 `#143` Issue。

需求：[Issue #143](https://github.com/AyaseMinami/AyaseStudio/issues/143)（所属 Epic：[#139](https://github.com/AyaseMinami/AyaseStudio/issues/139)）。
依据：
- DeepSeek 官方文档（2026-11-26 核对）：[思考模式](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode/)、[Chat Completions API 参考](https://api-docs.deepseek.com/zh-cn/api/create-chat-completion/)、[Responses API 指南](https://api-docs.deepseek.com/zh-cn/guides/responses_api/)、[Responses API 参考](https://api-docs.deepseek.com/zh-cn/api/create-response/)、[Anthropic API 指南](https://api-docs.deepseek.com/zh-cn/guides/anthropic_api/)、[Messages API 参考](https://api-docs.deepseek.com/zh-cn/api/create-message/)；
- 仓库现行规范：[协议合同](PROTOCOLS.md)、[架构合同](ARCHITECTURE.md)、[数据合同](DATA-CONTRACTS.md)、[#107 聊天生成统计](ISSUE-107-IMPLEMENTATION.md)。
代码基线：本地 `dev` HEAD `fb0383d`（工作区干净）。

---

## 1. 目标、范围与非目标

### 1.1 商定范围
1. **Anthropic 思考 Token 用量统计补齐**：
   - 在 `src/chat/usage.ts` 的 `anthropic-native` 分支补充解析 `usage.output_tokens_details.thinking_tokens`（映射为 `TokenUsage.reasoningTokens`），保持既有非负安全整数校验、显式 `0` 保留与 `reasoningTokens <= outputTokens` 约束；
   - 确保流式（`message_delta.usage` 为累计终态值，不与 `message_start` 叠加，且不会让早期 `message_delta` 的旧思考数泄漏到已确认的终态指标）与非流式路径一致。
2. **三协议 DeepSeek 思考控制与思维链解码核验及回归测试**：
   - 补齐确定性测试覆盖 `openai-chat`（`reasoning_effort: "none" | "low" | "high" | "max"` + `reasoning_content`）、`openai-responses`（`reasoning.effort` + `response.reasoning_text.delta`）与 `anthropic-native`（`thinking: { type: "disabled" | "adaptive" | "enabled" }` + `output_config.effort`）面向 DeepSeek V4 / V4.1 的兼容映射与解码。
3. **协议文档同步**：
   - 同步修正 [PROTOCOLS.md](PROTOCOLS.md) 中过时的 DeepSeek Chat 关闭思考旧述，补记 `#143` 的 Anthropic `thinking_tokens` 与终态输出口径，并同步 [#107 用量字段表](ISSUE-107-IMPLEMENTATION.md) 及实施完成后的 [PLAN.md](PLAN.md)。

### 1.2 明确非目标（无新增产品决策）
- 不引入非标准的 Chat Completions `thinking: { type }` 双字段兼容（官方 [Chat Completions API 参考](https://api-docs.deepseek.com/zh-cn/api/create-chat-completion/) 已明确：省略 `thinking` 时由 `reasoning_effort` 决定开关，`none` 关闭思考，默认开启且强度 `high`）。
- 不修改现有思考 UI 选项结构（[thinking.ts](../src/chat/thinking.ts#L26-L38) 的 `thinkingOptions` 与 [ThinkingControl.tsx](../src/ui/chat/ThinkingControl.tsx) 保持不变）。
- 不按 Base URL 或模型名隐式改写协议请求体，不新增 `safetyTokens` 字段，不变更 Dexie schema、数据字段策略或备份模块版本。
- 本地确定性测试与只读代码审查不代替真实供应商/中转线路实测或远端 Issue 关闭。

---

## 2. Anthropic 思考 Token 用量解析与终态合并设计

### 2.1 官方协议字段核对
- **DeepSeek Messages API**（[create-message](https://api-docs.deepseek.com/zh-cn/api/create-message/)）：
  - `usage.output_tokens`：`>= 0` 整数，开启思考时已包含思考 Token；在流式 `message_delta.usage` 中为**累计值**（非增量），以最后一条 `message_delta.usage` 为准，不得与 `message_start.message.usage` 相加。
  - `usage.output_tokens_details`：开启思考或 `safety_check: { level: "high" }` 时返回，包含：
    - `thinking_tokens`：`>= 0` 整数，已包含在 `output_tokens` 中；
    - `safety_tokens`：`>= 0` 整数，DeepSeek 扩展字段，仅在 `safety_check: "high"` 时返回（已包含在 `output_tokens` 中）。
  - `input_tokens` 不含缓存命中，`cache_read_input_tokens` 为缓存命中，`cache_creation_input_tokens` 目前恒为 `0`；总输入 `inputTokens = input_tokens + cache_read_input_tokens + cache_creation_input_tokens`（与 Ayase 现行 `anthropic-native` 逻辑一致）。
- **其他两协议核对**（均已在 [usage.ts](../src/chat/usage.ts#L90-L108) 就绪，无需修改）：
  - `openai-chat`：`completion_tokens_details.reasoning_tokens` → `reasoningTokens`；`prompt_tokens_details.cached_tokens` 优先于 `prompt_cache_hit_tokens` → `cacheReadTokens`。
  - `openai-responses`：`output_tokens_details.reasoning_tokens` → `reasoningTokens`；`input_tokens_details.cached_tokens` → `cacheReadTokens`。

### 2.2 `src/chat/usage.ts` 改动

1. **解析 `output_tokens_details.thinking_tokens`**（[usage.ts L109-L119](../src/chat/usage.ts#L109-L119)）：
   - 仅读取官方明确定义的 `output_tokens_details.thinking_tokens`；不臆测未声明别名，不解析 `safety_tokens`（仅含 `safety_tokens` 时 `reasoningTokens` 保持 `undefined` 且不报错）。
   - **同帧输出锚点守卫**：仅当同帧存在合法非负安全整数 `output_tokens`（即 `outputTokens !== undefined`）时才采信 `output_tokens_details.thinking_tokens`；若 `output_tokens` 缺失或非法（例如 `{ output_tokens_details: { thinking_tokens: 18 } }`、`{ output_tokens: -1, output_tokens_details: { thinking_tokens: 18 } }` 或 `{ output_tokens: "5", output_tokens_details: { thinking_tokens: 3 } }`），**同帧不采信 `thinking_tokens`**（置 `undefined`）。原因是 `thinking_tokens` 属于 `output_tokens` 的子明细，当同帧无合法 `output_tokens` 时无法校验 `thinking_tokens <= output_tokens`，若保留则会在流式合并时错误拼到前一帧的旧 `outputTokens` 上（产生跨帧混合计数如 `20 / 18`）。
   - 其余情况照常交由 `validated()` 执行非负安全整数校验、`0` 值保留及 `reasoningTokens <= outputTokens` 校验（越界时仅删 `reasoningTokens`，保留有效 `outputTokens`）。

   参考实现：
   ```ts
   if (protocol === "anthropic-native") {
     const outputDetails = record(raw.output_tokens_details);
     const outputTokens = count(raw.output_tokens);
     return validated({
       uncachedInputTokens: count(raw.input_tokens),
       outputTokens,
       cacheReadTokens: count(raw.cache_read_input_tokens),
       cacheWriteTokens: count(raw.cache_creation_input_tokens),
       reasoningTokens: outputTokens !== undefined ? count(outputDetails.thinking_tokens) : undefined,
     });
   }
   ```

2. **Anthropic 输出观测成对替换合并**（[usage.ts L57-L85](../src/chat/usage.ts#L57-L85)）：
   - 现状问题（Codex 复核实测确认）：`mergeTokenUsage(previous, next)` 仅覆盖 `next` 中有效且存在的键。在 Anthropic 流式多 `message_delta` 场景下，如果前一条 delta 报 `output_tokens: 20, thinking_tokens: 5`，而后续终态 delta 报 `output_tokens: 50` 且缺失 `output_tokens_details` 或 `thinking_tokens: 99`（越界被丢弃），那么 `transport.ts` 的 `usage-update` 与 `GenerationMeasurement.observe`（[generationMetrics.ts L37-L43](../src/chat/generationMetrics.ts#L37-L43)）都会把旧的 `reasoningTokens: 5` 残留下来，并在终态以 `usageComplete: true` 保存展示为「供应商终态用量」的 `50 / 5`。
   - 解决方案：为 `mergeTokenUsage` 增加可选参数（`replaceOutput?: boolean`），仅对 `anthropic-native` 流式路径启用「输出成对替换」语义（不影响 `openai-chat`、`openai-responses`、`gemini-native` 的现有稀疏合并合同，也不改变非流式单帧溢出的部分观测语义）：
     ```ts
     export interface MergeTokenUsageOptions {
       /** When next supplies a valid outputTokens, replace output-level details together instead of carrying stale reasoningTokens forward. */
       replaceOutput?: boolean;
     }

     export function mergeTokenUsage(
       previous: TokenUsage | undefined,
       next: TokenUsage | undefined,
       options?: MergeTokenUsageOptions,
     ): TokenUsage | undefined {
       const supplied: TokenUsage = {};
       for (const key of Object.keys(next ?? {}) as Array<keyof TokenUsage>) {
         const value = count(next?.[key]);
         if (value !== undefined) supplied[key] = value;
       }
       if (options?.replaceOutput && supplied.outputTokens === undefined) {
         delete supplied.reasoningTokens;
       }
       const base = options?.replaceOutput && supplied.outputTokens !== undefined && previous
         ? { ...previous, reasoningTokens: undefined }
         : previous;
       const merged = validated({ ...base, ...supplied });
       if (options?.replaceOutput && merged && merged.outputTokens === undefined && merged.reasoningTokens !== undefined) {
         delete merged.reasoningTokens;
         return Object.keys(merged).length ? merged : undefined;
       }
       return merged;
     }
     ```
   - 效果核对（前一条 delta 为 `20 / 5`）：
     - 后续 delta `50 / 缺失` 或 `50 / 99`（越界）→ `supplied = { outputTokens: 50 }` → 清除旧 `reasoningTokens: 5`，得到 `50 / undefined`；
     - 后续 delta `50 / 0` → `supplied = { outputTokens: 50, reasoningTokens: 0 }` → 得到 `50 / 0`；
     - 后续 delta 无 `usage` 或 `output_tokens: -1`（非法）→ `supplied.outputTokens === undefined` → 保留上一帧完整一对 `20 / 5` 作为部分观测，且终态 `usageComplete: false`；
     - 输入桶（`uncachedInputTokens`、`cacheReadTokens`、`cacheWriteTokens`、`inputTokens`）仍按字段累计合并替换，不叠加。

### 2.3 `src/chat/transport.ts` 与 `src/chat/generationMetrics.ts` 改动

1. **`AnthropicNativeTransport` 流式路径**（[transport.ts L974-L1204](../src/chat/transport.ts#L974-L1204)）：
   - 状态变量新增 `let terminalReasoningTokens: number | undefined;`（与 `terminalOutputTokens` 成对）。
   - `message_start`（L1084）、`message_delta`（L1137）与中途 `error` 带 `usage`（L1019）合并 `usage` 时统一传入 `{ replaceOutput: true }`。
   - 在 `message_delta` 的 `if ("delta" in payload && payload.delta?.stop_reason)` 分支（L1127–L1135）：
     ```ts
     finishReason = payload.delta.stop_reason;
     terminalOutputTokens = snapshot?.outputTokens;
     terminalReasoningTokens = snapshot?.outputTokens !== undefined ? snapshot.reasoningTokens : undefined;
     ```
     （若后续再出现另一条带 `stop_reason` 的 `message_delta`，同步覆盖两者，沿用现行终态识别规则。）
   - 在 `message_stop`（L1156–L1164）：
     ```ts
     const finalObservation = { ...usage };
     delete finalObservation.outputTokens;
     delete finalObservation.reasoningTokens;
     delete finalObservation.totalTokens;
     if (terminalOutputTokens !== undefined) {
       finalObservation.outputTokens = terminalOutputTokens;
       if (terminalReasoningTokens !== undefined) finalObservation.reasoningTokens = terminalReasoningTokens;
     }
     const terminalUsage = mergeTokenUsage(undefined, finalObservation, { replaceOutput: true });
     ```
     - 若 `finalObservation` 在 `validated()` 中因「早期 `inputTokens` + 终态 `outputTokens`」超过 `Number.MAX_SAFE_INTEGER` 而移除 `outputTokens`，`replaceOutput: true` 会同步清除附属 `reasoningTokens`（若对象因此变空则返回 `undefined`），保证 `completed.usage` 不会留下无主思考数。
     - `refusal` 终态（L1165–L1180）复用同一份 `terminalUsage`，自动保留有效 `reasoningTokens` 且忽略 `safety_tokens`。
   - 非流式路径（L895–L971）：`normalizeTokenUsage("anthropic-native", payload.usage)` 复用同一份解析；当 `inputTokens + outputTokens` 溢出导致 `outputTokens` 被移除时，保持与既有 `validated()` 和 `readGenerationMetricsData` 容许部分观测的合同一致（且 `usageComplete: false`）。

2. **`GenerationMeasurement.observe`**（[generationMetrics.ts L33-L46](../src/chat/generationMetrics.ts#L33-L46)）：
   - 仅当 `this.protocol === "anthropic-native" && this.streaming` 时，在 `usage-update` 与 `completed` 合并 `this.usage` 时传入 `{ replaceOutput: true }`，且 `this.usageComplete` 同步要求合并后的 `this.usage?.outputTokens !== undefined`（避免极端缓存溢出导致 `usageComplete: true` 缺少 `outputTokens`）：
     ```ts
     if (event.type === "usage-update" || event.type === "completed") {
       const replaceOutput = this.protocol === "anthropic-native" && this.streaming;
       if (event.usage) this.usage = mergeTokenUsage(this.usage, event.usage, { replaceOutput });
       if (event.type === "completed") {
         this.usageComplete = this.usage?.outputTokens !== undefined
           && mergeTokenUsage(undefined, event.usage)?.outputTokens !== undefined;
       }
     }
     ```
   - 这样即便在「`stop_reason` 终态 delta 报 `50 / 无明细`，随后又出现一条无 `stop_reason` 的 delta 报 `60 / 10`」的极端流中，`message_stop` 发出的 `completed.usage`（`50 / undefined`）也会通过 `replaceOutput: true` 覆盖 `GenerationMeasurement` 中的 `60 / 10`，使最终保存指标严格等于终态确认值 `50 / undefined`（`usageComplete: true`）。

---

## 3. 三协议 DeepSeek 思考控制与思维链解码核验结论

经逐行核对 [thinking.ts](../src/chat/thinking.ts)、[requestMapping.ts](../src/chat/requestMapping.ts)、[responseThinking.ts](../src/chat/responseThinking.ts) 与 [transport.ts](../src/chat/transport.ts)，三协议生产代码已与 DeepSeek 官方文档对齐，**无需修改思考映射与解码生产代码**，通过确定性测试固化合同：

| 协议 | 请求映射核对 | 思维链与用量解码核对 | 需补充的 DeepSeek 回归夹具 |
| --- | --- | --- | --- |
| **Chat Completions** (`openai-chat`) | `default` 省略 `reasoning_effort` 与 `thinking`；`off → reasoning_effort: "none"`；`minimal/low/medium/high/xhigh/max` 原值透传（DeepSeek 映射 `minimal/low→low`、`medium/high/xhigh→high`、`max/ultra→max`），不发非标 `thinking` | 流式 `delta.reasoning_content` 与非流式 `message.reasoning_content` 按 `includeSummary` 路由；`completion_tokens_details.reasoning_tokens` 已解析；支持 `content: null` 仅思考截断 | DeepSeek 模型参数化 `default / off(none) / low / high / max`（及 `minimal / medium / xhigh`）映射断言；末帧同时携带 `finish_reason` 与 `usage` 的 DeepSeek 流式形态 |
| **Responses** (`openai-responses`) | `default`（无摘要）省略 `reasoning`；`off → reasoning.effort: "none"`；`low/high/max` 映射 `reasoning.effort`；`includeSummary: true` 附 `summary: "auto"`（DeepSeek 文档明确接受且静默忽略）；保持 `store: false` | `ResponseThinking` 已按 `item.id` + `summary`/`content` + `index` 独立协调 `response.reasoning_text.delta/.done`、`response.output_item.done` 与终态 `output[]`，按 `sequence_number` 去重，忽略 `encrypted_content`；`output_tokens_details.reasoning_tokens` 已解析 | DeepSeek 模型 `default / off(none) / low / high / max` 映射；非流式官方形态省略顶层 `output_text`（由 SDK 从 `output[]` 合成，含仅思考 `incomplete:max_output_tokens` 空正文）与多 reasoning item 场景 |
| **Anthropic Messages** (`anthropic-native`) | `default` + `effort: "default"` 全省略；`default` + `effort: low/high/max` 仅发 `output_config.effort`；`off → thinking: { type: "disabled" }`（DeepSeek 显式 `thinking.type` 优先于 `output_config.effort`）；`adaptive`（按 `enabled` 处理）与 `budget`（`type: "enabled"`，`budget_tokens` 被忽略）均支持独立 `output_config.effort` | 流式按 block index 路由 `thinking` 块与 `thinking_delta`，忽略 `signature` 与 `redacted_thinking`；非流式读取 `thinking` 块；本次补齐 `output_tokens_details.thinking_tokens` → `reasoningTokens` | DeepSeek 模型 `default+effort` / `off`（含带 `effort` 时仍发 `disabled`）/ `adaptive+effort` / `budget+effort` 映射；隐藏思考文本（`includeSummary: false`）下仍正确记录 `reasoningTokens` |

---

## 4. 数据契约、UI 与文档同步范围

- **数据契约与备份**：`TokenUsage.reasoningTokens` 已在 [types.ts](../src/chat/types.ts#L37)、[dataPolicies.ts](../src/storage/dataPolicies.ts#L50)（`"backup"`）与 [generationMetricsData.ts](../src/chat/generationMetricsData.ts#L30-L31) 中全协议注册并校验。**零表变更、零偏好变更、零备份版本变更、零迁移变更**。
- **UI**：[GenerationStats.tsx](../src/ui/chat/GenerationStats.tsx#L65) 已展示 `["思考 Token", count(usage?.reasoningTokens)]`，无需改动 UI 组件与样式。
- **文档同步**：
  1. [docs/PROTOCOLS.md](PROTOCOLS.md#L82-L85)：在 `#107` 统计段落补记 `#143` 对 Anthropic `output_tokens_details.thinking_tokens` 及输出/思考成对终态合并规则；
  2. [docs/PROTOCOLS.md](PROTOCOLS.md#L273-L277)：保留 2026-09-21 历史记录上下文，同时补充 2026-11-26 `#143` 更新说明——DeepSeek 现行 Chat Completions 文档已确认省略 `thinking` 时 `reasoning_effort: "none"` 可直接关闭思考，避免继续误导后续开发者；
  3. [docs/ISSUE-107-IMPLEMENTATION.md](ISSUE-107-IMPLEMENTATION.md#L7-L14)：在协议字段表 Anthropic 行补充 `#143` 备注（`output_tokens_details.thinking_tokens`）；
  4. [docs/PLAN.md](PLAN.md)：在本地实现与全量门禁完成后补记 `#143` 实施摘要（开工前不提前写入完成状态）。

---

## 5. 确定性测试与验收门禁计划

### 5.1 测试用例清单

| 文件 | 必覆测试场景 |
| --- | --- |
| [src/chat/usage.test.ts](../src/chat/usage.test.ts) | 1. Anthropic `output_tokens_details.thinking_tokens`：正整数、显式 `0`、等于 `output_tokens`、缺失 `output_tokens_details`、仅含 `safety_tokens`（`reasoningTokens` 为 `undefined`）；<br>2. 非法与越界：负数、小数、字符串、非安全整数、`output_tokens_details` 非对象、`thinking_tokens > output_tokens`（仅丢弃 `reasoningTokens` 保留 `outputTokens`）；<br>3. 同帧 `output_tokens` 非法（如 `-1` / `"5"`）时丢弃同帧 `thinking_tokens`；<br>4. `mergeTokenUsage(..., { replaceOutput: true })`：新有效 `outputTokens` 同步清除或替换旧 `reasoningTokens`，无有效 `outputTokens` 时保留旧一对；累计替换非叠加；结果通过 `readGenerationMetricsData`。 |
| [src/chat/usageTransport.test.ts](../src/chat/usageTransport.test.ts) | 全量串联 `AnthropicNativeTransport` 与 `GenerationMeasurement`，同时断言 `usage-update`、`completed.usage` 与 `measurement.snapshot(...)`：<br>1. 标准 DeepSeek 流式：`message_start`（`output_tokens: 0`）+ 终态 `message_delta`（重复 `input_tokens`/`cache_*` + `output_tokens` + `output_tokens_details: { thinking_tokens, safety_tokens }`）+ `message_stop`，确认非叠加且 `usageComplete: true`；<br>2. 多 delta 边界（前帧 `20/5`）：`→ 50/缺失`（终态 `50/缺失`、`usageComplete: true`）、`→ 50/99`（终态 `50/缺失`、`usageComplete: true`）、`→ 50/0`（终态 `50/0`、`usageComplete: true`）、`→ 无 usage`（`completed` 无输出/思考，指标 `20/5`、`usageComplete: false`）、`→ -1/18`（不产生 `20/18`，指标 `20/5`、`usageComplete: false`）、`stop_reason` 报 `50/缺失` 后又来无 `stop_reason` delta `60/10`（最终指标 `50/缺失`、`usageComplete: true`）；<br>3. 早期 `input_tokens` + 终态 `output_tokens` 溢出 `MAX_SAFE_INTEGER`：`completed.usage` 移除 `outputTokens` 时同步移除 `reasoningTokens`，`usageComplete: false`；<br>4. 中途 `error` 带 `usage`（含 `thinking_tokens`）保留部分用量；`refusal` 终态（流式与非流式）含 `thinking_tokens + safety_tokens` 正常保留 `reasoningTokens`；<br>5. 隐藏思考文本（`includeSummary: false`）下仍正确记录 `reasoningTokens`；<br>6. 非流式（含正数、`0`、越界 `> output_tokens`）与流式一致。 |
| [src/chat/thinking.test.ts](../src/chat/thinking.test.ts) | 1. Chat Completions：DeepSeek 模型参数化覆盖 `default`（省略）、`off`（`reasoning_effort: "none"`）、`minimal/low/medium/high/xhigh/max` 原值发送且无 `thinking` 字段；流式末帧同时带 `finish_reason` + `usage`（含 `completion_tokens_details.reasoning_tokens`）与 `reasoning_content`；<br>2. Responses：DeepSeek 模型覆盖 `default`、`off`（`reasoning.effort: "none"`）、`low/high/max` + `store: false`；流式 `response.reasoning_text.delta/.done`、双 reasoning item、非流式省略顶层 `output_text`（带 `object: "response"` 由 SDK 合成）及仅思考 `incomplete:max_output_tokens`；<br>3. Anthropic：DeepSeek 模型覆盖 `default+effort`、`off`（含带 `effort`）、`adaptive+effort`、`budget+effort` 及流式/非流式 `thinking` 块。 |

### 5.2 实施后验收门禁
```powershell
npm.cmd run check
cargo check --manifest-path src-tauri/Cargo.toml
git diff --check
git status --short --branch
```
- 实施完成后另行执行独立只读复核；真实 DeepSeek 官方/中转线路行为留待用户单独授权实测，不以本地确定性测试替代远端 Issue 关闭。

---

## 6. 独立设计复核记录（2026-11-26）

- **复核方式**：通过 `codex-review`（只读沙箱）对照本地干净基线 `dev@fb0383d` 源码、基线 6 个相关测试文件（168 项全通过）及内存合成 SSE 复现验证，并由主代理逐项独立核实源码与官方文档后吸收修订：
  - **已确认并吸收的 A 类项**：
    1. **P2（流式思考 Token 跨帧残留）**：核实 `usage.ts` L58–L65、`generationMetrics.ts` L37–L40 与 `GenerationStats.tsx` L95 确存在早期 delta 旧 `reasoningTokens` 混入终态及同帧 `-1/18` 跨帧拼接问题，已修订为 Anthropic 输出成对替换 + 同帧非法 `output_tokens` 守卫 + `GenerationMeasurement` 同步处理；
    2. **P3（过时协议文档）**：核实 [PROTOCOLS.md L273](PROTOCOLS.md#L273) 仍写着 2026-09-21 旧口径“DeepSeek Chat 关闭思考要求 `thinking.type=disabled`”且 [#107 字段表](ISSUE-107-IMPLEMENTATION.md#L7-L14) 未含 `thinking_tokens`，已纳入本次文档同步。
  - **已吸收的 B 类工程建议**：补齐 `message_stop` 溢出联动清理 `reasoningTokens`、Chat 末帧同带 `finish_reason+usage`、Responses 非流式无顶层 `output_text` / 仅思考截断、Anthropic 隐藏思考仍统计 Token、以及中途 `error` / `refusal` 含用量用例。
  - **C 类产品边界**：双方确认无新增产品决策。
- **实施阶段复核修订（2026-11-26）**：实施后经两轮 `codex-review` 独立只读复核，进一步收紧两处边界并同步至本设计案与代码：
  1. `normalizeTokenUsage("anthropic-native")` 统一要求同帧存在合法 `outputTokens` 才采信 `output_tokens_details.thinking_tokens`（同时拦截非法与省略 `output_tokens` 的帧）；
  2. `mergeTokenUsage(..., { replaceOutput: true })` 仅用于 Anthropic 流式路径（`transport.ts` 流式更新/`message_stop` 与 `GenerationMeasurement` 的 `streaming: true`），无条件剥离无 `outputTokens` 或溢出丢弃 `outputTokens` 后的附属 `reasoningTokens`（覆盖连续溢出场景），同时保持非流式单帧溢出保留部分观测与 `usageComplete: false` 的既有合同；`GenerationMeasurement.observe` 在 `completed` 时同步核验 `this.usage?.outputTokens !== undefined`，防止极端缓存溢出产生不可持久化的 `usageComplete: true` 快照。
- **范围声明**：本地确定性测试与只读代码审查不代表真实供应商/中转线路实测或远端 Issue 状态变更已完成。
