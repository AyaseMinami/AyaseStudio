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
| 独立绘图与后续范围 | [#83 当前范围索引](ISSUE-83-DRAWING-SPEC.md) |

## 证据与历史

- [#98 / #108 收尾记录](ISSUE-98-108-CLOSEOUT.md) 汇总最终视觉与玻璃范围、性能采集、用户接受边界及 2026-10-03 的远端关闭状态。

- `ISSUE-*-IMPLEMENTATION.md` 和 `ISSUE-94-ACCEPTANCE.md` 记录对应切片的实现、检查和人工接受边界；其中旧阶段状态不代表当前 Issue 状态，历史验收不能代替后续变更的验证。
- `ISSUE-*-RESEARCH.md` 保留调研日期、固定源码版本和依据，属于参考证据；其中 Ayase 旧建议由现行合同取代。
- [OpenAI 搜索后续](OPENAI-SEARCH-FOLLOWUP.md) 对应 #18 的线路验证工作，与 Exa 外部搜索独立。
- [历史归档](archive/README.md) 保存已被后续实现或决定取代的可行性方案、UI 提案、指令快照和模拟草图。

维护文档时直接更新现行合同；需要保留旧决定或验证过程时明确标注历史日期和替代入口。归档时同步相对链接，避免重复维护两套当前规则。
