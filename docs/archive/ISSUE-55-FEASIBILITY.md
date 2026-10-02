# Issue #55：供应商详情连接列表可行性

> 已归档：历史可行性研究（2026-09-27），2026-10-02 归档。供应商连接列表已实施；下文“未实现”和样板进展仅描述当时阶段，当前入口见 [UI 约定](../UI-DESIGN.md)。

结论：**可在现有连接设置界面内实现**。供应商已经持有完整的连接数组，详情页已有入口，连接详情与删除回调也已存在；预期只需调整 React 渲染、局部样式和确定性测试，不需要新增存储结构或协议接口。本文件基于本地 `dev` 的 `0877d17` 和 `gh issue view` 读取的 [Issue #55](https://github.com/AyaseMinami/AyaseStudio/issues/55)；**未实现，也未运行验收测试**。

## 现状与最小方案

2026-09-27 样板进展：下文保留研究时的基线分析。已在 `ConnectionSettings.tsx` 和对应 CSS 中加入供应商连接列表、详情跳转、删除入口和空状态；删除确认补充协议与地址，从概览删除后焦点回到“添加连接”。按用户要求先做样板，本轮未运行测试、构建或浏览器验收，尚未完成 Issue 验收。

- Issue 要求在供应商详情列出全部连接，每项展示名称、协议、Base URL，可进入连接详情、明确目标地删除，并提供无连接空状态。[Issue #55](https://github.com/AyaseMinami/AyaseStudio/issues/55)；数据模型已有 `ProviderGroup.connections` 和连接的 `name`、`protocol`、`baseUrl`，供应商只是分组，不继承连接字段。[`PLAN.md`](../PLAN.md#L62-L95)
- 选择供应商时，组件将 `selectedConnectionId` 清空；目前右侧概览只显示供应商名称、说明与“添加连接”。在该概览直接遍历 `selectedProvider.connections` 即可展示完整列表，避免复制状态或查询持久层。[`ConnectionSettings.tsx`](../../src/ui/settings/ConnectionSettings.tsx#L372-L377)、[`ConnectionSettings.tsx`](../../src/ui/settings/ConnectionSettings.tsx#L505-L510)、[`ConnectionSettings.tsx`](../../src/ui/settings/ConnectionSettings.tsx#L1017-L1024)
- 每项显示连接名称、`getProtocolOption(connection.protocol).label` 和**原样输入的** `connection.baseUrl`；空地址用明确占位文案。现有详情的 `connectionHost()` 只提取主机名，不足以满足 Base URL 展示要求。协议标签映射已存在。连接行用真实按钮调用 `selectConnection(provider.id, connection.id)`，复用既有详情与未保存模型编辑确认，不改变默认模型。[`ConnectionSettings.tsx`](../../src/ui/settings/ConnectionSettings.tsx#L110-L119)、[`protocolOptions.ts`](../../src/chat/protocolOptions.ts#L9-L34)、[`ConnectionSettings.tsx`](../../src/ui/settings/ConnectionSettings.tsx#L582-L587)、[`PLAN.md`](../PLAN.md#L90-L95)
- 每行提供独立、具名的删除按钮或既有 `EntityActions` 菜单，调用现有 `handleDeleteConnection(provider, connection)`。该函数确认连接名称和连带模型数量，然后通过 `onDeleteConnection(connection.id)` 删除；同名连接应在新入口的可见信息或确认文案中以协议、Base URL 辨别目标。[`ConnectionSettings.tsx`](../../src/ui/settings/ConnectionSettings.tsx#L572-L580)、[`ConnectionSettings.tsx`](../../src/ui/settings/ConnectionSettings.tsx#L290-L293)
- `connections.length === 0` 时在详情中使用现有 `pane-empty-state` 风格，明确提示“还没有连接”，保留添加入口；列表样式沿用右侧 8px 卡片、浅深主题变量，并让长名称和 URL 可换行或截断且可查看完整值。窄屏两栏已在 44rem 以下改为单列，需检查列表不引入横向溢出。[`ConnectionSettings.css`](../../src/ui/settings/ConnectionSettings.css#L16-L36)、[`ConnectionSettings.css`](../../src/ui/settings/ConnectionSettings.css#L79-L93)、[`ConnectionSettings.css`](../../src/ui/settings/ConnectionSettings.css#L119-L127)、[`ConnectionSettings.tsx`](../../src/ui/settings/ConnectionSettings.tsx#L1009-L1013)

## 保持的行为与风险

- `isStreaming` 由应用的 `isAnyGenerating` 传入，新列表的删除入口必须沿用此禁用条件；底层 `removeConnection` 没有相同的界面门禁。[`App.tsx`](../../src/App.tsx#L119-L132)、[`ConnectionSettings.tsx`](../../src/ui/settings/ConnectionSettings.tsx#L826-L829)、[`useChatSession.ts`](../../src/chat/useChatSession.ts#L378-L390)
- 从供应商概览删除时 `selectedConnectionId` 为 `null`，既有删除函数在调用回调后会提前返回；概览仍会保留，但被删除的列表按钮消失，必须为此入口补充焦点恢复到相邻连接项或“添加连接”。左侧树也可能处于折叠状态，不应把焦点送到隐藏节点。[`ConnectionSettings.tsx`](../../src/ui/settings/ConnectionSettings.tsx#L572-L580)、[`ConnectionSettings.tsx`](../../src/ui/settings/ConnectionSettings.tsx#L815-L829)
- 现有删除流程先取消该连接的目录与模型测试请求，再更新并保存设置；领域层删除整条连接并修复无效的活动模型引用。已有会话若引用被删连接，其模型保持失效且请求被阻止，不应从列表另加自动切换或拒删规则。[`useChatSession.ts`](../../src/chat/useChatSession.ts#L192-L194)、[`useChatSession.ts`](../../src/chat/useChatSession.ts#L378-L390)、[`settings.ts`](../../src/chat/settings.ts#L688-L705)、[`App.test.tsx`](../../src/App.test.tsx#L1001-L1054)、[`PLAN.md`](../PLAN.md#L93-L95)

## 拟验收

在 [`ConnectionSettings.test.tsx`](../../src/ui/settings/ConnectionSettings.test.tsx#L81-L100) 增加多连接、空连接的组件测试：供应商详情展示每条连接的完整三字段；点击指定项进入原有管理详情；删除只传目标 ID，取消确认不删除，生成中禁用，删除后焦点落在可见控件；同名连接和长/空 Base URL 可辨认。保留现有折叠、选择与未保存模型编辑测试。[`ConnectionSettings.test.tsx`](../../src/ui/settings/ConnectionSettings.test.tsx#L81-L100)、[`ConnectionSettings.test.tsx`](../../src/ui/settings/ConnectionSettings.test.tsx#L118-L126)

实施后执行定向组件和 App 测试及默认代码检查（`npm.cmd run check`、`cargo check --manifest-path src-tauri/Cargo.toml`、`git diff --check`、`git status --short --branch`）；在浅色/深色及宽/窄窗口人工检查 URL 可读性、删除目标与焦点。当前纯文档研究只需内容、相对链接、diff 与状态检查。[`DEVELOPMENT.md`](../DEVELOPMENT.md#L248-L257)
