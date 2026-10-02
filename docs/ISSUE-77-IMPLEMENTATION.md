# Issue #77 实施记录

日期：2026-09-30。范围为本地 Cherry Studio 聊天备份导入，保留现有用户数据，不导入凭据或服务配置。需求入口为 [Issue #77](https://github.com/AyaseMinami/AyaseStudio/issues/77)，使用说明见 [迁移指南](CHERRY-IMPORT.md)。本文件记录实现与验收证据；交付提交和 Issue 状态以 Git 与 GitHub 记录为准。

## A–E 进度

| 阶段 | 本地实现 | 证据和剩余边界 |
| --- | --- | --- |
| A：普通备份只读提取原型 | 真实只读对照已完成；格式 6 使用 Chromium 聊天来源，不依赖遗留 SQLite | [原生入口](../src-tauri/src/cherry_import.rs)、[JSON/Chromium 提取](../src-tauri/src/cherry_legacy.rs)、[LevelDB](../src-tauri/src/cherry_leveldb.rs)、[V8 载荷](../src-tauri/src/cherry_v8.rs)。真实格式 6 隔离预览与手机 JSON 的全部聊天记录语义匹配；未写入当前用户数据 |
| B：旧版普通备份完整导入 | 本地实现、合成全流程与浏览器验收完成；真实备份的只读提取和附件读取通过 | [映射与测试](../src/import/cherryMapping.test.ts)、[服务与测试](../src/import/cherryImport.test.ts)、[仓库与测试](../src/import/cherryRepository.test.ts)、[全流程集成测试](../src/import/cherryIntegration.test.ts)、[设置与测试](../src/ui/settings/DataImportSettings.test.tsx)。覆盖顺序、配置隔离、重复竞态、缺失描述、回滚及异步资源释放；真实备份未写入当前用户数据 |
| C：新版2.1.3普通备份完整导入 | 已实现固定格式 7 SQLite、26 项迁移识别和所有根到叶分支展开；真实导出待验收 | [SQLite 解析和合成用例](../src-tauri/src/cherry_sqlite.rs)、[ZIP 入口和合成用例](../src-tauri/src/cherry_import.rs)、[分支映射](../src/import/cherryMapping.ts)。已有固定源码及合成 SQLite/ZIP 验证，不能据此宣称真实导出完成 |
| D：兼容性和故障验收 | 确定性回归、独立审查和全量门禁通过；真实新版导出及原生交互仍待验收 | 定向用例覆盖无效身份/时间、归属矛盾、孤儿/循环/跨主题父节点、恶意路径、资源预算、提交前失败、事务竞态和提交后整理失败；验证记录见下方 |
| E：迁移说明与支持矩阵 | 完成 | [迁移指南](CHERRY-IMPORT.md)、[前期来源研究](ISSUE-77-EXTERNAL-RESEARCH.md)。指南和本记录是本轮结果，前期研究中的实现建议属于历史调查 |

## 已确认的验证范围

- 真实格式 6 的隔离预览与格式 5 手机 JSON 全部聊天记录语义相符；此检查不写入当前用户数据，文档不记录私人数量、名称、ID 或文件位置。
- 格式 7 以固定 v2.1.3 源码、26 项 SQLite 迁移识别记录及合成 SQLite/ZIP 为依据。尚无真实 2.1.3 导出验收，不能宣称任意 2.x 备份均兼容。
- 导入映射、服务、仓库与设置页面定向测试通过 4 文件 / 84 项；覆盖缺失附件的原名/别名、恢复后清除过时描述，以及所选范围内的缺失计数。失败时不修改预览计划。
- TypeScript 与 Git diff 检查在此前映射/服务修改后通过；本次说明交接另执行文档链接、diff 和 TypeScript 检查。组件测试不代替浏览器布局或原生文件选择验收。

可重复的局部验证命令：

```powershell
npm.cmd run test -- src/import src/ui/settings/DataImportSettings.test.tsx
npx.cmd tsc --noEmit
cargo test --locked --manifest-path src-tauri/Cargo.toml cherry
git diff --check
```

## 最终代码门禁

2026-09-30：`npm.cmd run check` 通过 71 文件 / 777 项测试、TypeScript 和 Vite 生产构建；保留既有大 chunk 提示。最终 `cargo test --locked --manifest-path src-tauri/Cargo.toml` 通过 81 项，1 项私人样本用例默认忽略；该用例另以明确本地输入执行通过，完整聊天语义对照和附件实际读取核验均通过。`cargo check --locked --manifest-path src-tauri/Cargo.toml` 与 `git diff --check` 通过。

独立只读审查已复核原生解析、事务与附件归属、发送互斥、重复导入和界面资源释放；发现的缺失附件描述、资源放大预算、快照日志完整性与外部文件描述问题均已修复并回归，没有遗留可操作发现。新增用例覆盖 SST 共享前缀、重复句柄、过期 WAL 排除、外部描述禁止读取同名 ZIP 文件，以及 SQLite 输出预算。

用户随后反馈当前导入“效果非常好”，并明确要求提交、推送代码以及将 #77 标记为完成。按该确认交付到 `dev`；下述真实 2.1.3 导出和原生交互验证边界继续保留，不将用户的总体认可写成每项手工操作均已验收。

## 浏览器验收

内置浏览器使用独立本地来源、合成聊天和模拟原生文件接口，真实应用组件与数据库仓库保持不变，未配置供应商或发送请求。检查 1600×900 浅色和 720×520 深色，确认标题省略、完整提示、嵌套列表滚动、确认按钮可达，以及页面/导入内容/列表无横向溢出。键盘勾选与取消全选后，所选消息、附件和缺失计数正确更新。

先导入含附件的一个回答路径和空对话，结果为 2 个；相同选择默认跳过 2 个，另存副本新增 1 个。刷新后助手保持 3 个对话，正文加粗、HTML 安全文本、思考展开、缺失文件名和本地文本附件预览均正常恢复；未绑定模型。隔离截图位于忽略目录 `issue77.local/import-dark-720.jpg`，不含真实备份内容。这些检查不等于 Windows 文件选择或真实桌面重启验收。

## 原生验收

最终代码以独立 application identifier、独立 Vite 端口执行 `npm.cmd run tauri dev -- --no-watch --config issue77.local/tauri-smoke.json`，编译完成，进程响应且创建 Ayase Studio 主窗口；随后关闭本轮启动的进程。未操作系统文件选择，也未访问当前用户的应用数据或真实模型。真实旧版附件已在只读原生解析用例中验证读取及类型检查；实际写入当前用户数据、Windows 文件选择、桌面重启恢复和真实 2.1.3 导出仍待人工/样本验收。合成 ZIP、SQLite 和浏览器检查不能替代这些边界。
