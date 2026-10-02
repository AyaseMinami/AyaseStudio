# #82 Tavily 与智谱搜索

2026-10-02 用户决定首批支持 Tavily 和智谱，在网络搜索设置写清 API Key／计费并增加默认关闭开关；未授权提交、推送或修改远程 Issue。此决定补充 #82 原先待确认的服务商范围。

## 使用行为

设置保留 Exa API／MCP，新增 Tavily 与智谱独立卡片。新卡片默认关闭、Key 为空；启用并保存后才出现在聊天工具栏及会话搜索下拉。关闭并保存立即隐藏，可保留 Key 和参数；未保存草稿不改变菜单。已选的服务关闭后保留会话原值并显示不可用，发送前阻止，不自动改选或回退。无效设置保持原始数据，新增选项隐藏并提示检查设置。

启用保存和测试要求非空独立 Key；关闭时允许空 Key 保存。设置明确显示免费额度、按量价格、获取 Key／官方文档链接、本机明文存储及查询发送目的地。测试只使用卡片草稿和固定公开问题，点击后才发起请求，可能扣费；页面加载、开关和保存不联网。

## 官方接口

- [Tavily Search](https://docs.tavily.com/documentation/api-reference/endpoint/search)：HTTPS POST `/search`，Bearer Key。Basic／Advanced 明确选择，`auto_parameters:false`、`include_answer:false`、`include_raw_content:false`，结果数 1–10。按 [官方计费](https://docs.tavily.com/documentation/api-credits)显示每月免费 1,000 credits，PAYG $0.008/credit，Basic 1 credit／次、Advanced 2 credits／次；套餐实际费用以账户为准。
- [智谱 REST Search](https://docs.bigmodel.cn/api-reference/工具-api/网络搜索.md)：HTTPS POST `/api/paas/v4/web_search`，Bearer Key，`search_intent:false`、`content_size:medium`。四种引擎：search_std／search_pro／search_pro_sogou／search_pro_quark；[官方指南](https://docs.bigmodel.cn/cn/guide/tools/web-search)对应 ¥0.01／0.03／0.05／0.05 每次。与 [Coding Plan MCP 搜索](https://docs.bigmodel.cn/cn/coding-plan/mcp/search-mcp-server)分开。查询最多 70 个 Unicode 字符，发送前报错，不截断；Sogou 上游请求 count=10，界面仍按选定 1–10 数量保留。

所有外部搜索使用当前用户文本，不生成额外搜索词。请求冻结对应 profile，搜索 Key 不混用聊天凭据或其他服务凭据；外部模式抑制模型原生搜索参数。Tavily／智谱共用 JSON 接收边界：30 秒总期限、2 MiB 响应预算、严格 UTF-8／JSON、禁止重定向、即时本地取消和固定脱敏错误。不重试、不自动切换服务、不保证远端取消。结果沿用来源去重、标题／摘录限额、最终上下文预算、引用及历史记录。

## 数据与兼容

偏好键仍 `ayase-studio.search.v1`，配置版本升为 3，含 exaMcp／exaApi／tavily／zhipu。每个 profile 版本仍 1；新字段 enabled、searchDepth／searchEngine 有穷枚举，注册在实际 FieldPolicy 和备份投影。纯克隆迁移 v1→v2→v3，旧 MCP／API 保持，新增空 Key 和关闭默认；普通读取零写入。未知版本、字段、安全及凭据结构拒绝，保留原始数据。

搜索备份模块 v3／最低读者 3 统一拥有新增配置、会话选择和历史 provider 标识；chat v2、session v1、Dexie v8、文档 v5／信封 v1 保持。文档 v4／v5 在原始 search 模块声明支持 v3 时才接受新增数据，重标版本前逐个检查助手、对话／创建配置、旧会话配置及递归轮次历史。v1–v3 文档仍按旧限制读取；旧双 Exa 配置仍可读。各处新增标识由搜索模块门禁保护，不过滤成默认值。

凭据不导出时四组 Key 都省略；恢复只保留本机对应服务 Key，不跨服务借用。恢复旧单／双配置保留备份未包含的本机 profile。完整 v3 配置且包含凭据的明确替换可修复损坏本机配置；先前原始值由日志保护，提交前失败精确回滚。不含 Key 的已启用备份可以恢复，其后实际发送仍要求配置 Key。合并／副本策略不覆盖本机网络搜索设置。

## 验证

### 交付前核对与暂缓（2026-10-02）

用户认可 UI 并授权提交／推送／关闭后，补充同意在共享改动交叉时等待供应商与绘图协议完成再交付。当前共享备份、存储和聊天文件仍有其他功能的持续修改，因此本次未提交、推送或关闭 #82。

交付核对的独立 Sol/high 只读复审未发现明确 #82 缺陷，7 文件／211 项定向测试通过。以 `4f79cb0` 为基线，仅抽取 #82 的 50 个文件或文件内相关改动，在忽略目录的独立候选副本运行完整 `npm.cmd run check`：16 项数据契约检查、139 个测试文件／2,325 项测试、TypeScript 与生产构建通过。这证明当时抽取的 #82 内容可独立通过前端门禁；后续合并交付仍需核对最新共同状态。此前 UI 阶段的工作区类型错误不属于这份独立候选内容。

### 后续 UI 整改（2026-10-02）

四张卡片改为紧凑、等高对齐的表单，相关参数和操作同行，说明收进既有圆形问号提示。费用摘要、获取 Key／官方文档入口、测试扣费提示保持可见。没有修改搜索协议、数据格式或保存行为。31 项设置页／帮助组件定向测试通过，覆盖提示聚焦、Escape 关闭、明文保存说明与详细价格可访问性，原有独立草稿、保存、测试、取消及链接行为回归通过。

Codex in-app 浏览器检查 1024×900 浅色和 420×900 深色：无页面或地址／Key 行横向溢出；输入及相邻控件高度均为 36px；Exa 卡片宽屏高 196px，Tavily／智谱约 285px。键盘可打开智谱计费说明，提示保持在视口内，Escape 关闭。只使用原有隔离夹具及合成数据，没有真实服务请求。

本轮 Rust check 通过。全量 `npm.cmd run check` 在数据契约类型检查阶段被同时工作区内的备份测试 TypeScript 错误阻断，独立 build 同样报备份测试类型错误（`generationMetrics.test.ts`、`restore.test.ts`）；本轮未修改这些文件，不将全量门禁记为通过。

确定性测试覆盖四服务／四聊天协议、独立凭据与原生搜索抑制、关闭及过长查询零消息写入、HTTP 错误／格式错误／响应预算／取消／超时／重定向、设置保存和菜单联动、迁移／备份模块原始门禁、凭据投影、旧备份部分恢复及日志回滚。独立 Sol/high 审查核心变更未发现明确缺陷。

[隔离验收夹具](../scripts/search82/README.md)挂载真实设置及两种聊天选择器，独立浏览器 origin／原生标识，只返回合成 HTTP 结果。Codex in-app 浏览器确认默认不显示两项、启用保存即时加入两种菜单、关闭隐藏且保留不可用选择、明确菜单选择、两家测试返回来源及关闭卡片仍可显式测试。浅色 1024×900、深色 420×900 检查均无横向溢出，费用／Key／智谱查询限制文案可读，控制台无错误。截图位于忽略目录 `.search82.local/browser-preview.png` 与 `.search82.local/browser-dark-narrow.png`，仅含合成凭据的掩码。

`npm.cmd run check` 完成：16 项契约检查、143 个测试文件／2,481 项测试及 TypeScript／生产构建通过。之后仅补充备份测试，当前 `search82.test.ts` 15 项全部通过，最终 TypeScript 检查通过。`cargo check --locked --manifest-path src-tauri/Cargo.toml` 与 `git diff --check` 通过；单独标识的 Tauri 入口编译完成并启动新进程，验收结束后停止。独立 Sol/high 核心审查及最终文档／夹具／用例复审未发现明确缺陷（最后相关 3 文件／43 项测试通过）。构建仍有既有大 chunk 提示。

真实服务 Key、收费请求、账户套餐／网络代理行为、原生 HTTP 实际请求及原生窗口交互未执行；不据合成结果宣称真实供应商验收。其他聊天并行的绘图变更保留，本任务未提交、推送或改动远程 Issue。
