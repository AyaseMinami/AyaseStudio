# 文档索引

当前开发入口按主题使用，GitHub Issues 记录批准范围；用户当前明确修改优先。实施记录保留切片的验证证据，历史提案不自动成为当前规则。

| 主题 | 当前文档 |
| --- | --- |
| 环境、命令与验证 | [开发指南](DEVELOPMENT.md) |
| 模块边界、状态与资源所有权 | [架构说明](ARCHITECTURE.md) |
| 持久数据、字段策略、迁移与备份兼容 | [数据合同](DATA-CONTRACTS.md) |
| 界面与交互 | [UI 约定](UI-DESIGN.md) |
| 功能范围 | [计划](PLAN.md) |
| 请求、URL、流式与供应商适配 | [协议合同](PROTOCOLS.md) |
| 领域术语 | [CONTEXT.md](../CONTEXT.md) |
| Cherry 导入 | [导入指南](CHERRY-IMPORT.md) |
| Ayase 备份与恢复 | [备份指南](AYASE-BACKUP.md) |
| 第三方许可、字体与资源归属 | [许可说明](THIRD-PARTY-LICENSES.md) · [锁定依赖清单](THIRD-PARTY-DEPENDENCIES.md) |
| 独立绘图与后续范围 | [#83 当前范围索引](ISSUE-83-DRAWING-SPEC.md) |

## 证据与历史

- DeepSeek 专项 Epic `#139` 已于 2026-11-26 收口关闭（`#140`、`#141`、`#142`、`#143`、`#145` 已完成关闭，`#144` 经评估以 `not planned` 关闭，历史 `#40` 亦已由 `#143` 核对结论覆盖关闭）；相关设计与参考留档见 [#141 设计案](ISSUE-141-DESIGN.md)、[#143 设计案](ISSUE-143-DESIGN.md) 与 [#145 Demo 调研](ISSUE-145-DEEPSEEK-DEMO-RESEARCH.md)。

- [#128 实施记录](ISSUE-128-IMPLEMENTATION.md) 记录历史消息附件编辑的本地实现、故障／备份／浏览器验证、独立代码复核及原生人工边界；[设计案](ISSUE-128-DESIGN.md) 保留设计审查，[Cherry 1.9.13 源码研究](ISSUE-128-CHERRY-RESEARCH.md) 是参考依据。三类记录不代替 Issue 关闭。

- [#57 / #106 审查记录](ISSUE-57-106-AUDIT.md) 记录 2026-10-03 非样式审查、缓存清单、修复、验证与许可待核实项。

- [#98 / #108 收尾记录](ISSUE-98-108-CLOSEOUT.md) 汇总最终视觉与玻璃范围、性能采集、用户接受边界及 2026-10-03 的远端关闭状态。

- `ISSUE-*-IMPLEMENTATION.md` 和 `ISSUE-94-ACCEPTANCE.md` 记录对应切片的实现、检查和人工接受边界；其中旧阶段状态不代表当前 Issue 状态，历史验收不能代替后续变更的验证。2026-11-26 项目收尾已清出本机忽略目录中的临时验收截图、旧构建缓存与历史测试安装包（`*.local/`、`scripts/select116/.local/`、`.impeccable/review/` 等）；历史实施记录中直链这些已退本地原件的链接（如 `#116` 过程截图）属有意退休，已验证的文字结论保留在文档中，需要复查时按对应 `scripts/` 夹具重新生成。
- `ISSUE-*-RESEARCH.md` 保留调研日期、固定源码版本和依据，属于参考证据；其中 Ayase 旧建议由现行合同取代。
- [OpenAI 搜索后续](OPENAI-SEARCH-FOLLOWUP.md) 对应 #18 的线路验证工作，与 Exa 外部搜索独立。
- [历史归档](archive/README.md) 保存已被后续实现或决定取代的可行性方案、UI 提案、指令快照和模拟草图。

维护文档时直接更新现行合同；需要保留旧决定或验证过程时明确标注历史日期和替代入口。归档时同步相对链接，避免重复维护两套当前规则。
