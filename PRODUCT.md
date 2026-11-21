# Product

<!-- impeccable:product-schema 1 -->

> **权威优先级声明**：本文件仅为设计工具读取的派生摘要，现行唯一权威 UI 规范为 [docs/UI-DESIGN.md](docs/UI-DESIGN.md)；任何冲突一律以 `docs/UI-DESIGN.md` 和用户当前明确指令为准。`docs/ISSUE-129-UI-PLAN.md` 保留为 `#129` 历史施工记录；当前工作树已落地 `#130` 视觉修订，最终视觉验收状态单独记录。

## Platform

web

## Product Purpose

Ayase Studio 是基于 Tauri 2、React、TypeScript 的 Windows 本地优先聊天与绘图工作区。用户使用自己的模型连接，管理助手、对话和绘图成果。助手是聊天预设及会话容器，不是 Agent。

## Operating Context

当前为 Windows 桌面 Beta。用户已长期使用并认可现有基础操作；UI 持续围绕工作区整体感、交互减噪与可读性演进，具体现行规则以 `docs/UI-DESIGN.md` 为准。

## Capabilities and Constraints

保留聊天工具位置、消息常显直接操作、两级导航及收起规则。设计修改不改变保存/取消、请求、队列、凭据、数据及删除保护。保留主题、壁纸、气泡、头像和可选玻璃。浏览器验收使用隔离合成状态，不请求真实供应商。

## Evidence on Hand

README.md、docs/UI-DESIGN.md、docs/DATA-CONTRACTS.md 和当前实现（历史记录见 `docs/ISSUE-129-UI-PLAN.md`，规范优先级见文首声明）。
