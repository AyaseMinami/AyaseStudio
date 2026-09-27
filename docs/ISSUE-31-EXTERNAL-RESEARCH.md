# Issue #31：Open WebUI 与 LibreChat 自动标题实现参考

核对日期：2026-09-27。以下只记录官方仓库固定提交中的可验证行为；链接固定到提交及行号，不把其他产品的策略直接当作 Ayase Studio 的需求。本文未复制其提示词或源码。

## Open WebUI

固定提交：[8bd8b4fac5e059578ac0c74b3c18d11139f88b7d](https://github.com/open-webui/open-webui/commit/8bd8b4fac5e059578ac0c74b3c18d11139f88b7d)。**已核实**：新会话先以 `New Chat` 入库；有助手消息占位时，服务端在首轮生成开始阶段用 `asyncio.create_task` 启动标题后台任务。因此自动标题不必等助手完整回复，且不阻塞主回复。[创建及调度](https://github.com/open-webui/open-webui/blob/8bd8b4fac5e059578ac0c74b3c18d11139f88b7d/backend/open_webui/main.py#L1299-L1304)、[入库与后台启动](https://github.com/open-webui/open-webui/blob/8bd8b4fac5e059578ac0c74b3c18d11139f88b7d/backend/open_webui/main.py#L1378-L1492)。

标题端点把会话消息套入标题模板，发出**独立、非流式**聊天生成请求。请求可使用专门配置的任务模型；未配置有效任务模型时使用传入的聊天模型。模板变量支持最后一条用户消息和消息列表。[标题请求](https://github.com/open-webui/open-webui/blob/8bd8b4fac5e059578ac0c74b3c18d11139f88b7d/backend/open_webui/routers/tasks.py#L141-L205)、[模型选择](https://github.com/open-webui/open-webui/blob/8bd8b4fac5e059578ac0c74b3c18d11139f88b7d/backend/open_webui/utils/task.py#L16-L27)、[模板变量](https://github.com/open-webui/open-webui/blob/8bd8b4fac5e059578ac0c74b3c18d11139f88b7d/backend/open_webui/utils/task.py#L304-L311)。首次后台任务从当前消息树构造输入；此时助手还是空占位，因此首发自动标题实质以用户输入为主。[消息树构造](https://github.com/open-webui/open-webui/blob/8bd8b4fac5e059578ac0c74b3c18d11139f88b7d/backend/open_webui/main.py#L1361-L1409)、[任务读取](https://github.com/open-webui/open-webui/blob/8bd8b4fac5e059578ac0c74b3c18d11139f88b7d/backend/open_webui/utils/middleware.py#L3832-L3887)。

**回退差异**：解析出标题就更新并广播；无标题且仅有首轮两条消息时，会把第一条用户内容写成标题。因此其部分失败或禁用路径会改写默认标题。这段写回也没有检查当前标题是否仍为默认值，不能据此声称保护手动改名。[写回与回退](https://github.com/open-webui/open-webui/blob/8bd8b4fac5e059578ac0c74b3c18d11139f88b7d/backend/open_webui/utils/middleware.py#L3939-L3999)。侧栏另有用户主动触发的“生成标题”，会取当前分支消息及模型再调用该端点；这是显式操作，不能与首轮自动调度混为一谈。[手动触发](https://github.com/open-webui/open-webui/blob/8bd8b4fac5e059578ac0c74b3c18d11139f88b7d/src/lib/components/layout/Sidebar/ChatItem.svelte#L440-L509)。

## LibreChat

固定提交：[3c72c3fb4a791855bdf7d30ea3c365ac0faaa370](https://github.com/danny-avila/LibreChat/commit/3c72c3fb4a791855bdf7d30ea3c365ac0faaa370)。**已核实，限 Agents 路径**：只在新会话的根消息且非临时会话考虑自动标题。默认 `immediate`：首次用户输入开始回复时并行生成标题，输入为用户文本（或附件文件名）；可配置 `final`：在助手回复完成后再启动，标题模型此时可得到回复内容部分。[资格与时机](https://github.com/danny-avila/LibreChat/blob/3c72c3fb4a791855bdf7d30ea3c365ac0faaa370/api/server/controllers/agents/request.js#L1005-L1009)、[首轮守卫](https://github.com/danny-avila/LibreChat/blob/3c72c3fb4a791855bdf7d30ea3c365ac0faaa370/api/server/controllers/agents/request.js#L2231-L2235)、[并行启动](https://github.com/danny-avila/LibreChat/blob/3c72c3fb4a791855bdf7d30ea3c365ac0faaa370/api/server/controllers/agents/request.js#L2659-L2675)、[完成后启动](https://github.com/danny-avila/LibreChat/blob/3c72c3fb4a791855bdf7d30ea3c365ac0faaa370/api/server/controllers/agents/request.js#L3171-L3198)、[标题输入](https://github.com/danny-avila/LibreChat/blob/3c72c3fb4a791855bdf7d30ea3c365ac0faaa370/api/server/controllers/agents/client.js#L6115-L6124)。

Agents 的标题调用是单独的 `generateTitle`，可选 `titleEndpoint`、`titleModel` 和标题方法；未另选模型则沿用当前模型。[模型与端点](https://github.com/danny-avila/LibreChat/blob/3c72c3fb4a791855bdf7d30ea3c365ac0faaa370/api/server/controllers/agents/client.js#L5985-L6029)、[单独调用](https://github.com/danny-avila/LibreChat/blob/3c72c3fb4a791855bdf7d30ea3c365ac0faaa370/api/server/controllers/agents/client.js#L6115-L6128)。标题失败或为空时不保存新标题；并行结果会等会话落库后持久化，并防止被后续流替代的旧结果写回。[生成、等待及丢弃](https://github.com/danny-avila/LibreChat/blob/3c72c3fb4a791855bdf7d30ea3c365ac0faaa370/api/server/services/Endpoints/agents/title.js#L92-L185)。**不能概括为全产品统一回退**：Assistants 路径在标题请求失败时会尝试以用户文本、附件名或回复截断成标题。[Assistants 回退](https://github.com/danny-avila/LibreChat/blob/3c72c3fb4a791855bdf7d30ea3c365ac0faaa370/api/server/services/Endpoints/assistants/title.js#L85-L116)。

## 对 Issue #31 的判断边界

两项目都证明“首条用户输入触发独立标题请求、可选任务模型、主回复无需等待标题”可行；LibreChat Agents 有明确的首轮守卫。**未核实**两项目都对“后台标题与用户手动改名同时发生”提供原子保护。上述写回代码没有展示“当前标题仍为默认值才提交”的比较条件；Ayase Studio 的默认标题资格、只触发一次、手动改名优先及失败保留默认值，应以 Issue #31 自身的验收要求实现和测试，不能由竞品代码推定。
