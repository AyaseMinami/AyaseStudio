# #100 内置供应商与厂商头像

供应商默认名称按提供 API 的厂商／服务品牌统一为：OpenAI、Anthropic、Google、xAI、OpenRouter、DeepSeek、智谱、阿里云、月之暗面、火山引擎、MiniMax。连接继续使用 Gemini／千问／Grok／Kimi／Seedream 等模型系列名。此次仅修改内置显示名称，不变更稳定 ID、协议、地址，不自动改写已有用户命名。厂商归属参考 [Google Gemini](https://deepmind.google/models/gemini/)、[阿里云](https://www.aliyun.com/)、[火山引擎](https://www.volcengine.com/)；头像库继续按实际图标品牌标注。

2026-10-02 本地实施。当前对话确认方案优先于 Issue 原始设想。保留工作区中已验收但未提交的 #103，以及 #82 等其他改动；没有 Git 或远程交付授权。

## 已确认规则

- 首次应用初始化直接添加 11 家，不增加引导。旧供应商保持自定义，不按名称识别或合并；原 ID、Key、模型、顺序保持，默认项追加末尾。
- 内置供应商及连接可编辑、删除和拖动。初始化标记持久保存，删除不自动复活；“管理内置供应商”可以重新添加缺失项。
- 加号直接显示临时名称输入并聚焦；Enter／保存确认，Escape／取消丢弃，空名称不创建。新自定义供应商置顶，编辑不改变顺序。
- 默认连接仅预填名称、协议、官方地址，Key／模型为空。用户明确获取目录或手动添加模型；默认绘图连接含 OpenAI、Gemini、Grok、Seedream。
- 内置连接记录原始 `presetProtocol`，实际协议可自由修改。确认重置只恢复名称、协议、地址，保留 Key、模型、ID、排序；供应商名字和头像独立。
- 厂商图标进入共用只读离线头像库；可以选择任意内置图标或自有图片，头像不决定品牌和协议。恢复默认时，内置供应商使用原厂商图标，自定义使用首字和稳定颜色。助手／用户应用品牌图标沿用其独立图片快照合同。

## 32 条默认连接与官方来源

以下仅列现有适配器可表达的官方合同；账户权限、模型目录及计费请求没有实测。

| 供应商 | 协议与 Base URL | 官方来源 |
| --- | --- | --- |
| OpenAI | Chat／Responses／Images：`https://api.openai.com/v1` | [API](https://developers.openai.com/api/reference/overview)、[绘图](https://developers.openai.com/api/docs/guides/image-generation) |
| Anthropic | Native：`https://api.anthropic.com`；Chat：`…/v1` | [Chat 兼容](https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk)、[目录](https://platform.claude.com/docs/en/api/models/list) |
| Google | Native／Image：`https://generativelanguage.googleapis.com`；Chat：`…/v1beta/openai` | [兼容层](https://ai.google.dev/gemini-api/docs/openai)、[绘图](https://ai.google.dev/gemini-api/docs/image-generation) |
| xAI | Chat／Responses／Grok Images：`https://api.x.ai/v1` | [REST API](https://docs.x.ai/developers/rest-api-reference/inference) |
| OpenRouter | Chat／Responses：`https://openrouter.ai/api/v1` | [Responses](https://openrouter.ai/docs/api/api-reference/responses/create-responses) |
| DeepSeek | Chat／Responses：`https://api.deepseek.com`；Native：`…/anthropic` | [Responses](https://api-docs.deepseek.com/guides/responses_api/)、[Native](https://api-docs.deepseek.com/guides/anthropic_api/)、[目录](https://api-docs.deepseek.com/api/list-models) |
| 智谱 | Chat：`https://open.bigmodel.cn/api/paas/v4`；Responses：`…/api/v1`；Native：`…/api/anthropic` | [Chat](https://docs.bigmodel.cn/cn/guide/develop/openai/introduction)、[Responses](https://docs.bigmodel.cn/cn/guide/develop/responses/introduction)、[Native](https://docs.bigmodel.cn/cn/guide/develop/claude/introduction) |
| 阿里云 | Chat／Responses：`https://dashscope.aliyuncs.com/compatible-mode/v1`；Native：`…/apps/anthropic` | [地址](https://help.aliyun.com/zh/model-studio/base-url)、[Responses](https://help.aliyun.com/zh/model-studio/compatibility-with-openai-responses-api)、[Native](https://help.aliyun.com/zh/model-studio/anthropic-api-messages) |
| 月之暗面 | Chat／Responses：`https://api.moonshot.cn/v1`；Native：`…/anthropic` | [接口](https://platform.kimi.com/docs/api/overview)、[Responses](https://platform.kimi.com/docs/api/responses)、[Native](https://platform.kimi.com/docs/api/messages) |
| 火山引擎 | Chat／Responses／Seedream：`https://ark.cn-beijing.volces.com/api/v3`；Native：`…/api/compatible` | [地址](https://docs.volcengine.com/docs/ark/base-url-and-authentication?lang=en)、[Native](https://docs.volcengine.com/docs/ark/messages-api?lang=en)、[绘图合同](ISSUE-103-IMPLEMENTATION.md) |
| MiniMax | Chat／Responses：`https://api.minimax.cn/v1`；Native：`…/anthropic` | [Chat](https://platform.minimax.cn/docs/api-reference/text-openai-api)、[Responses](https://platform.minimax.cn/docs/api-reference/responses-create)、[Native](https://platform.minimax.cn/docs/api-reference/text-anthropic-api) |

当前 DeepSeek 文档使用根路径 Responses／目录；共用解析仅对精确 HTTPS 官方 origin 的 Chat／Responses 根地址保留根路径，显式 `/v1` 和其他地址的规则保持。目录解析保留明确 `/v3`、`/v4`、`/v1beta/openai` 前缀，设置预览与请求共用同一 seam。

千问 Native 无目录，默认配置提示手动添加；改实际协议或地址后不继续套用默认限制。Seedream 保持 #103 手动添加规则。DeepSeek／Kimi Native、智谱套餐及豆包目录证据不足时显示相应提示。Anthropic Chat 兼容层有官方生产使用限制，且目录鉴权不同，获取失败可手动添加。

[OpenRouter Anthropic](https://openrouter.ai/docs/api/api-reference/anthropic-messages/create-messages) 使用 Bearer，现有 Native 适配器使用 x-api-key，暂不加入默认连接，也不改鉴权协议。[OpenRouter 图片](https://openrouter.ai/docs/guides/overview/multimodal/image-generation) 及千问／智谱／MiniMax 图片合同不能伪装成现有绘图协议，暂不加入。自定义入口保持可用。

## 数据、资源与恢复

connections 模块 v5／最低读者 5，无新增 required capability；Dexie v9 增加 `providerAvatars` 并归属 connections。本机连接记录 v3、文档 v5／信封 v1 保持。表、偏好、嵌套字段均登记 FieldPolicy，并进入真实投影。共用头像库没有格式变更。

`presetId`、`avatar`、`presetProtocol`、`builtinsInitialized` 为可选严格字段。缺失表示旧自定义／未初始化；纯克隆读取不补厂商、不改协议、不写入。运行时显式初始化追加默认项，确定性 ID 避免旧供应商／连接／模型碰撞，保存一次标记。

供应商头像引用 `{kind:"builtin",id}` 或 `{kind:"image",id}`。前者为打包枚举；后者指向供应商独立、不可变图片快照，持有原图、缩略图、裁切，去掉可删除库的来源引用。共享严格克隆读取在仓库及导出前拒绝未知行／值／裁切字段和非法 Blob／MIME／尺寸，保留原数据。图片落盘后同步提交配置，整个操作阻止维护和竞争设置修改，配置保存成功才反馈成功。中断或替换遗留未引用快照保守保留，不自动 GC，不导出。

仅选择连接配置才导出其引用图片；没有引用时省略可选表。内置图标只备份稳定 ID，不复制图片；不含连接的恢复保留本机供应商图片。原始文档／模块声明先检查，随后兼容标准化；旧格式混入新字段必须拒绝，不能通过重标版本洗白。

replace／merge／copy 重映射图片、供应商、连接、模型 ID。merge 保留同 ID 本机供应商身份与头像；来源品牌不同的新连接保留实际配置，移除不适用的 `presetProtocol`。最终配置严格检查后进入恢复计划。replace 保留备份初始化标记，旧备份缺失时不制造标记；merge／copy 保留本机标记。失败日志回滚包含新表；旧日志未捕获新表时保留该范围。

头像来源、哈希、转换及使用说明见 [SOURCES.md](../src/avatar/brands/SOURCES.md)，随客户端打包，运行时不访问外部图片，没有使用第三方客户端资产。

## 验证记录

2026-10-02 全部改动交付前复验（用户已授权提交并推送当前全部代码，含 #82／#103）：`npm.cmd run check` 通过，数据契约 16 项、151 文件／2,609 测试、TypeScript／Vite 生产构建通过；Rust 测试 147 项通过、1 项依赖私有 Cherry 样本的测试按声明忽略，`cargo check --locked` 和 #103 fixture TypeScript 检查通过。独立 Sol/high 对合并改动审查未发现 P1／P2。内置浏览器重新验证自定义供应商 Enter 创建、11／11 PNG 及上传裁切透明通道、浅深主题、Tavily／智谱模拟搜索、Grok／Seedream 参考图模拟生成和原字节顺序检查。隔离 #100 Tauri 编译并启动成功。未调用真实服务，原生文件选择、安装／升级和用户数据重启验收不在本轮范围；本轮未关闭 Issue。Git 交付状态以实际提交和远端分支为准。

2026-10-02 追加透明头像调整：供应商／用户／助手实际图片及解码等待容器透明，裁切区域不铺底，正常内置 PNG 保存保留 Alpha；自动首字和旧具名默认回退色保持。内置图标去装饰底，最长边由 192 调为 216／256，显示留白由 12.5% 调为 7.8125%。五个单色图标适配明暗主题，独立头像快照保存选择时的颜色，不随主题改写。11 家来源／转换／新哈希见上面的资源记录，豆包仅执行用户明确许可的像素去底；不使用生成的人物。现有用户及助手快照不批量修改，无新增持久字段／表／版本。

本次最终完整检查通过：数据契约 16 项、151 文件／2,609 测试、TypeScript／Vite build、Rust check 与 diff 检查。独立 Sol/high 复核提出的主题捕获时序问题已修复，并用异步解码期间切换主题的测试验证，无剩余 P1／P2。内置浏览器实测 11／11 真实 PNG 快照透明、用户裁切保留 50% Alpha 像素、已配置图片容器透明、浅深单色适配、24px 供应商图标及 64px 共用库、选择应用及透明裁切预览。截图 `.providers100.local/transparent-avatar-library.png`；原生文件选择及旧用户快照未改写／未作交互验收。本次仅本地修改，未提交推送或更新远端。

确定性覆盖默认矩阵、重复读取／初始化、删除不复活、编辑／拖动、重置保留字段、图片独立、原始声明门禁、条件导出、三种恢复、来源冲突、零写入拒绝、失败回滚。独立 Sol/high 审查发现的两处 P2 已修复并补回归。[隔离 UI fixture](../scripts/providers100/README.md) 使用真实组件与合成内存状态，拒绝外部请求。

2026-10-02 最终 `npm.cmd run check` 通过：数据契约脚本 16 项、151 个测试文件／2,600 项测试、TypeScript 与 Vite build。`cargo check --locked --manifest-path src-tauri/Cargo.toml`、Git diff 空白及文档本地链接检查通过。完整测试数字包含当前工作区的 #103／#82 等改动，不代表这些工作已 Git 交付。

独立 Sol/high 最终复审无剩余 P1／P2，定向核对默认地址、来源冲突、未知字段、维护阻断、同步配置提交、延迟／失败／卸载及重置取消探测。Codex in-app browser 验证 680px 窄布局及 1040×760 双栏、浅／深色、加号直接聚焦、确认置顶、品牌图标选择、默认头像恢复与预览、失败反馈、协议修改及恢复默认字段。图标全部本地加载，原始旧数据及三种备份恢复由确定性测试验证。截图保存在忽略目录 `.providers100.local/avatar-library.png`。

隔离 Tauri 启动命令 `npm.cmd run tauri dev -- --config scripts/providers100/native.config.json --no-watch` 编译并启动成功，使用独立应用标识及合成 UI；只证明启动，未作原生交互验收。真实账户／模型目录／计费请求未执行；浏览器不替代原生文件选择、桌面重启和最终用户视觉验收。
