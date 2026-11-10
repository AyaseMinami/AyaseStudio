---
name: Ayase Studio
description: 安静、清楚的个人创作工作台
colors:
  accent: "rgb(var(--color-accent))"
  accent-hover: "rgb(var(--color-accent-hover))"
  on-accent: "rgb(var(--color-on-accent))"
  text: "rgb(var(--color-text))"
  text-soft: "rgb(var(--color-text-soft))"
  muted: "rgb(var(--color-muted))"
  panel: "rgb(var(--color-panel))"
  input: "rgb(var(--color-input))"
  hover: "rgb(var(--color-hover))"
  border: "rgb(var(--color-border))"
  focus: "rgb(var(--color-focus))"
  workbench-surface: "var(--workbench-surface)"
  workbench-border: "var(--workbench-border)"
  error-text: "rgb(var(--color-error-text))"
typography:
  title:
    fontSize: "1.375rem"
    fontWeight: 600
    lineHeight: 1.4
  section:
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.5
  ui:
    fontFamily: '"Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Noto Sans SC", system-ui, sans-serif'
    fontSize: "0.875rem"
  message:
    fontSize: "0.9375rem"
    lineHeight: 1.75
  small:
    fontSize: "0.8125rem"
  caption:
    fontSize: "0.75rem"
rounded:
  control: "8px"
  surface: "12px"
  dialog: "16px"
spacing:
  compact: "8px"
  inline: "12px"
  content: "16px"
  surface: "20px"
  section: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.control}"
    padding: "0.45rem 0.7rem"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    textColor: "{colors.text-soft}"
    rounded: "{rounded.control}"
    padding: "0.45rem 0.7rem"
  field:
    backgroundColor: "{colors.input}"
    textColor: "{colors.text}"
    padding: "0.65rem 0.75rem"
  workbench-card:
    backgroundColor: "{colors.workbench-surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.surface}"
    padding: "20px"
---

# Design System: Ayase Studio

## Overview

**Creative North Star: "安静、清楚的个人创作工作台"**

保留现有识别和个性化能力，以任务布局、对齐和文字层级建立整体感。系统中文字体、用户主题、背景、头像、气泡及可选局部玻璃继续构成个人工作区。

**Key Characteristics:**

- 任务分组清楚，静态工作面安静。
- 聊天阅读与绘图作品保持主要地位。
- 操作直接可达，键盘焦点清晰。

本轮权威方案见 [#129 施工方案](docs/ISSUE-129-UI-PLAN.md)，完整行为约束见 [UI 设计规范](docs/UI-DESIGN.md)。实现值以 [App.css](src/App.css) 及对应组件 CSS 为准；前置 tokens 通过现有 CSS 变量跟随主题和用户配色，不固定为某套默认色。

## Colors

### Primary

强调色用于选择、主行动及焦点，主按钮文字使用对应的反差色。错误使用已有语义错误色，同时保留错误文字及确认说明。

### Neutral

正文、辅助文字、边界与工作面使用各自语义颜色。工作面由面板和文字色混合形成，与聊天透明度分开；不把用户背景或气泡颜色带入静态设置工作面。

## Typography

沿用系统无衬线字体栈和现有代码字体。标题、分组、界面、消息、辅助、元信息分别使用前置 tokens 中对应层级；实际实现通过 `--font-*` 变量使用这些值。消息行高保持舒展，普通表单保持紧凑，不把缩小后的整体预览作为字号判断依据。

## Layout

间距按关系分档：标题到主要内容为 `--settings-section-gap: 24px`，同级设置卡片为 `--settings-card-gap: 16px`，常规/外观/数据卡片内边距为 `--settings-card-padding: 20px`。数据页的父容器 gap 与标题 margin 合计 24px，不重复叠加。组内保持 8/12/16px；关于信息行上下 16px。绘图工作面仍为 8px 缝隙，外观左右工作区仍为 24px，导航/聊天不机械套用设置卡片间距。

设置页横向留白使用 `--settings-page-gutter`（`clamp(20px, 3vw, 40px)`），页标题与内容间距使用 section。共享页面最大宽度为 1440px；搜索和外观使用完整可用宽度，常规、数据、关于各自限制内容宽度。标题、常规分组、数据任务和关于页使用实体工作面；常规保持组内对齐，连接以列表与详情组织，数据以任务与风险说明组织，关于以版本、更新、反馈组织。

搜索保留紧凑服务卡片与原有字段布局；卡片间距为 content。沿用 [NetworkSearchSettings.css](src/ui/settings/NetworkSearchSettings.css) 的容器规则：页面内容宽度大于 1040px 时两列，1040px 及以下单列；卡片内字段在容器达到 560px 时并列。不要改成占满一整行的宽松服务分区。

外观保留较大的右侧预览。窗口至少 1440×700 时采用有界双列：左列 `clamp(26rem, 32%, 40rem)`，右列占剩余空间，控制与预览各自独立纵向滚动。中间尺寸在页面容器达到 900px 时使用 `minmax(320px, 0.7fr) minmax(0, 1.3fr)`，预览保持独立滚动；更窄时恢复整页滚动，调节项在前。各尺寸均保留实际字号阅读样本和键盘访问。共享设置在窗口 760px 以下收为单列分组。

绘图宽屏以左侧配置和任务、右侧作品组织；参数滚动体与生成动作区分离，任务区域有界。窗口 760px 以下依次排列配置、作品和任务，配置与任务各自保留滚动空间。主按钮通常至少 36px 高，状态和长文本按内容增高。

## Elevation & Depth

标题、常规分组、数据、关于及外观使用实体工作面，搜索保留紧凑服务卡片。工作面以一层边界建立分组，面板不叠投影。弹窗、菜单和浮动反馈保留已有结构性投影；用户可选的侧栏与输入区玻璃继续沿用原能力。具体投影与动效见 [.impeccable/design.json](.impeccable/design.json)。

## Shapes

工作面采用 surface 圆角，主要设置按钮采用 control 圆角，确认弹窗采用 dialog 圆角。实体分组内部的设置行保持轻分隔；搜索保留每个服务一张紧凑卡片。现有输入、导航、确认按钮和资源缩略图保留组件自己的形状，不强制把全部圆角改成同一值。

## Components

- **按钮与字段：** 主行动使用强调色，普通操作保持轻边界；保留 hover、focus、disabled、错误与草稿状态。设置页面焦点外框与控件间留清楚空隙，文本不裁切。
- **导航：** 设置分类位置及窄窗横向访问保留。助手、对话导航和收起规则保留；Composer 工具位置不重排。
- **消息操作：** 常显并直接点击，悬停与聚焦只增强反馈，不移到更多菜单。
- **搜索服务：** 保留紧凑卡片、全宽页面和原有容器断点，不把服务卡片摊成宽松的纵向分区。
- **外观预览：** 较大的右侧整体预览与实际字号阅读样本并存；宽屏左右独立滚动，所有原有调节项继续可达。
- **绘图：** 作品保留主要区域；生成动作固定在配置容器的滚动内容之外，帮助信息可滚动，任务与成果保护沿用原流程。

## Do's and Don'ts

### Do

- Do 使用现有语义颜色和字号变量，保留用户个性化能力。
- Do 让任务、风险说明与对应动作就近排列。
- Do 保留搜索紧凑服务卡片与外观较大的右侧独立滚动预览。
- Do 保留清楚的焦点、键盘访问、强制颜色和减少动态效果支持。

### Don't

- Don't 以颜色单独承担状态。
- Don't 隐藏常用消息操作或重排已确认的聊天工具位置。
- Don't 把静态工作面改为空洞分区，或叠加重投影与营销装饰。
