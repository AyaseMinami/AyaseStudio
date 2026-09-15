# Codex 指令审计

核验日期：2026-09-16。本记录说明本次文档维护依据，不改变 Ayase 的功能范围。

## 官方依据

- [Using GPT-6 Astra](https://developers.openai.com/api/docs/guides/latest-model)：自主完成、技能指令优先级、沟通、分工和适度验证。
- [Rethinking skills and prompts for GPT-6 Astra](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra)：缩小技能触发范围、按需加载资料，清理过度流程约束。
- [GPT-6 Astra 模型页](https://developers.openai.com/api/docs/models/gpt-6-astra)：模型 ID 为 `gpt-6-astra`。API 能力说明与 Codex 运行环境提供的模型选项应分别核验。

采用原则：保留项目知识和实际权限边界；普通选择由代理完成；缺少关键决定时才询问；验证覆盖实际变化；明确完成条件。官方提示词示例中的 worktree、PR 或并行分工不构成本项目对相应操作的授权。

API 使用速记：模型页列出的 reasoning effort 为 `low`、`medium`、`high`、`xhigh`、`max`；使用指南说明不支持 `none`，工具调用需使用 Responses API，并需移除 `temperature`、`top_p` 和 `top_logprobs` 等不支持参数。这些是官方 API 合同，不应直接推断 Codex 界面选项或中转站行为；本次未修改 Ayase 的请求映射，也未验证其 Astra 兼容性。

## 文档职责

| 位置 | 职责 |
| --- | --- |
| `~/.codex/AGENTS.md` | 通用协作、权限与分级子代理策略 |
| `~/.codex/config.toml` | 实际模型与运行配置 |
| `~/.codex/agents/*.toml` | 子代理角色指令；内嵌技能正文时需随原技能同步 |
| `~/.agents/skills`、`~/.codex/skills` | 用户维护的工作流技能 |
| 仓库 `AGENTS.md` | 当前项目约束、按需资料入口与验证规则 |
| `DEVELOPMENT.md` | 操作示例、验证方法和历史验收记录 |
| `ARCHITECTURE.md`、`PROTOCOLS.md`、`PLAN.md` | 架构、协议与产品范围；不能把模型新功能当成已实现能力 |

## 本次清理

- 全局指令取消“主代理必须是 Sol”的身份表述，采用任务实际选择；已核对本机主模型为 Astra/medium，Sol/xhigh fallback、Terra/medium 实施、Luna/low 机械工作与 Sol/xhigh 审查策略保留。
- 仓库资料由固定全读改为按任务主题读取；用户当前明确修改可更新本地需求记录，远端写入仍需授权。
- 区分纯文档验证、代码门禁和桌面交互验收；真实探针始终要求授权，历史工具失败不视为永久能力限制。
- 技能清理针对隐式 Git 提交、重复确认与固定全量验证；对应子代理内嵌正文同步维护。访谈技能的核心交互、ComfyUI 隐私边界和产物视觉验收保留。

本次范围为当前 Ayase 仓库、用户维护技能与 Codex 指令。系统技能及插件缓存按安装包管理，本次只将相关技能作为参考；其他项目、记忆、应用代码、模型选择和 API 配置不在修改范围。

技能入口审计覆盖 36 项，实际修改 11 项：`implement`、`scaffold-exercises`、`setup-pre-commit`、`resolving-merge-conflicts`、`wizard`、`tdd`、`edit-article`、`to-prd`、`triage`、`diagnosing-bugs`、`hatch-pet`。前 10 项有同名子代理文件，随技能同步；`hatch-pet` 仅调整视觉工作者的旧模型示例。

## 验证与回退

项目原状态为干净的 `dev`；本次项目差异仅为 `AGENTS.md`、`README.md`、`docs/DEVELOPMENT.md` 和本记录。项目外 22 份原文件备份位于 `C:\Users\yrc\.codex\backups\20260916-astra-doc-audit`：根目录为全局 AGENTS 与 hatch-pet，`agents-skills`、`codex-agents` 各 10 份。需要回退时逐文件比较并恢复对应片段，保留后续修改。

已检查 Markdown 相对链接、Git diff、41 个角色 TOML 的解析，以及 10 组技能/角色正文的一致性。`codex.cmd --strict-config --version` 返回 `codex-cli 0.154.0`。技能检查使用 Python UTF-8 模式；6 项通过官方 `quick_validate.py`，其余 5 项因原有 `disable-model-invocation` 字段不在该验证器允许列表而失败。另行解析确认这 5 项 YAML 有效且原调用设置保留，不宣称官方验证器全部通过。

## 后续维护

技能调整先确认触发条件和真实约束，直接修正冲突句，避免再附加一套重复规则。同步内嵌副本并检查格式、引用和代表性任务判断。静态验证不能证明未来模型行为；在真实使用中发现重复暂停时，再按具体证据修订。

纯文档维护检查内容、链接、diff 和受影响的配置解析；代码与发布验收继续依照 `DEVELOPMENT.md` 和 `PLAN.md`。本记录不代表已经完成新的桌面验收、真实供应商兼容性验证或产品模型迁移。
