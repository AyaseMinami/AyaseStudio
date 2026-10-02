# 独立绘图模块：当前范围与合同入口（#83）

整理日期：2026-10-02。本文保留 #83 的现行范围入口；早期设计、候选细则、固定版本调研与原验收记录完整保存在 [历史设计记录](archive/ISSUE-83-DRAWING-DESIGN-HISTORY.md)。归档材料描述当时的决定和实现阶段，不作为当前待办或验收标准。

## 现行范围

绘图是与聊天同级的独立业务模块，使用 React、TypeScript、Tauri/Rust，共用供应商 → 连接 → 模型设置，分别保存聊天／绘图目标、参数和数据。绘图不属于助手或对话，不引入 Python、本地推理、通用工具运行时、Agent 或自动重试。

| 范围 | 当前合同与证据 |
| --- | --- |
| Gemini 与 OpenAI Images 文生图／多参考图输入 | [#84](ISSUE-84-IMPLEMENTATION.md)、[#85](ISSUE-85-IMPLEMENTATION.md)、[#86](ISSUE-86-IMPLEMENTATION.md)、[协议合同](PROTOCOLS.md) |
| Gemini 高级参数、字符校验和有界响应兼容 | [#101](ISSUE-101-IMPLEMENTATION.md) |
| 单批 1–99、FIFO、全局并发 1–4（默认 1） | [#87](ISSUE-87-IMPLEMENTATION.md)；没有额外等待数量硬上限 |
| 取消、暂停、重新生成、退出与重启恢复 | [#88](ISSUE-88-IMPLEMENTATION.md)；本地保存失败仅影响单项，可能已发送的任务不能自动重发 |
| 私有成果库、缩略图、预览、删除及普通／带参数 PNG 导出 | [#89](ISSUE-89-IMPLEMENTATION.md)；任务历史与成果独立，普通导出不附带生成参数 |
| 纯文本提示词预设及完整历史参数复用 | [#90](ISSUE-90-IMPLEMENTATION.md)；直接应用，不自动生成 |
| 绘图设置及显式纯文本预设备份 | [#93](ISSUE-93-IMPLEMENTATION.md)、[备份指南](AYASE-BACKUP.md)、[数据合同](DATA-CONTRACTS.md) |
| 集成、压力与原生接受的实际范围 | [#94 验收记录](ISSUE-94-ACCEPTANCE.md)；历史切片或草图通过不能代替其证据 |
| 会话参考图、提交时准备与中断导入恢复 | [#110](ISSUE-110-IMPLEMENTATION.md) |
| 单页配置、任务／日志、大图与分页历史 | [#111](ISSUE-111-IMPLEMENTATION.md)、[UI 约定](UI-DESIGN.md) |

实施记录描述对应切片的实际检查与接受边界；后续合同取代其中已明确标注的旧规则。本文不扩大任何 Issue 范围，也不把模拟供应商、浏览器或启动检查当作真实线路／原生交互验收。

## 参考图与持久化

新选择保存在 `DrawingState.references` 会话内存，不写入自动草稿。文件选择、拖入和粘贴捕获原字节，显式提交才冻结有序输入、准备受管原图并原子登记整批任务。取消／准备失败不派发部分批次，不自动重发；提交后继续保留当前会话选择，已有任务／成果拥有独立持久输入。

新会话选择关闭后消失。旧 `DrawingDraft.references` 严格读取并保守保留；提示词或参数修改不清空旧绑定，只有显式移除、清空或替换选择才释放对应绑定。存在仅会话选择时，需先显式清空才能进入会重建工作区的数据维护。具体所有权、恢复和失败边界以 [#110](ISSUE-110-IMPLEMENTATION.md) 为准。

没有额外的参考图张数、容量或像素硬上限；官方无明确预处理要求时保留原字节、格式、尺寸和透明度。传输包装不等于图片预处理，输出响应预算不套用到参考图输入。

## 界面与恢复

当前为 #111 单页布局：左侧配置及独立限高任务／日志面板，右侧常驻大图、成果操作与分页历史；窄窗口按 [UI 约定](UI-DESIGN.md) 重排。任务标签取既有 UUID 前 8 位，实际操作始终绑定完整 ID。旧“生成／任务／成果库”三视图和 [模拟草图](archive/design/drawing-workspace-83.html) 仅作历史参考。

重启暂停确定未发送的 queued 任务，由用户明确继续；可能已发送的任务不自动重发。保存失败可以显式重试已有图片的本地保存。删除特殊终态历史须说明影响，不删除独立成果或其他拥有者仍使用的输入。退出与维护的细则见 [架构说明](ARCHITECTURE.md)、[#88](ISSUE-88-IMPLEMENTATION.md)、[#93](ISSUE-93-IMPLEMENTATION.md) 和 [#110](ISSUE-110-IMPLEMENTATION.md)。

## 备份范围

只备份无提示词的绘图设置及显式保存的纯文本预设。自动草稿提示词、参考图、任务／批次、成果及图片排除于可移植备份；私有回滚日志不是可移植内容。旧完整图库备份及队列导入提案已被 #93 取代，不能据此扩大实现或压力验收。

版本、默认、旧数据读取、字段策略和三种恢复策略见 [DATA-CONTRACTS.md](DATA-CONTRACTS.md)、[AYASE-BACKUP.md](AYASE-BACKUP.md) 与 [#93](ISSUE-93-IMPLEMENTATION.md)。Gemini 可选参数对应绘图设置模块 v2，见 [#101](ISSUE-101-IMPLEMENTATION.md)。

## 后置范围与参考使用

- [#91](https://github.com/AyaseMinami/AyaseStudio/issues/91)：聊天图片与绘图的双向联动，独立绘图不依赖它。
- [#92](https://github.com/AyaseMinami/AyaseStudio/issues/92)：读取旧 GNBP PNG 参数；显式兼容 PNG 写出已属于 #89。

遇到需求歧义，先查现行合同、已有 Issue／决定及 [固定版本来源](archive/ISSUE-83-DRAWING-DESIGN-HISTORY.md#12-参考来源及边界)。GNBP 是参考证据，Ayase 后续已确认的差异优先；协议事实另核对官方文档。历史候选数值、旧授权和草图模拟行为不构成新的产品决定、远端写入授权或验收证据。
