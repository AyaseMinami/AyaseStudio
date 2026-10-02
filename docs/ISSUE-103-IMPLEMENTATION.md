# #103 Grok / Seedream 实施与验收记录

2026-10-02 用户授权本地实现 [#103](https://github.com/AyaseMinami/AyaseStudio/issues/103)。未授权提交、推送、关闭或真实供应商探针。

## 配置与使用

共享服务设置新增「Grok 绘图」「Seedream 绘图」，绘图模型不会进入聊天选择器。Grok 官方 Base URL 为 `https://api.x.ai/v1`；Seedream 为 `https://ark.cn-beijing.volces.com/api/v3`。根 URL 自动补对应前缀，自定义中转前缀原样保留；生成／参考图编辑预览与实际请求共享解析。Seedream 手动添加模型，未接入不明确的模型目录。

绘图页明确选择版本合同，不从模型 ID 或别名猜测能力，实际模型原样传递。不支持的已选参数保留供修正，发送前明确拒绝；自动值不发送。草稿分别保存四种协议参数，任务只冻结当前组，复用原目标不可用时保留参数并要求重新选择。

| 合同 | 基础选项 | 参考图 |
| --- | --- | --- |
| Grok legacy | 比例、1k／2k，自动画质 | 至多 5 张 |
| Grok 2.0 | 加入 21:9／5:2 和 low／medium 画质 | 至多 5 张 |
| Seedream 4.0 | 1K／2K／4K，默认格式 | 至多 14 张 |
| Seedream 4.5 | 2K／4K，默认格式 | 至多 14 张 |
| Seedream 5.0-lite | 2K／3K／4K，PNG／JPEG | 至多 14 张 |
| Seedream 5.0-pro／flash | 1K／1.5K／2K，PNG／JPEG | 至多 10 张 |

Seedream 自定义宽x高：4.0 总像素 921600–16777216；4.5／lite 为 3686400–16777216；Pro／Flash 为 921600–4624220，比例均在 1:16–16:1。水印可自动／开启／关闭。版本选择描述请求合同，线路是否真正匹配需服务商确认；不替用户自动换型号。

## 请求、成果与数据

Grok JSON generations／edits：单图 `image`，多图有序 `images`；Seedream 均用 generations，`image` 为单个 data URI 或数组。原字节、MIME、尺寸和透明通道不预处理。Grok `n:1`；Seedream 支持组图的合同明确发送 `sequential_image_generation: disabled`，Pro／Flash 不发送不支持的字段。应用批次和全局并发继续独立调度。

两家均请求 `b64_json`，顶层／图片项格式与 data URI 声明须和 PNG／JPEG／WebP 字节签名一致，再经原生完整解码验证保存。URL-only 不下载；无图、损坏、错误项、超过 8 张／单图 32 MiB／合计 64 MiB／响应 90 MiB 均拒绝。网络、超时、发送后取消、5xx 和重定向沿用结果未知规则，不自动重发；已返回图片的本地保存重试不发请求。

普通导出继续为无生成元数据的 PNG。明确带参数导出：旧 Gemini／OpenAI 保留 GNBP `parameters`；新协议只写 Ayase `ayase_parameters`，没有臆造 `api_type`。白名单包含提示词、模型、协议、版本及已设选项，排除 Key、服务地址、机器路径和参考图原件。

连接模块 v4（本机记录 v3）、绘图设置 v3／最低读者 3、排除历史 v2；Dexie v8、备份文档 v5／信封 v1 保持。缺失新组不写回，旧模块不能携带新结构。替换移除缺失新组，合并／副本保留本机设置；未知协议、凭据和安全／输出结构先于耐久写入拒绝。历史／图片仍受本机所有权保护，不加入 #93 未批准的图库备份范围。

## 官方依据

实施当天重新核对：[xAI generation](https://docs.x.ai/developers/model-capabilities/images/generation)、[editing](https://docs.x.ai/developers/model-capabilities/images/editing)、[multi-image editing](https://docs.x.ai/developers/model-capabilities/images/multi-image-editing)、[Seedream API](https://docs.volcengine.com/docs/ark/image-generation-api?lang=zh)、[Seedream 教程](https://docs.volcengine.com/docs/ark/seedream-4-0-5-0?lang=zh)。版本合同依据官方合同，不据此承诺任意中转。直接连续编辑使用上一轮成果；[xAI Responses 工具](https://docs.x.ai/developers/tools/image-generation) 保留会话上下文是独立能力，与 #102 协调。未找到 Seedream 图片接口等价会话续传合同；组图不代表多轮。

## 验证边界

确定性覆盖：两家生成／单图／多图、认证／endpoint／Content-Type／顺序、版本与数量限制、显式不支持参数、Base64／data URI／实际格式／预算、429／500／断网／超时／取消／无效响应。控制器覆盖冻结批次／重启不重发／复用／导出／所有权／本地保存失败；备份覆盖旧／当前模块、替换／合并／副本、源数据保留及拒绝零写入。原有 Gemini／OpenAI 和队列回归包含于全量门禁。

门禁：首次共享树 `npm.cmd run check` 全通过（2312 项测试）；最终新增限制／原生路由／连接备份测试后，隔离 #103 快照的完整门禁通过 141 个文件／2333 项测试、16 项数据契约检查、TypeScript 和 Vite 构建，fixture TypeScript 也通过。快照基于 `4f79cb0f063101fb08b190957277a7fd87666c2d` 加本项文件及共享文件的绘图改动，位于忽略目录 `.drawing103.local/check-scope`；只用于验证，没有新建 Git 分支／worktree。共享树在并行 Tavily／智谱开发期间通过 2331 项测试但随后构建遇到搜索类型错误，该结果不能冒充本项失败或全树门禁通过。最后一次共享树构建仍被 `WebSearchControl.test.tsx` 第 82／87 行的 `Element.hidden` 类型错误阻塞；并行代码保留。

最新 Rust 全量测试 147 通过／1 项既有本地样本测试忽略，`cargo check --locked` 通过。隔离 Tauri 两次编译启动成功，最后一次 16:46（本机时间）启动最新原生导出修正；不等于桌面交互或网络验收。独立 Sol/high 审查发现并修复 Seedream 官方数量检查及显式外协议字段遗漏，复核无遗留缺陷；原生 Grok legacy 新比例拒绝同步修正。

浏览器实测：Grok 2.0／5:2／2k／medium 双参考图生成成功，原字节／顺序计数通过，成果预览显示冻结参数；Seedream 5.0-lite／3K／PNG／关闭水印双图生成成功，切换深色展示成果和缩略图。切到 4.5 后已设置值保留，显示不支持格式并禁止生成。设置 fixture 中 Grok 地址详情正确展示生成／编辑路由；随后浏览器控制协议切换命令超时，该交互未宣称通过，Seedream 设置／手动添加／目录禁用由确定性测试覆盖。

2026-10-02，用户手动验证 #103 后确认通过，并授权关闭 Issue。具体供应商／中转环境及操作明细未单独提供，不额外推断覆盖范围。自动化过程中未读取真实 Key 或发供应商请求。完整会话状态／视频／高级图层能力未扩大到本项。代码仍在本地，按用户要求暂不提交／推送，稍后与并行开发一起处理。
