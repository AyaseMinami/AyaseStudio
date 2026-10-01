# Issue #101：绘图协议与 Gemini 可选参数

2026-10-01 用户授权继续本地实施，功能优先，暂不重新设计 UI。连接继续绑定模型与协议；绘图页选择模型，不新增临时协议切换。实现与验收完成后，用户追加授权提交并推送代码、记录验收通过并关闭 #101；未授权发布版本。

## 功能与数据合同

- Gemini 的 `gemini` 可选参数组包含 `temperature`、`safetyThreshold`、`outputMode`。temperature 缺失时省略，显式值须为 0–2 的有限数；0 保留，不以真假值丢弃。安全阈值默认省略；显式阈值统一作用于骚扰、仇恨、色情和危险内容四类，允许 BLOCK_NONE、BLOCK_ONLY_HIGH、BLOCK_MEDIUM_AND_ABOVE、BLOCK_LOW_AND_ABOVE、OFF。输出缺失默认 TEXT+IMAGE，也可显式 IMAGE。模型／中转不支持时直接展示既有脱敏错误，不删除参数重试。
- 参数保存在独立 Gemini 草稿组，提交时克隆到不可变任务／成果快照；切换 OpenAI 保留 Gemini 草稿组但不发送／导出它。复用 Gemini 历史只替换 Gemini 组；旧历史缺失该组时恢复服务默认和 TEXT+IMAGE，避免套用当前草稿的高级值。纯文本预设仍只保存正文及名称／身份／时间，不绑定高级参数。
- 沿用现有控件和折叠“Gemini 高级参数”入口。非法温度不持久化，显示错误并禁止当前 Gemini 提交；恢复默认、切模型或载入有效历史会清除旧错误。外部非法设置编辑不会写入；历史任务／成果新参数全部预检成功后才允许重启修复写入或文件恢复。
- 带参数 PNG 使用新增允许字段 `temperature`、`safety_threshold`、`response_modalities`，只写显式保存的选择，不填充模型默认值。Rust 用数值／枚举／数组校验，只允许 Gemini，未知字段仍拒绝。普通 PNG 仍不带生成元数据。
- Gemini 只保留非空提示词校验，移除借用的 32,000 字符上限。OpenAI generations／edits 对实际去边缘空白后的请求文本按 Unicode 码点计数，最多 32,000；组合字符分别计数，不声称按视觉字形计数。
- OpenAI 接受标准 `data[]` 与固定 GNBP 已支持的单对象 `data.b64_json`；数组保留所有图片。两协议响应只新增 CR/LF 换行和严格 PNG／JPEG／WebP Base64 data-URL 包装兼容，包装 MIME 必须与声明一致，OpenAI 缺失／旧 null 格式仍默认 PNG。URL-only 不下载。
- 原始编码长度在去换行之前有界；规范化后检查编码长度、标准字母表／padding／未使用位和解码字节数。每图 32 MiB、总图 64 MiB、最多 8 图及响应正文 90 MiB 保持；真实图片 MIME／完整解码／像素检查仍由原生保存层执行。参考图输入规则、原字节、TLS、代理和不自动重试合同不变。

## 版本、迁移与备份

绘图设置模块从 v1 升为 v2，新导出声明最低模块读者 2，防止旧读者误滤整组或改变有效安全／输出选择。备份文档 v5、加密信封 v1、Dexie schema v8 不变；绘图预设模块仍 v1。不新增表、偏好键、凭据或图片资源责任。

`dataPolicies.drawingDraft`、`drawingGemini`、排除的任务参数策略与实际备份投影同步。绘图读入口复用纯克隆基础和统一校验；旧无版本本机记录／旧设置模块 v1 缺失 Gemini 组时保持原行为，不进行语义转换或自动写回。v1 声明携带新增 Gemini 组拒绝；v2 恢复严格校验新字段。替换旧设置时移除本机新覆盖值；缺失整个绘图区／设置类别仍保留本机数据，合并／副本保持本机设置。

未来 v3 等只有声明当前可读时允许限定参数降级；普通未知可选参数报告路径，未知安全、输出模式／响应结构、凭据、路径和引用拒绝。Gemini 和 OpenAI 嵌套组均使用该边界。恢复不触发生成；私有日志仍保护原草稿，失败回滚。自动草稿 prompt、参考图、历史、图片不进入可移植包。

## 官方与 GNBP 再核对

本轮重新读取以下官方来源（2026-10-01），没有调用真实供应商：

- [OpenAI generations](https://developers.openai.com/api/reference/resources/images/methods/generate) 与 [edits](https://developers.openai.com/api/reference/resources/images/methods/edit)：提示词 32,000 字符、标准数组响应；编辑原文件 multipart 仍按既有合同发送。
- [Gemini GenerationConfig](https://ai.google.dev/api/generate-content#v1beta.GenerationConfig)：temperature 0–2、模型默认不同、responseModalities／imageConfig 字段；API 页面经 shell HTTPS 读取，浏览抓取超时不作为成功证据。
- [Gemini 3 temperature](https://ai.google.dev/gemini-api/docs/gemini-3#temperature)：推荐模型默认 1.0；Ayase 不注入固定 0.9 或自动探测。
- [Gemini 安全设置](https://ai.google.dev/gemini-api/docs/safety-settings) 与 [图像生成](https://ai.google.dev/gemini-api/docs/image-generation)：四类阈值、默认与模型差异、输出模式。阈值不承诺绕过全部服务规则或任意中转支持。

固定 GNBP 桌面 revision `0c07f22a3f7c2762cd0584ff702ceae7b9e07e09`：`core/api_client.py` 第 40–46 行发送四类 BLOCK_NONE、temperature 与仅 IMAGE；`core/gpt_client.py` 第 117–119 行接受数组首项或单对象；`core/utils.py` 第 51–53 行容忍包装与 CR/LF。Ayase 保留多图、有限严格包装和默认省略，不照搬首图截断、任意逗号剥离、关闭证书校验或强制无代理。没有新增 Android 专属生命周期规则；本项响应与参数对应上述桌面来源。

Gemini 保留 `x-goog-api-key` 头、TLS 校验、运行时正常代理策略和拒绝重定向；ImageConfig、模型特定尺寸提示、原参考字节保持。OpenAI 保留 output_format PNG、auto 尺寸／画质省略、准确原文件 MIME 和 FormData 自动 boundary；不添加新的输入上限、转换或压缩。

## 验证与边界

定向测试覆盖两协议默认／显式参数、无请求拒绝、旧缺失／当前记录、克隆快照和重载、历史复用、预设隔离、Unicode 边界、单对象／多图响应、规范化前后预算与损坏拒绝。绘图备份回归覆盖 v1 默认、v2 往返、三策略、未声明新组拒绝、未来普通参数报告、安全／输出结构零写入拒绝与既有日志回滚。

2026-10-01 本地验证结果：

| 验证 | 结果与范围 |
| --- | --- |
| `npm.cmd run check` | 16 项静态数据合同检查、113 个 Vitest 文件／1,820 项测试、TypeScript 与 Vite 构建通过；保留既有 bundle 大小提示。 |
| 审查修正后回归 | 历史数据启动预检与嵌套安全字段边界修正后，controller、drawingIntegration、DrawingWorkspace 三文件 110 项测试及构建通过；最后补充未来 Gemini 普通参数过滤案例后，drawingIntegration 53 项再次通过。 |
| Rust | `cargo check --locked --manifest-path src-tauri/Cargo.toml` 通过；drawing 定向测试 32 项通过。检查生成的样例 PNG：显式 temperature=0、阈值、IMAGE 元数据正确，普通 PNG 无参数元数据，旧参数导出与普通导出像素一致。 |
| 独立审查 | `comprehensive_reviewer` Sol/high 完成只读审查；启动零写入预检、未知安全／输出字段拒绝及复用后温度错误清除问题已修正并复核，无剩余可执行缺陷。 |
| 隔离浏览器功能验收 | 使用真实 controller、Dexie、DrawingWorkspace 与适配器，仅用独立合成数据库 `Drawing101-Synthetic-Acceptance-v2`，文件及 HTTP 边界模拟。确认显式 Gemini 参数映射、temperature=0、生成完成与历史复用；无效温度禁止提交，复用有效历史恢复提交；切换 OpenAI 不发送 Gemini 参数，单对象 CR/LF data-URL 响应保存成功；页面重载保留草稿与两协议成果；恢复默认后不发送 temperature／safetySettings，输出 TEXT+IMAGE。未读正式用户数据库或凭据。 |
| 隔离 Tauri 启动 | 独立应用 identifier `io.github.ayaseminami.ayasestudio.drawing101check` 和合成验收页面启动成功，确认本仓库 debug 进程，随后停止。仅编译及启动烟测，未把启动当成原生交互验收。 |
| 文档及差异 | 官方文档及固定 GNBP revision 重新核对；架构、协议、开发、数据合同、备份、计划与 UI 文档同步；普通 `git diff --check` 通过。 |

功能实现与 #101 要求的离线验收完成，UI 视觉设计延后。真实供应商／中转、系统文件窗口、实际桌面关闭重启及 #94 大图库压力不由离线样例、编译或启动代替；这些仍待相应验收。提交、推送及 Issue 关闭的最终远端结果记录在 #101 验收评论；本轮不发布版本。
