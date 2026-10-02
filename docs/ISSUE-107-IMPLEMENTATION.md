# #107 聊天生成统计

2026-10-02。范围依据 GitHub #107 及本次用户确认：统计随回复保存；参照 Harness 的位置，在输入框下方显示紧凑底栏。继续生成逐次记录，重新生成通过轮次历史保留旧统计。不增加全局累计、费用、Agent 步数或自动重试。

## 协议与来源

| 协议 | 输入与输出 | 缓存与思考 |
| --- | --- | --- |
| OpenAI Chat | prompt_tokens / completion_tokens / total_tokens；流式带 stream_options.include_usage | prompt_tokens_details.cached_tokens / cache_write_tokens；completion_tokens_details.reasoning_tokens |
| OpenAI Responses | input_tokens / output_tokens / total_tokens；终态取 response.usage | input_tokens_details.cached_tokens / cache_write_tokens；output_tokens_details.reasoning_tokens |
| DeepSeek Chat 兼容 | 优先标准计数 | 标准 cached_tokens 优先，兼容 prompt_cache_hit_tokens；miss 字段不单独转换 |
| Gemini 原生 | promptTokenCount；candidatesTokenCount + thoughtsTokenCount，或可验证的 totalTokenCount − promptTokenCount；totalTokenCount | cachedContentTokenCount / thoughtsTokenCount；无法确定时不补零 |
| Anthropic 原生 | input_tokens 为普通输入；已知时加 cache_read_input_tokens + cache_creation_input_tokens 得总输入；output_tokens 为累积输出 | 分别保留普通输入、缓存读取与写入；message_delta 累积更新不相加 |

官方合同：[OpenAI Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)、[Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)、[DeepSeek](https://api-docs.deepseek.com/api/create-chat-completion/)、[Gemini UsageMetadata](https://ai.google.dev/api/generate-content#UsageMetadata)、[Anthropic Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)。

参考实现仅用于统计语义和界面位置对照，不复制源码／文案／资产：本机 DeepSeek Harness `477b4f420553e8a52c2fbccc464d7561b239c443`；Hermes `5bba024d8ddd388f56f354c1f789be825e3d8a3c`；Cherry Studio `e2f53146eb6944718b091661df0854c75a4d933a`。官方字段为准。

`usage-update` 是累积字段快照，已返回字段合并替换；正文结束后的用量仍处理。无效／负数／溢出／矛盾计数保守舍弃，不让可选统计破坏有效回复。缺失不等于零，不按文字估算 token。

终态输出必须明确确认才能计算速度。Responses 缺少终态输出时保留早期观测为部分用量；Anthropic 仅确认携带 stop_reason 的末尾 message_delta 中有效 output_tokens。显式终态零值是已知零。停止／失败不认证最终用量。

## 计时与界面

从聊天 transport 调用前开始使用单调时钟，终态处理冻结。首字为第一个非空白正文增量；可见思考单独计时，隐藏思考不虚构可观察时点。非流式不报告首字。等待、思考、供应商搜索包括在请求总耗时内；外部检索、附件与本地上下文准备排除。

平均速度 = 最终输出 Token ÷ 请求总耗时；是端到端速度，输出可包含思考，不是纯正文解码速度。缓存命中率 = 缓存读取 Token ÷ 总输入 Token；分母缺失或为零时不可计算，近 100% 保留「<100%」避免假满命中。

底栏仅表示当前对话最近一次请求。点击向上展开各项原始计数、状态、耗时与解释，并可选择回复／请求。旧消息缺失指标时不显示；明暗主题、窄窗口、展开输入框沿用现有布局。

## 持久与备份

`generationMetrics` 指标 v1，缺失保持缺失；共享纯克隆读取入口用于仓库、SessionStore 和备份。未知结构在持久写入前拒绝，原始记录保留。每次请求关联捕获的对话 store，不随当前视图变动。重启对 streaming 指标递归恢复为 aborted，耗时保持最后保存值，不计算离线时间。

chat 模块 v2／最低读者 2；Dexie schema v8、备份文档 v5、信封 v1 保持。消息、轮次历史及嵌套用量有穷尽字段策略和真实备份投影；旧模块无统计仍可读，含统计而原始声明不支持的备份先拒绝后 restamp。没有新表、偏好、凭据或资源引用；回滚保留原数据。见 [数据合同](DATA-CONTRACTS.md)。

## 探测与接受边界

用户授权后，对其本机提供的中转站分别做四协议短流式请求，并重复一次，共 8 次，均 HTTP 200／正常结束。Chat 和 Responses 返回零缓存；Anthropic 读／写零；Gemini 缓存字段缺失，重复响应对 thoughtsTokenCount 的返回存在差异。原始返回差异不改写官方语义，没有正缓存命中证据。

用户随后要求停止探测，按文档及返回实施，长对话后续自行测试。本轮未再读取或发送测试 Key。探测脚本／凭据／报告仅存放被忽略的本机文件，不进入本记录、测试、Git 或外部系统。

## 确定性与验收

测试覆盖四协议普通／流式用量、空 choices 尾用量、失败／取消、非法计数、终态输出来源、非流式首字、对话切换、重新生成轮次历史、暂停续接、本机重载、备份恢复及旧版本／零写入拒绝。独立 Sol/high 审查已复查终态来源修正，无剩余确认缺陷。

[隔离验收入口](../scripts/usage107/README.md) 挂载真实组件，独立数据库和合成数据，无供应商请求。最终验证结果：

- `npm.cmd run check` 通过：数据合同静态检查 13 表／8 偏好／8 备份表及 16 个规则用例，132 文件／2134 测试，TypeScript 和生产构建通过；构建仍有现有大 chunk 提示。
- `npx.cmd tsc --noEmit -p scripts/usage107/tsconfig.json`、`cargo check --locked --manifest-path src-tauri/Cargo.toml`、`git diff --check` 和本地文档链接检查通过。
- 内置浏览器实际检查浅色／深色、零缓存／缺失用量／停止／非流式／旧消息、继续生成请求选择、Escape／外部关闭、刷新持久读取，以及 520px／390px 窗口和展开输入框。390px 展开时底栏底边 700px／视口高 720px，无水平溢出。发现并修正统计 wrapper 零 flex basis 挤出窗口的问题。
- 独立标识的 `npm.cmd run tauri dev -- --config scripts/usage107/native.config.json` 编译并启动 `target/debug/ayase-studio.exe`，随后停止本轮进程。仅为启动 smoke；未做原生截图／操作，未接受真实供应商、用户数据库、OS 文件窗口或完整桌面交互。
- 全量测试发现既有编辑后读取失败用例被新增编辑前校验提前触发；故障注入调整为真实提交之后，仍验证旧 transcript 不能复活。对保守舍弃输出的归一化测试明确标为部分用量，严格读者新增 input-only 不能认证最终输出的拒绝用例。

独立审查的终态用量来源及最后持久／布局修正已通过，文档版本汇总和 DeepSeek miss 未转换说明已同步。真实长对话和正缓存命中不以合成验收替代。没有提交、推送或远端 Issue 改动。

## 实测后的底栏修正（2026-10-02）

用户反馈首条请求开始后统计出现，使整个输入框上跳；悬浮入口还有整行白色背景。改为输入区始终预留固定底部槽位，统计在槽位内绝对定位：普通窗口 32px、窄窗口 52px。无指标时不显示文字，出现／更新／停止不会增加输入区高度；窄窗口允许两行，超出紧凑范围的内容通过详情查看。移除 hover／open 的整行背景填充，保留文字反馈、点击详情和键盘焦点框。

隔离内置浏览器验证：普通窗口旧消息／开始生成／完成／缺失用量／停止的输入框 top 均为 560.80px、bottom 均为 688px；390px 深色展开输入框的旧消息／开始生成／完成 top 均为 428px、bottom 均为 668px，槽位底边固定在视口 720px，无水平溢出。真实 hover 下计算背景为透明，点击仍可展开详情。组件状态切换均为合成数据，不发真实请求。

本次 `npm.cmd run check`（132 文件／2140 测试、数据合同、TypeScript、生产构建）、隔离入口 TypeScript、Rust check 及 diff 检查通过。该修正仅涉及布局与验收样例，不改变统计持久格式或供应商协议。

## 授权交付前验证（2026-10-02）

用户随后明确授权提交、推送并关闭 #107。共享工作区还有头像／导航、滚动条后续修改和文档重组，因此新提交按 Git 索引拆分：只包含 #107 的 41 个代码、测试、协议／数据／UI 文档和隔离验收文件；其他未提交改动保留。本节之前的「未提交／未推送」属于本地实施阶段记录，最终交付状态以 Git 历史及 Issue 验收评论为准。

从实际暂存候选导出独立验证快照（不复制本机凭据），`npm.cmd run check` 通过：125 文件／2047 测试、16 个数据合同规则测试、13 表／8 偏好／8 备份表覆盖、TypeScript 和生产构建。隔离入口类型检查也通过。独立 Sol/high 暂存审查确认 198 个相对导入和 159 个本地文档链接有效，无缺失依赖或无关改动；暂存 diff 检查通过。该计数与混合工作区的 2140 项不同，因为未交付的其他功能不在候选内。

## 说明入口优化（2026-10-02，交付后的本地跟进）

按用户后续反馈，将统计口径的说明移到紧凑底栏右侧独立问号圆圈图标，复用现有 `SettingsHelp` 的悬浮／键盘聚焦提示和 Escape 关闭行为。点击统计展开的面板仅保留具体数据、生成状态及回复／请求选择，不再附带说明段落。帮助按钮在 details 外部，不触发展开；底部固定槽位及透明入口背景保留。

针对性组件测试验证说明与数据面板分离、鼠标进入／离开、键盘聚焦／Escape 和帮助按钮不展开面板。隔离内置浏览器验证真实鼠标悬浮、浅色／深色及 390px 宽度，提示及面板均在视口内，无水平溢出，面板保留 12 项数据；旧消息／开始生成／完成的输入框 top 均为 560.80px、bottom 均为 688px。浏览器未出现控制台错误，未请求真实供应商或读取用户数据库。本次跟进尚未提交或推送。

共享工作区的 `npm.cmd run check` 在头像模块的未提交改动处遇到 `AssistantAvatar.test.tsx:120 TS2550` 和 `AssistantAvatar.tsx:34 TS18048`，未修改该模块。以当前 HEAD 加本次三个统计组件／样式／测试文件导出隔离快照，完整 check 通过：125 文件／2048 测试、16 个数据合同规则测试、13 表／8 偏好／8 备份表覆盖、TypeScript 及生产构建。共享工作区的针对性组件测试、隔离入口类型检查、Rust check 和 diff 检查通过。构建仍有现有大 chunk 提示。

用户进一步要求每个字段说明独立换行。提示改为输入 Token、输出 Token、缓存命中率、正文首字时间、思考首字时间、请求总耗时、平均速度、继续生成八个具名段落；通用帮助样式保留文本中的显式换行。针对性测试确认段落名称及分隔；内置浏览器实际验证换行样式为 `pre-line`，390px 深色视口下提示边界为 x=94–374px、y=228.40–678px，全部可见，无水平溢出。加入通用帮助样式后的隔离快照完整 check 通过（125 文件／2048 测试、数据合同、TypeScript 和生产构建）；共享工作区的针对性测试、隔离入口类型检查及 diff 检查通过。

2026-10-02 用户确认其他对话改动均已验证，授权与 #81 一起提交、推送和验收。本次包含上述说明入口／换行跟进；最终混合工作区完整 check 通过 136 文件／2168 项测试、数据合同、TypeScript 和生产构建，Rust check 与 diff 检查通过。此前的未提交描述属于当时阶段；#107 已关闭，不重复关闭。
