# Ayase Studio

轻量、纯净、不含任何 Agent 功能的桌面 Chat Bot 工具。在同一个工作区管理多家模型服务、助手预设和对话，使用自己的 API Key 连接模型。

基于 Tauri 2、React 和 TypeScript，当前以 **Windows x64** 为主要目标，处于 **Alpha** 阶段。

## 功能

- **多协议连接**：支持 OpenAI Chat Completions、OpenAI Responses、Gemini 和 Anthropic 原生协议；按供应商、连接、模型组织配置。
- **对话与助手**：助手提供新对话预设，每个对话可独立设置模型、系统提示词和生成参数；支持并行生成、停止和自动命名。
- **消息操作**：复制、编辑、重新生成、对话分支，以及最新一轮问答的版本切换。
- **阅读与附件**：Markdown、LaTeX、代码高亮，图片、PDF 和文本附件；Responses 连接另支持 DOCX、XLSX、PPTX 原文件输入。
- **思考与搜索**：提供协议对应的思考选项、思考内容展示和供应商原生联网搜索，支持引用与来源查看。
- **外观定制**：浅色、深色、跟随系统，自定义配色、透明度和本地背景。

具体能力取决于所选模型和服务端支持。Office 文件仅展示文件信息，不在本地解析或转换；版本切换仅保留最新一轮的候选问答。

## 开始使用

当前预发布版本：**[Alpha 3](https://github.com/AyaseMinami/AyaseStudio/releases/tag/v0.1.0-alpha.3)**。

**[下载 Windows x64 安装包](https://github.com/AyaseMinami/AyaseStudio/releases/download/v0.1.0-alpha.3/Ayase.Studio_0.1.0-alpha.3_x64-setup.exe)** · [所有版本与更新说明](https://github.com/AyaseMinami/AyaseStudio/releases)

运行下载的 `*-setup.exe` 安装；已有 NSIS 安装可覆盖升级，升级前请备份重要数据。安装包尚未进行代码签名，Windows 可能显示 SmartScreen 提示。GitHub 的 Source code ZIP/TAR.GZ 是源码，不是安装包。

1. 打开设置中的模型服务配置，创建供应商和连接。
2. 选择协议，填写 Base URL 与自己的 API Key，获取或手动添加模型。
3. 返回聊天，选择模型并开始对话；需要复用提示词和参数时，可配置助手预设。

服务商 API 费用由服务商收取。兼容接口或中转服务的支持情况以实际服务为准。

## 数据与 Alpha 注意事项

- 聊天记录、连接配置及保存的附件和背景存放在本机；发送消息时，相关内容会传给你配置的模型服务。
- **当前 API Key 在本机以明文保存，尚未加密。** 请保护设备和应用数据，仅连接可信服务，并优先使用 HTTPS。
- 首条消息发送后，会使用同一模型额外请求一次简短的对话标题，可能产生少量 API 费用。
- Alpha 版本仍在迭代，升级前请备份重要数据。使用过早期开发版的用户，请先阅读[数据目录迁移说明](docs/DEVELOPMENT.md#application-identity-and-existing-development-data)。

## 从源码运行

Windows 开发环境需要 Node.js 与 npm、Rust 工具链、Microsoft C++ Build Tools（“使用 C++ 的桌面开发”工作负载）及 WebView2 Runtime。环境参考与排错见[开发指南](docs/DEVELOPMENT.md#supported-development-environment)。

```powershell
git clone https://github.com/AyaseMinami/AyaseStudio.git
cd AyaseStudio
git switch dev
npm.cmd ci
npm.cmd run tauri dev
```

`main` 为稳定基线，`dev` 为日常开发分支。首次 Rust 编译可能需要较长时间。

### 验证与打包

```powershell
# 前端全量测试、TypeScript 检查与生产构建
npm.cmd run check

# Rust 单元测试与编译检查
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo check --locked --manifest-path src-tauri/Cargo.toml

# Windows NSIS 安装包
npm.cmd run build:windows
```

安装包输出目录：`src-tauri/target/release/bundle/nsis/`。构建成功不等于安装与升级验收通过，发布前仍需验证全新安装、覆盖升级和本地数据保留。

自动测试使用模拟响应，不调用真实模型。真实 API 探针的配置与费用说明见[开发指南](docs/DEVELOPMENT.md)；请勿提交密钥或 `.env.probe.local`。

## 文档与反馈

- [开发指南](docs/DEVELOPMENT.md)：环境、命令、数据迁移与验证。
- [架构说明](docs/ARCHITECTURE.md)：模块边界、状态与持久化。
- [协议说明](docs/PROTOCOLS.md)：地址解析、请求映射与兼容性约定。
- [UI 约定](docs/UI-DESIGN.md) · [功能计划](docs/PLAN.md)

问题和建议请提交到 [GitHub Issues](https://github.com/AyaseMinami/AyaseStudio/issues)。反馈时请附应用版本、复现步骤和必要的脱敏日志，避免包含 API Key 或私人聊天内容。

## 许可证

本项目采用 [MIT License](LICENSE)，允许使用、修改、分发和商业使用，分发时须保留版权及许可声明。软件按现状提供，不作担保。

第三方依赖与素材遵循各自的许可证；仓库内的 Tauri 安装器模板保留其[上游 MIT 声明](src-tauri/windows/LICENSE-TAURI-MIT)。
