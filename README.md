# Ayase Studio

本地优先的 AI 聊天与绘图桌面工作区。使用自己的 API Key，在一个应用里管理模型服务、助手、对话和绘图成果。

基于 **Tauri 2、React 和 TypeScript**，当前面向 **Windows x64**，处于 **Beta** 测试阶段。助手用于保存聊天预设和组织对话，应用不提供 Agent 或通用工具执行功能。

**[下载安装包](https://github.com/AyaseMinami/AyaseStudio/releases)** · [使用与开发文档](docs/README.md) · [反馈问题](https://github.com/AyaseMinami/AyaseStudio/issues)

## 下载与安装

前往 **[Releases 页面](https://github.com/AyaseMinami/AyaseStudio/releases)**，选择最新 Beta 版本，在 Assets 中下载 Windows x64 的 `*-setup.exe` 安装程序。

本文介绍当前 `dev` 分支的功能，可能包含尚未发布的更新；各安装包包含的功能以对应 Release 说明为准。

下载并运行 `*-setup.exe`。已有 NSIS 安装可使用新安装包覆盖升级，升级前请备份重要数据。配置了更新公钥的新版本默认在主界面就绪约 10 秒后检查更新，可在 **设置 → 常规 → 应用更新** 关闭；发现新版只提示，下载和安装需确认，也可在 **设置 → 关于** 手动检查。尚未包含更新功能的历史版本需要先手动安装一次。GitHub 的 Source code ZIP/TAR.GZ 是源码，不是安装包。当前发布包尚未进行 Windows 代码签名，Windows 可能显示 SmartScreen 提示；应用内更新使用独立的免费 updater 签名验证安装包。

## 主要功能

### 模型与连接

- 内置 OpenAI、Anthropic、Google、xAI、OpenRouter、DeepSeek、智谱、阿里云、月之暗面、火山引擎和 MiniMax 共 **11 家供应商**，提供可编辑的默认连接；也可添加自定义供应商和兼容服务。
- 聊天支持 **OpenAI Chat Completions、OpenAI Responses、Gemini 原生、Anthropic 原生**四种协议。一个供应商可管理多条连接，各自配置地址、API Key 和模型。
- 获取远端模型目录或手动添加模型，支持连接测试、模型搜索选择，以及供应商、连接的拖动排序。内置预设可编辑、删除和重新添加。
- 模型保留自动分组，并支持连接内自定义组、单个或批量调整归属；聊天模型选择器同步展示，分组可随连接配置备份恢复。

具体模型、思考、搜索、附件和绘图能力取决于协议及服务端支持；预填地址不代表账户已开通服务，也不保证所有中转线路兼容。

### 聊天与助手

- 助手保存新对话的默认模型、系统提示词和生成参数；每个对话拥有独立配置，后续修改助手不会覆盖已有对话。
- 支持跨对话并行生成、停止、自动命名，以及消息复制、编辑、重新生成、对话分支和最新一轮问答的候选版本切换。
- Markdown、LaTeX 和代码高亮；展示协议支持的思考内容、引用和来源。支持图片、PDF、文本/代码附件；Responses 还可发送 DOCX、XLSX、PPTX 原文件。
- 显示回复使用的模型，以及服务端提供的输入/输出 Token、缓存用量和请求计时；可查看首字时间、总耗时与平均生成速度。缺失的数据保持未知，不按正文长度补造统计。
- 助手、对话可排序；用户和助手支持自定义图片与头像库，助手未设置图片时可使用自动首字头像。
- 助手、当前助手的对话及供应商、当前供应商的连接支持多选和批量删除，空项同样需要确认；删除助手可选择保留对话并移至默认助手。

Office 文件仅显示文件信息，不在本地解析正文；候选版本切换仅保留最新一轮。生成统计不是费用账单，其可用字段取决于服务端返回。

### 独立绘图

- 独立工作区支持 **Gemini、OpenAI Images、Grok / xAI、Seedream / 火山方舟**的文生图与参考图编辑，按协议和明确版本提供相应参数。
- 参考图支持文件选择、拖入和粘贴，以及多图有序输入；提交时固定本批任务的提示词、参数和参考图，后续编辑不改变已提交任务。
- 同提示词批次支持 **1–99 项**、全局 **1–4 并发**，提供队列暂停、取消、任务日志与本地保存恢复。可能已经发送但结果不明的请求不会自动重发。
- 成果自动保存在本机，支持历史分页、大图预览、参数复用、普通 PNG 和显式带生成参数的 PNG 导出；纯文本提示词预设可独立保存和管理。

新选择的参考图仅保留在当前会话，重启后需要重新选择。连续编辑可将已有成果作为参考图再次提交；完整多轮图像编辑会话与恢复尚未提供。Gemini 返回文字的完整保存与展示仍在后续计划中。

### 联网搜索

- 可使用模型服务支持的原生联网搜索，或单独配置 **Exa API、Exa MCP、Tavily、智谱**外部搜索。
- 搜索记录与回复一起展示引用、来源和摘录；外部搜索的地址与 Key 独立于聊天连接。
- Exa API、Tavily、智谱需要各自的 Key；Exa MCP 的 Key 可选，匿名访问受服务端限流。Tavily、智谱默认关闭，启用并保存后才出现在聊天搜索菜单。

外部搜索会将本轮问题发送给所选搜索服务，再将检索资料交给当前模型；失败不会自动切换服务或接入方式。服务限制与配置说明见[协议文档](docs/PROTOCOLS.md)。

### 外观与桌面使用

- 浅色、深色、跟随系统，自定义配色、本地背景库、背景裁切与显示调整。
- 可调聊天宽窄和各区域背景透明度，聊天侧栏、输入框提供独立玻璃效果开关。
- 常规设置集中管理个人头像、后台运行与退出确认。开启后台运行时关闭主窗口会隐藏到托盘，任务继续运行；可从托盘恢复窗口、打开设置或明确退出。

后台运行和退出前确认默认开启，可分别调整；关闭普通退出确认不会跳过绘图未保存数据的保护提示。

### 导入、备份与恢复

- 导入支持范围内的 Cherry 聊天备份，提供预览、重复导入识别和附件恢复说明，详见 [Cherry 导入指南](docs/CHERRY-IMPORT.md)。
- 使用 `.ayase` 文件备份助手、聊天记录、已保存附件、头像、背景、连接及搜索配置，以及绘图设置和显式保存的提示词预设。
- 可选密码加密；恢复支持**合并、另存副本、替换**，先预览再确认，包含密钥的替换另需确认覆盖。

**Ayase 备份不包含绘图成果图片、任务历史、自动提示词草稿、参考图和未发送的聊天草稿。** 重要绘图成果请另行导出。备份范围、恢复策略和旧版本兼容说明见 [Ayase 备份与恢复](docs/AYASE-BACKUP.md)。

## 第一次使用

1. 打开 **设置 → 连接配置**，选择内置供应商和所需连接，或新建自定义供应商与连接。
2. 确认协议和 Base URL，填写自己的 API Key；获取模型目录或手动填写服务商提供的模型 ID。部分连接需要手动添加模型。
3. 返回聊天，选择模型并发送消息。需要复用角色和参数时，新建助手；需要单独调整当前对话时，打开对话配置。
4. 使用绘图时，先在连接配置中添加对应绘图协议和模型，再进入绘图工作区选择模型、输入提示词并提交。
5. 需要联网搜索时配置 **设置 → 网络搜索**，并在当前对话选择搜索方式。其他个性化设置位于 **常规**和**外观**。

应用不附赠模型或搜索额度，相关 API 费用由对应服务商收取。首条消息发送后，应用会使用同一模型额外请求一次简短标题，可能产生少量费用。

## 数据与隐私

聊天记录、配置、附件、头像、背景和绘图成果保存在本机。发送请求时，相关内容会发往你配置的模型或搜索服务；本地保存不意味着请求内容不会离开设备。

**API Key 当前以明文保存在本机，尚未加密。** 请保护设备和应用数据，使用可信服务地址，并优先使用 HTTPS。

当前备份导出包含连接和搜索 API Key，**加密开关默认关闭**。明文备份可直接读出密钥；需要密码保护时请启用加密并使用非空密码。密码不会保存，忘记后无法找回；备份加密不改变应用日常密钥的本机存储方式。

Beta 仍在迭代，升级前建议导出备份，并单独保存重要绘图成果。使用过早期开发版的用户，请先阅读[数据目录迁移说明](docs/DEVELOPMENT.md#application-identity-and-existing-development-data)。

## 从源码运行

Windows 环境需要 Node.js 与 npm、Rust 工具链、Microsoft C++ Build Tools（“使用 C++ 的桌面开发”工作负载）及 WebView2 Runtime，详见[开发环境说明](docs/DEVELOPMENT.md#supported-development-environment)。

```powershell
git clone https://github.com/AyaseMinami/AyaseStudio.git
cd AyaseStudio
git switch dev
npm.cmd ci
npm.cmd run tauri dev
```

`main` 为稳定基线，`dev` 为日常集成分支。首次 Rust 编译可能需要较长时间。`npm.cmd run dev` 仅启动前端页面，完整桌面能力需要 Tauri。

### 检查与打包

```powershell
# 数据契约检查、前端测试、TypeScript 检查与生产构建
npm.cmd run check

# Rust 测试与编译检查
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo check --locked --manifest-path src-tauri/Cargo.toml

# 构建 Windows x64 NSIS 安装包
npm.cmd run build:windows
```

安装包位于 `src-tauri/target/release/bundle/nsis/`，构建脚本另外保留带日期时间后缀的副本。自动测试使用模拟响应；真实服务测试需单独配置并可能产生费用，请勿提交密钥或 `.env.probe.local`。构建成功不等于全新安装、覆盖升级及数据保留已经验收。

## 文档与反馈

- [文档索引](docs/README.md)：使用指南、实现说明与验收记录。
- [开发指南](docs/DEVELOPMENT.md)：环境、验证、打包与排错。
- [架构说明](docs/ARCHITECTURE.md) · [协议合同](docs/PROTOCOLS.md) · [数据合同](docs/DATA-CONTRACTS.md)。
- [UI 约定](docs/UI-DESIGN.md) · [功能计划](docs/PLAN.md) · [领域术语](CONTEXT.md)。

通过 [GitHub Issues](https://github.com/AyaseMinami/AyaseStudio/issues) 反馈问题或建议，请附应用版本、复现步骤、预期与实际表现，以及必要的脱敏截图/日志，不要公开 API Key 或私人聊天内容。旧提案和模拟草图存放在[历史归档](docs/archive/README.md)，不代表当前功能承诺。

## 许可证

本项目自有源码和文档采用 [MIT License](LICENSE)，分发时须保留版权及许可声明。

第三方代码、字体、图标及其他素材适用各自的条款，详见[许可与资源归属说明](docs/THIRD-PARTY-LICENSES.md)和[锁定依赖清单](docs/THIRD-PARTY-DEPENDENCIES.md)。厂商标识不适用本项目 MIT，也不表示厂商背书；授权与分发待核实项已单独记录。Tauri 安装器模板保留其[上游 MIT 声明](src-tauri/windows/LICENSE-TAURI-MIT)。
