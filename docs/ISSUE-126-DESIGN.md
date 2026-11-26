# #126 全局整理字体大小与字体比例选择设计案

日期：2026-11-26。状态：**方案已定稿（1A + 2A + 3A），已通过 Codex 独立只读交叉复核，待另起对话实施**。

需求：[Issue #126](https://github.com/AyaseMinami/AyaseStudio/issues/126)。
依据：
- 仓库现行规范：[UI 设计规范](UI-DESIGN.md)、[数据合同](DATA-CONTRACTS.md)、[架构合同](ARCHITECTURE.md)、[备份说明](AYASE-BACKUP.md)；
- 前置底座：`#130` 第四阶段已在 [App.css](../src/App.css#L113-L120) 建立 `--font-scale` 乘数与 7 级语义字号变量。
代码基线：本地 `dev` HEAD `cd9b154`。

---

## 1. 目标、范围与非目标

### 1.1 实施范围
1. **全局字号层级梳理与零散硬编码归口**：核对并统一聊天、助手与对话列表、绘图、设置、弹窗、菜单、提示及空状态的文字层级，收口剩余非语义 `calc(...)` 与不齐整标题字号；明确并固化 6 类固定字号例外。
2. **外观设置新增全局字体比例选择**：在「设置 → 外观」新增「文字与字号」独立分组卡片，提供 5 档离散百分比选择、当前状态显示与独立「恢复默认（100%）」入口；切换即时生效至全部已打开页面与弹窗，启动首帧无闪跳回载。
3. **持久化、旧数据兼容与 `.ayase` 备份恢复**：按 [DATA-CONTRACTS.md](DATA-CONTRACTS.md) 将 `fontScale` 纳入 `AppearancePreferences`（`appearance` 模块升至 v5 / 最低读者 5），完成注册、穷尽字段策略、只读旧数据回填、原始模块声明预检、三策略恢复与失败回滚。
4. **布局防裁切、行高与控件适配**：治理全库固定 `rem`/`px` 行高与含文本固定高度控件，确保 5 档比例在浅/深主题、1280×900 宽窗与 720×520 窄窗下均无文字裁切、遮挡、入口不可达或横向溢出。

### 1.2 明确非目标
- 不包含字体家族选择、自定义字体导入、图片缩放或系统级 DPI/显示缩放。
- 不修改聊天消息原文、附件、生成参数或协议请求行为。
- 本地确定性测试与隔离浏览器视觉验收不替代 Windows 桌面微软雅黑实机观感验收与远端 Issue 关闭。

---

## 2. 已拍板产品决策（2026-11-26 确认）

| 决策项 | 定稿选择 | 明确规则 |
| --- | --- | --- |
| **字体比例档位与控件** | **1A**：5 档离散整数百分比 **`90 \| 100 \| 110 \| 120 \| 125`**（默认 `100`） | 外观页「文字与字号」卡片采用紧凑分段单选按钮（显示百分比）+ 当前比例标识 + 独立「恢复默认」按钮；写入 `:root` 时换算为 `--font-scale: <value / 100>`。存储用整数百分比，避免浮点精度与 canonical 对比问题。 |
| **持久化与备份归属** | **2A**：纳入 `AppearancePreferences`（`ayase-studio.appearance.v1`） | `dataPolicies.appearance` 注册 `fontScale: "backup"`，`appearance` 模块升至 **v5 / 最低读者 5**；与 `ayase-studio.chat-layout.v1` 一致随 `.ayase` 备份迁移。 |
| **重置按钮边界** | **3A**：主题/外观全局重置**保留**用户字号 | 「恢复方案配色」（`setColorPreset`）与「恢复当前主题默认外观」（`resetCustomAppearance`）均保留当前 `fontScale`；仅通过「文字与字号」卡片内的「恢复默认」按钮回到 `100%`。 |

---

## 3. 语义字号基线、归口清单与固定例外

### 3.1 语义字号基线（[App.css](../src/App.css#L113-L126)）
保持 `:root { font-size: 16px; }` 固定不变（防止 `rem` 布局尺寸膨胀失控），7 级语义变量继续按 `calc(<base-rem> * var(--font-scale))` 派生：

| 变量 | 基准（100%） | 90% | 110% | 120% | 125% | 适用角色 |
| --- | --- | --- | --- | --- | --- | --- |
| `--font-caption` | `0.75rem`（12px） | 10.8px | 13.2px | 14.4px | 15px | 辅助说明、角标元数据、统计小字、次级徽标 |
| `--font-small` | `0.8125rem`（13px） | 11.7px | 14.3px | 15.6px | 16.25px | 思考摘要、次要正文、按钮文字、紧凑侧栏标题 |
| `--font-ui` | `0.875rem`（14px） | 12.6px | 15.4px | 16.8px | 17.5px | 常规界面正文、列表项、设置项标签、表单输入 |
| `--font-message` | `0.9375rem`（15px） | 13.5px | 16.5px | 18px | 18.75px | 用户/助手聊天消息正文、历史消息编辑框 |
| `--font-section` | `1rem`（16px） | 14.4px | 17.6px | 19.2px | 20px | 卡片标题、分组标题、区块标题 |
| `--font-dialog-title` | `1.25rem`（20px） | 18px | 22px | 24px | 25px | 弹窗标题 |
| `--font-title` | `1.375rem`（22px） | 19.8px | 24.2px | 26.4px | 27.5px | 页面主标题 |

### 3.2 残留散落字号归口（共 4 处）
全库静态扫描未发现 Tailwind `text-*` 工具类或静态 SVG `<text>` 散落；以下 4 处归口至对应语义变量：
1. [ConnectionSettings.css](../src/ui/settings/ConnectionSettings.css#L212) `.connection-tree-heading`：由 `calc(0.9375rem * var(--font-scale))` → `var(--font-section)`（连接工作台区块标题）。
2. [ConnectionSettings.css](../src/ui/settings/ConnectionSettings.css#L265) `.provider-overview-identity h3` 与 [L319](../src/ui/settings/ConnectionSettings.css#L319) `.connection-provider-detail > h3`：由 `calc(1.1rem * var(--font-scale))` → `var(--font-section)`。
3. [ModelPicker.css](../src/ui/chat/ModelPicker.css#L401) `.chat-model-picker-custom-badge`：由 `calc(0.6875rem * var(--font-scale))` → `var(--font-caption)`（与同弹窗 `.chat-model-picker-protocol-badge` 一致）。
4. [AboutSettings.css](../src/ui/settings/AboutSettings.css#L8) `.about-update-heading h3`：由继承 14px → `var(--font-section)`（与其他设置页卡片标题层级一致）。

另核查 `body` 与表单默认继承链（[App.css](../src/App.css#L125-L126)）：确保所有可见正文与未显式指定字号的表单/提示容器均使用语义字号变量，不意外停留在固定 `16px`。

### 3.3 Markdown、代码与公式缩放规则
- 聊天正文使用 `var(--font-message)`，思考摘要使用 `var(--font-small)`。
- Markdown 标题（`h1: 1.45em`、`h2: 1.26em`、`h3: 1.12em`、`h4–h6: 1em`）、行内代码（`0.85em`）、代码块（`0.84em`）、引用角标（`0.72em`）与 KaTeX 公式（KaTeX 内置 `1.21em`）均保持相对 `em`，自动随父级语义字号等比缩放，不二次叠加 `--font-scale`。
- 代码块工具栏使用 `var(--font-caption)` 同步缩放；表格、代码块与长公式保留既有横向滚动能力。

### 3.4 明确 6 类固定字号例外
1. `:root` 的 `16px` 根基准；
2. Markdown / 代码 / 引用角标 / KaTeX 的相对 `em` 倍率；
3. 固定容器尺寸内的头像首字与旧版 Emoji（`.assistant-avatar-initial` / `.assistant-avatar-legacy`，见 `AssistantAvatar.css`、`App.css`、`AssistantConfig.css`、`ConnectionSettings.css`、`ModelPicker.css`）；
4. 绘图 56px / 76px 缩略图内的序号角标（[DrawingWorkspace.css](../src/ui/drawing/DrawingWorkspace.css#L285) `10px` 与 [L470](../src/ui/drawing/DrawingWorkspace.css#L470) `11px`）；
5. 固定尺寸独立视图：
   - **外观 1920×1080 缩放舞台预览**（`.appearance-preview-stage`，同时被外观页与 [BackgroundLibraryDialog.tsx](../src/ui/settings/BackgroundLibraryDialog.tsx#L175) 复用）：**注意 CSS 自定义属性求值陷阱**——`--font-message` 已在 `:root` 代入根 `--font-scale` 计算，后代仅写 `--font-scale: 1` 不会重算 `--font-message`。必须在 `.appearance-preview-stage` 内对 `.user-bubble-preview` / `.assistant-bubble-preview` 显式设为固定 `15px`（或局部重声明 `--font-message: 15px`），防止 1080px 舞台溢出；
   - **240×147px 托盘弹窗**（[tray.css](../src/tray/tray.css#L51) `13px` / `11px`）；
6. **Gemini 搜索建议沙箱 `iframe`**（[SearchResults.tsx](../src/ui/chat/SearchResults.tsx#L47-L147)）：使用独立 `srcDoc` 与服务端内联样式，维持既有沙箱与 CSP 边界，不穿透改写其字号。

---

## 4. 外观页 UI、状态与错误处理设计

### 4.1 「文字与字号」分组卡片（[AppearanceSettings.tsx](../src/ui/settings/AppearanceSettings.tsx)）
- **位置**：置于「主题与配色」卡片之后、「自定义配色」卡片之前，使宽窗下用户打开外观页即可与右侧「实际字号阅读效果」同屏实时对照。
- **结构**：
  - 标题行：`文字与字号` + `SettingsHelp` 简要说明（说明仅缩放应用文字，不改变图片缩放、图标尺寸或系统显示缩放）+ 右侧「恢复默认」按钮（当前已为 `100%` 时仍可明确识别或保持低干扰态，与「恢复方案配色」一致风格；清晰显示当前百分比值如 `100%`）。
  - 控件：5 档分段单选组（`role="radiogroup"` 或 `<fieldset>` + `<legend>`），选项为 `90%`、`100%`、`110%`、`120%`、`125%`（`100%` 可附简洁 `title` 说明“默认标准字号”），复用 `.appearance-theme-options` 视觉语言并单独编写宽/窄容器折行规则（覆写 `.appearance-controls` 380px 容器断点，避免被原 4 项 2×2 规则误伤）。
- **实时阅读预览增强**：右侧 `.appearance-reading-preview`（[AppearanceSettings.tsx](../src/ui/settings/AppearanceSettings.tsx#L185-L195)）继续消费全局 `--font-message` 实时缩放，并在示例助手回复中补充一小段行内代码样本（如 `` `font-scale` ``），便于同时观察正文、加粗与代码缩放效果。

### 4.2 启动首帧、控制器与写盘失败语义（[appearance.ts](../src/appearance/appearance.ts)）
- **类型与常量**：
  ```ts
  export const FONT_SCALE_OPTIONS = [90, 100, 110, 120, 125] as const;
  export type FontScale = (typeof FONT_SCALE_OPTIONS)[number];
  ```
- **共享校验**：`isFontScale(value: unknown): value is FontScale`（严格检查整数且属于 `FONT_SCALE_OPTIONS`），同时供 `loadAppearancePreferences`、`readAppearancePreferences`、`setFontScale` 与备份校验共用。
- **首帧与运行时注入**：
  - `defaultAppearancePreferences.fontScale = 100`。
  - `applyAppearanceVariables` 统一执行 `target.style.setProperty("--font-scale", String(preferences.fontScale / 100))`；首帧由 [bootstrap.ts](../src/appearance/bootstrap.ts) → `applyInitialAppearance` 立即生效，避免首屏字号跳动。
  - 控制器初始化（[appearance.ts](../src/appearance/appearance.ts#L788-L812)）完整拷贝 `snapshot.fontScale`；新增 `setFontScale(scale: FontScale): void`（经 `useAppearance.ts` 与 `App.tsx` 透传至 `AppearanceSettings`）。
  - `setColorPreset` 与 `resetCustomAppearance` 均显式保留 `fontScale: preferences.fontScale`。
- **保存失败反馈**：
  - 当前 `updatePreferences` 仅把 `DataContractError` 塞进 `backgroundError`（展示在背景卡片内），且保存失败后仍更新内存快照。
  - 本次需确保 `setFontScale` 写盘失败（如损坏外观记录或存储拒绝写入）时：**保留上次已保存状态（不制造“已保存”假象）并在「文字与字号」卡片就近显示错误提示**（或提供独立 `fontScaleError` / 顶部持久化错误区），同时保留 `#backup` 维护页入口不受损坏外观记录阻断。

---

## 5. 持久数据契约与备份恢复（遵循 [DATA-CONTRACTS.md](DATA-CONTRACTS.md)）

### 5.1 版本与注册变更
- **存储键**：保持 `ayase-studio.appearance.v1` 不变；Dexie schema v9、备份文档 v5、加密信封 v1 保持不变。
- **模块版本**：[dataRegistry.ts](../src/storage/dataRegistry.ts) 中 `dataModules.appearance.version` 由 `4` 升为 **`5`**（`minimumReaderVersion: 5`、`requiredCapabilities: []`）。
- **字段策略**：[dataPolicies.ts](../src/storage/dataPolicies.ts) 中 `dataPolicies.appearance` 新增 `fontScale: "backup"`。
- **导出投影**：[snapshot.ts](../src/backup/snapshot.ts#L96-L104) 已按 `backupFields(dataPolicies.appearance)` 投影，自动包含 `fontScale` 并输出模块声明 `appearance: { version: 5, minimumReaderVersion: 5, requiredCapabilities: [] }`。

### 5.2 兼容与恢复矩阵

| 场景 | 预期行为 |
| --- | --- |
| 旧本机 `ayase-studio.appearance.v1` 缺失 `fontScale` | `loadAppearancePreferences` / `readAppearancePreferences` 纯读取回填 `100`，零自动写回。 |
| 非法 `fontScale`（如 `85`、`105`、`1.1`、`"100"`、`null`、`NaN`）或未知字段 | 严格读取/保存与备份恢复均拒绝并保留原文；启动显示层回退 `100` 不阻断 `#backup`。 |
| 导入旧文档 v1–v3 或 `appearance` v1–v4（缺失 `fontScale`） | `validation.ts` 中 `filled` 补齐 `fontScale: defaultAppearancePreferences.fontScale` 以通过 canonical 校验；文档原串保持，可稳定恢复与按 v5 再导出。 |
| 导入旧文档 v1–v3 或 `appearance` v1–v4 **却携带 `fontScale`**（**含 `fontScale: 100`**） | `compatibility.ts` 的 `validateAppearanceCompatibility` 在版本重标与任何耐久写入前直接拒绝。 |
| 恢复策略：`replace` | 沿用现有语义写入备份的外观配置；若旧包缺 `fontScale` 或外观为 `null`，重启后按默认 `100%`；若是 v5 包则应用备份中的 `fontScale`。 |
| 恢复策略：`merge` / `copy` | 保留本机完整外观（含本机 `fontScale`），仅追加背景图库。 |
| 恢复失败回滚 | 私有恢复日志逐字节恢复原始 `ayase-studio.appearance.v1` 字符串。 |
| 旧版客户端读取新版 v5 备份 | 即使 `fontScale === 100`，因导出声明 `appearance 5/5`，旧客户端按最低读者 5 明确拒绝，不承诺降级读取。 |

---

## 6. 布局防裁切与控件适配清单

实施时须逐项核查并治理以下源码已定位的高风险点：

1. **固定 `rem` / `px` 行高改为无单位行高**（避免 110%–125% 压行重叠）：
   - [App.css](../src/App.css)：`1.05rem`（L1243）、`1.25rem`（L2021）、`1.5rem`（L2280/L2289）等涉及缩放文本的固定行高；
   - [AppearanceSettings.css](../src/ui/settings/AppearanceSettings.css#L43-L97)：`1.125rem` / `1.25rem` / `1.5rem`；
   - [ConnectionSettings.css](../src/ui/settings/ConnectionSettings.css#L212-L376)：`1.25rem` / `1.5rem`；
   - [DrawingWorkspace.css](../src/ui/drawing/DrawingWorkspace.css#L202-L574)：`1.25rem` / `1.5rem`；
   - [SearchResults.css](../src/ui/chat/SearchResults.css#L1)：`1.35rem`；
   - [AboutSettings.css](../src/ui/settings/AboutSettings.css#L54)：`20px`（同时核对复制提示绝对定位与可用宽度）。
2. **含文字的单行固定高度控件改为 `min-height` + 纵向留白**（保持 100% 视觉高度不变，125% 不裁切）：
   - 聊天侧栏新建按钮：[App.css](../src/App.css#L2967)（`height: 2.25rem` → `min-height: 2.25rem`）；
   - 下拉框：[SelectField.css](../src/ui/SelectField.css#L1)（`height: 36px` → `min-height: 36px; padding-block: 6px;`）；
   - 模型选择器：[ModelPicker.css](../src/ui/chat/ModelPicker.css#L125) 搜索输入（`height: 36px` → `min-height: 36px`）、[L195](../src/ui/chat/ModelPicker.css#L195) 供应商筛选胶囊（`height: 28px` → `min-height: 28px; padding-block: 4px;`）；
   - 会话/助手配置弹窗：[AssistantConfig.css](../src/ui/chat/AssistantConfig.css#L369)、[L554](../src/ui/chat/AssistantConfig.css#L554)、[L596](../src/ui/chat/AssistantConfig.css#L596)（`height: 36px` → `min-height: 36px`，并核对 720×520 下 2×2 / 3×2 栅格列宽与开关换行）；
   - 绘图工作区：[DrawingWorkspace.css](../src/ui/drawing/DrawingWorkspace.css#L61-L63) 预设选择与按钮（`height: 1.95rem` → `min-height: 1.95rem`）、[L73](../src/ui/drawing/DrawingWorkspace.css#L73) 与 [L408](../src/ui/drawing/DrawingWorkspace.css#L408)（`height: 36px / 2rem` → `min-height`）；
   - 设置表单控件：[AppearanceSettings.css](../src/ui/settings/AppearanceSettings.css#L80)、[ConnectionSettings.css](../src/ui/settings/ConnectionSettings.css#L273-L301)、[L605](../src/ui/settings/ConnectionSettings.css#L605)、[L624](../src/ui/settings/ConnectionSettings.css#L624)、[ModelGroupManagement.css](../src/ui/settings/ModelGroupManagement.css#L6)、[NetworkSearchSettings.css](../src/ui/settings/NetworkSearchSettings.css#L17)、[backgroundFocus.css](../src/ui/settings/backgroundFocus.css#L21)。
3. **窄窗（720×520）与特殊区域重点核验**：
   - 顶部 40px 标题栏（[App.css](../src/App.css#L2806-L2818)、[L402](../src/App.css#L402)）与居中对话标题按钮的可用宽度、省略及可点/可聚焦性；
   - 外观页新五档控件在宽窗窄左栏（`clamp(26rem, 32%, 40rem)`）及 `@container appearance-controls (max-width: 380px)` 下的折行；
   - 常规设置头像详情（[SettingsDesign.css](../src/ui/settings/SettingsDesign.css#L55)）与 `>760px` 左列 140px 标题换行；
   - 绘图任务表与 Gemini 参数的 `em` 容器断点跨档重排；
   - 浮层定位（`SelectField` / `ActionMenu` / `SettingsHelp`）与 `MessageEditor` 在不同字号下的高度测算与焦点行为。

---

## 7. 涉及文件与同步文档清单

- **核心实现**：`src/appearance/appearance.ts`、`src/appearance/useAppearance.ts`、`src/App.tsx`、`src/storage/dataRegistry.ts`、`src/storage/dataPolicies.ts`、`src/backup/compatibility.ts`、`src/backup/validation.ts`、`src/ui/settings/AppearanceSettings.tsx`。
- **样式**：`src/App.css`、`src/ui/settings/AppearanceSettings.css`、`src/ui/settings/ConnectionSettings.css`、`src/ui/settings/AboutSettings.css`、`src/ui/settings/NetworkSearchSettings.css`、`src/ui/settings/ModelGroupManagement.css`、`src/ui/settings/backgroundFocus.css`、`src/ui/SelectField.css`、`src/ui/chat/ModelPicker.css`、`src/ui/chat/AssistantConfig.css`、`src/ui/chat/SearchResults.css`、`src/ui/drawing/DrawingWorkspace.css`。
- **独立验证夹具（须单独类型检查）**：`scripts/chat108/main.tsx`、`scripts/workbench-material/main.tsx`。
- **文档同步**：`docs/DATA-CONTRACTS.md`、`docs/AYASE-BACKUP.md`、`docs/UI-DESIGN.md`、`docs/ARCHITECTURE.md`、`docs/PLAN.md` 及派生摘要 `DESIGN.md`、`PRODUCT.md`、`.impeccable/design.json`。

---

## 8. 验收与测试计划

1. **确定性单测**：
   - `src/appearance/appearance.test.ts`、`src/appearance/appearanceData.test.ts`：默认 `100`、5 档合法值读写、首帧 `--font-scale` 注入、旧记录缺字段零写回、非法值/非整数/未知字段/损坏 JSON 拒绝并保留原文、保存失败反馈、`setColorPreset` / `resetCustomAppearance` 保留 `fontScale`。
   - `src/backup/compatibility.test.ts`、`src/backup/restore.test.ts`：v5 导出携带 `fontScale` 与 `appearance 5/5`、旧 v1–v4 缺字段读取与再导出、旧文档 v1–v3 与 **`appearance` v4 夹带 `fontScale: 100`** 零写入拒绝、`replace`/`merge`/`copy` 三策略及私有恢复日志回滚。
   - `src/ui/settings/AppearanceSettings.test.tsx`、`src/ui/settings/SettingsWorkspace.test.tsx`：5 档选择、当前态识别、独立恢复默认与实时阅读预览渲染。
2. **代码与契约门禁**：
   - `npm.cmd run check`（含 `check:data-contracts` 与 `check:release`）
   - `cargo check --manifest-path src-tauri/Cargo.toml`
   - `git diff --check`
   - 单独检查 `scripts/chat108/main.tsx` 与 `scripts/workbench-material/main.tsx` 类型无报错。
3. **隔离内置浏览器视觉验收**：
   - 覆盖 **90% / 100% / 110% / 120% / 125%**（重点对比 90%、100%、125% 及 `100 → 125 → 100` 切换）× **浅/深主题** × **1280×900 / 720×520**；
   - 核对聊天（Markdown 标题/行内代码/代码块/宽表格/行内与块级 KaTeX/引用/思考摘要）、绘图工作区、设置六页、`SessionConfigPanel`、`ModelPicker` 与确认弹窗均无文字裁切、无横向溢出、操作入口可达；核对 1920×1080 舞台气泡锁定 `15px`、实际阅读预览随档位缩放。
4. **独立只读审查与人工验收**：
   - 实施完成后执行独立只读交叉审查（涉及数据契约与备份模块升级，按 `AGENTS.md` 强制要求）；
   - Windows 桌面端微软雅黑渲染、冷启动首帧与原生标题栏观感交由用户实机验收。
