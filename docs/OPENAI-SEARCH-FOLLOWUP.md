# OpenAI 原生联网搜索：线路兼容性排查与必要修复

对应 [Issue #18](https://github.com/AyaseMinami/AyaseStudio/issues/18)。优先级：低。来自 #6 的后续项，不阻塞 #6 验收。

## 现象与已知边界

#6 已实现 OpenAI Responses 的 `web_search` 和 Chat Completions 的 `web_search_options` 请求映射、搜索事件与引用解析。Gemini 和 Anthropic 已由真实线路验证搜索与展示；OpenAI 尚未获得真实线路搜索成功的证据。

用户在 Cherry Studio 中使用向量引擎的 `gpt-5.6-sol` 时，回复表示没有联网工具。现有截图没有确认该次请求端点及完整请求体，不能认定为 Ayase 缺陷，也不能归因于 OpenAI 官方。官网聊天页面的工具行为不作为 API 兼容性证据。

## 后续工作

- 确认实际模型、协议和端点，脱敏记录请求工具字段及响应搜索事件。
- 区分 Responses 的 `web_search` 与 Chat Completions 搜索专用模型的 `web_search_options`；不能假定普通 GPT 的 Chat 接口支持原生搜索。
- 在用户授权的可用线路上做最小对比，定位客户端映射/解析、模型能力或中转透传差异；仅修复有证据的客户端问题。
- 若属于供应商限制，记录支持条件与明确结论，不增加猜测性兼容补丁。

## 验收标准

- [ ] 有脱敏请求/响应证据，可以说明失败发生在哪一层；无法确定时明确保留未知。
- [ ] 对可用的 OpenAI 线路验证搜索事件、来源和正文引用展示，不能仅以 HTTP 200 或模型自述为依据。
- [ ] 如有代码修复，只补充覆盖该缺陷的定向测试，记录实际验证范围。
- [ ] 保持 Responses `store:false`，不自动换模型、换协议或重试，不引入客户端工具搜索、MCP 或能力白名单。

测试问题使用“请实际使用联网搜索工具”，不指定必须使用 Google。真实请求另行获得授权；不得上传 Key、原始凭据文件或未脱敏日志。

## 参考

- [OpenAI Web Search](https://developers.openai.com/api/docs/guides/tools-web-search)
- [GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol)
- [#6 实施记录](https://github.com/AyaseMinami/AyaseStudio/blob/dev/docs/ISSUE-6-NATIVE-SEARCH-PLAN.md)
