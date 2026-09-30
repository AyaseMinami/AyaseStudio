# OpenAI Images 文生图（#85）

2026-10-01，本地 `dev` 实施。复用 #84 的任务、私有保存／恢复、大图、成果库、PNG 导出和参数复用；不修改聊天协议。用户另要求重新核对 GPT 与 Gemini 的尺寸／分辨率契约。原有未提交修改保留，未提交、推送、修改远端 Issue、打包或发布。

## 官方契约核对

来源于本日读取的 [OpenAI Image generation](https://developers.openai.com/api/docs/guides/image-generation)、[Images generations API](https://developers.openai.com/api/reference/resources/images/methods/generate)、[Gemini ImageConfig API](https://ai.google.dev/api/generate-content#ImageConfig) 和 [Gemini GenerateContent 绘图指南](https://ai.google.dev/gemini-api/docs/generate-content/image-generation#aspect_ratios_and_image_size)。接口文档不代表用户账户或中转的实测支持。

| 协议／模型 | 尺寸或分辨率 | 画质或限制 |
| --- | --- | --- |
| GPT Image 2.5 Sunburst／Flare（含 2026-09-08 快照） | 自动、推荐 1024×1024／1536×1024／1024×1536；自定义宽x高 | 自动、low／medium／high／xhigh／max |
| GPT Image 2 | 同样支持符合限制的自定义尺寸 | 自动、low／medium／high；没有 xhigh／max |
| 更早 GPT Image | 按具体模型支持的标准尺寸 | 通常到 high；不能把新模型自定义尺寸或高档位当成通用能力 |
| Gemini 3.1 Flash Image | 自动（省略时默认 1K）、512／1K／2K／4K | 支持扩展极端比例，具体像素随比例变化 |
| Gemini Pro Image | 1K／2K／4K | 标准比例；512 和极端比例不能当成通用支持 |
| Gemini 3.1 Flash Lite Image | 指南正文明确仅 1K | 指南表格同时有 512 列，文档存在不一致；不承诺 Lite 的 512 支持 |
| Gemini 2.5 Flash Image | 不提供 imageSize 分辨率选择 | 可选标准宽高比 |

GPT Image 2／2.5 自定义尺寸要求：两边为 16 的倍数、每边不超过 3840、长短边之比不超过 3、总像素 655360–8294400。高于 2560×1440 为实验性尺寸；这与 Gemini 的 4K 档位不是同一种参数，不能转换成通用分辨率。界面提供官方推荐／常用尺寸与自定义输入，非法值在任务登记和请求前阻止。

Gemini 继续使用仍在官方 API 参考中记录的 `generationConfig.imageConfig.aspectRatio/imageSize`，补足 14 个比例和字面值 `512`（不是 `512px` 或 `0.5K`）。指南部分语言示例已改用 `responseFormat.image`，本次没有同时发送两套字段或自动切换契约。扩展参数可由具体模型或中转拒绝；不静默丢弃或重试。

## 当前行为和边界

- 服务配置新增“OpenAI 绘图”，仅为 Images 文生图模型。选择协议由用户明确配置，不根据模型名称推断绘图能力；模型目录只复用 OpenAI 的只读 models 接口。绘图模型排除聊天、助手默认值、聊天连通性测试和旧格式备份／恢复。
- 一次 `POST /images/generations`，Bearer Key 仅进请求头，正文含模型、提示词、`n:1` 和 `output_format:png`；自动尺寸／画质省略。根地址默认 `/v1`，非空路径保持不变；设置预览与提交共用 `resolveOpenAIImagesEndpoint`。HTTPS 必须，拒绝 userinfo、查询／片段、重定向；原生 wrapper 禁止跳转。
- 当前支持 GPT Image 和返回相同 Base64 契约的兼容服务，显式 DALL·E 2／3 因不同参数契约未接入。没有 `response_format`、流式／部分图片、URL 下载、参考图编辑、聊天端点回退或自动重试。
- 响应读取有 90 MiB 上限，保留所有有效 `data[].b64_json`，1–8 张、每张 32 MiB、合计 64 MiB。请求 PNG；响应明确标记的 PNG／JPEG／WebP 可交由既有原生解码校验。空结果、URL-only、错误对象、异常 JSON、无效 Base64／格式和超限均失败；不显示或存储服务端错误原文、返回 URL、revised_prompt 和原始 JSON。
- 400 秒超时；HTTP 4xx 为失败，5xx／网络中断／发送后取消或超时为结果未知。不重发，不自动降级。保存失败只重试本地保存；旧任务恢复仍使用已有原图／清单。
- 冻结参数为按协议区分的类型：Gemini 任务只含宽高比／分辨率，OpenAI 任务只含尺寸／画质。草稿可同时保留两组，切换模型不覆盖另一组；旧 #84 草稿缺少 OpenAI 组时默认自动。复用仅回填对应组，无联网；数据库无需重写既有记录。

## 验证

最终前端全量 `npm.cmd run check` 通过 95 文件／1341 项测试、TypeScript 和生产构建，保留既有大 chunk 提示。`cargo check --locked --manifest-path src-tauri/Cargo.toml` 和 15 项 `drawing::tests` 原生文件回归通过。新离线协议测试覆盖映射、自动省略、所有画质、尺寸边界、响应预算、错误脱敏、超时／取消／重定向和零重试；交互／controller／repository 测试覆盖切换隔离、参数复用、旧草稿、保存与重启恢复、设置预览和旧备份阻断。最终 Git diff 检查无空白错误。

内置浏览器使用 `.drawing85.local/` 的隔离合成配置、真实协议 adapter／controller／Dexie repository／绘图和设置组件，替换 fetch 与原生文件边界。通过尺寸／max 选择、自定义输入、非法尺寸零提交、Base64 成功保存／自动大图、保存失败只重试本地（请求计数不增加）、URL 响应拒绝并保留旧预览、模拟 PNG 导出、复用参数零提交、两组草稿切换以及刷新恢复。实际设置组件预览 `https://example.invalid/v1/images/generations`，绘图模型不显示聊天测试／默认操作。

检查深色 1040×760／720×520、浅色 600×740：桌面双列，窄屏单列且可滚动到达参数／提交／预览，无页面横向溢出。截图保留于忽略目录 `.drawing85.local/drawing85-desktop.jpg` 和 `drawing85-mobile.jpg`。首次本地服务已停止造成连接拒绝，重启本次 Vite 后完成验收；临时 harness 的 HMR 重建 root 提示和只改 data-theme 造成的混合主题已通过重载及实际 appearance controller 纠正，未归作生产缺陷。

独立 Sol/high 审查发现原生不跟随的 3xx HTTP 响应被误分类为失败。两适配器已统一在发送后拒绝 3xx 并归为结果未知，补齐原生 wrapper 和 301／302／307／308 回归；复核无遗留可操作 #85 缺陷。独立定向测试 6 文件／142 项通过，主代理修正后再次完成全量检查。

`npm.cmd run tauri dev -- --config .drawing85.local/native-smoke.json --no-watch` 使用独立 identifier 和本地前端完成编译／进程／窗口启动检查，确认窗口标题 `Ayase Images isolated smoke`，随后仅停止本次隔离进程；未使用原生截图或桌面自动化。未读取真实 Key、调用真实供应商或中转；原生 HTTP、系统导出对话框、关闭交互和真实服务端支持仍待单独验收。
