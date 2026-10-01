# 持久数据契约

本文件是 #105 建立的持续开发规则。新增或修改持久数据时，开发者必须在同一功能内完成注册、字段策略、版本／迁移、备份及确定性验证，不依赖用户另行提醒。产品范围仍以已批准 Issue 和当前用户指令为准；注册数据不等于批准将它加入备份。

## 实现入口与版本

| 入口 | 职责 |
| --- | --- |
| [`dataRegistry.ts`](../src/storage/dataRegistry.ts) | 模块版本、必需能力、表／偏好归属、包含／投影／排除状态及资源责任说明 |
| [`dataPolicies.ts`](../src/storage/dataPolicies.ts) | 实际持久 TypeScript 记录及嵌套记录的穷尽 `FieldPolicy<T>` |
| [`dataContract.ts`](../src/storage/dataContract.ts) | 克隆后逐级迁移、读取版本检查、允许字段生成及限定参数过滤 |
| [`snapshot.ts`](../src/backup/snapshot.ts) | 从策略生成实际备份允许清单，处理凭据和受管资源 |
| [`compatibility.ts`](../src/backup/compatibility.ts) | v4/v5 模块兼容检查、可选会话／绘图设置参数过滤和仅路径报告 |
| [`settingsData.ts`](../src/drawing/settingsData.ts) | 绘图本机草稿、可移植设置和显式预设的共享纯克隆读入口 |
| [`check-data-contracts.mjs`](../scripts/check-data-contracts.mjs) | 不运行应用、不读用户数据的 TypeScript AST 覆盖检查 |

应用版本、Dexie schema、模块数据版本、备份文档版本、加密信封版本各自独立。#93 当前新导出是文档 v5／信封 v1，不新增 Dexie schema；连接模块 v3、搜索模块 v2，其余当前备份模块 v1。`minimumReaderVersion` 表示最低模块读者，`requiredCapabilities` 表示读者必须明确支持的能力。基础七模块为 `chat`、`session`、`workspace`、`avatars`、`appearance`、`connections`、`search`；`drawing.settings`／`drawing.presets` 分别存在时必须声明 `drawingSettings`／`drawingPresets`，不能以缺失代表空数据。新导出包含两类；旧 v4 固定原七模块，禁止绘图扩展。

## 注册所有持久入口

当前 13 张 Dexie 表全部注册：

| 备份策略 | 表 |
| --- | --- |
| `included` | `assistants`、`conversations`、`chats`、`workspace`、`avatarLibrary`、`userAvatar`、`cherryImports`、`legacyConversationConfigs` |
| `projected` | `drawingDrafts`、`drawingPromptPresets` |
| `excluded` | `drawingTasks`、`drawingResults`、`backupJournal` |

当前 8 个偏好键全部注册：外观、聊天宽度、新助手默认头像、连接 v3、搜索 v1 五个当前配置键；连接 v2 和供应商 v1 两个 `legacy-source`；`ayase-studio.data-compatibility.v1` 为私有兼容报告。连接和搜索通过专用受校验区域导出，不将其原始存储文本混入普通偏好。

新增表／偏好必须声明模块、版本、备份处理和资源所有者；刻意排除也要注册。删除入口同步移除过期注册，并保留已批准的历史读取／迁移合同。`backupJournal` 属于恢复内部状态，不可作为可移植应用内容导出。

## 字段策略必须约束实际导出

`FieldPolicy<T>` 覆盖实际类型的全部声明字段，包括联合类型各分支的字段。新增字段须选择 `backup`、`credential`、`resource`、`exclude` 或 `legacy`；遗漏字段使 TypeScript 检查失败。`backupFields` 被真实快照投影调用，凭据仅在批准的凭据区域和条件下加入。不能维护一个与实际导出无关的清单来通过检查。

嵌套持久对象有自己的类型和策略；新增嵌套字段同步更新对应策略、投影和读取校验。凭据不得进入普通消息／偏好；资源字段仍必须经过受管路径、字节预算、MIME、摘要、所有权和引用重映射校验。协议映射、模型／助手／对话 ID、版本和能力是结构，不是可丢弃参数。动态 JSON、供应商回放和用户自定义参数仍遵循各自既有边界；类型策略不提供自动语义验证。

绘图设置／预设使用 `projected` 策略，`src/backup/types.ts` 中 `projectedBackupTables` 是独立于原始可移植 `backupTables` 的静态清单；真实设置及嵌套 OpenAI 投影、预设读取均使用字段策略。设置仅包含比例、分辨率、模型 ID、OpenAI 尺寸／画质、数量、并发、提示音和可选复用协议；预设仅包含 id、name、content、createdAt、updatedAt。同名不同 ID 独立保存，正文空白不规范化。自动草稿提示词、参考图、任务／结果历史和图片排除；原始当前草稿／预设仅参与私有日志与回滚，不加入可移植 rows。#93 维护协调取代旧广泛绘图禁用规则，本地代码门禁、定向回归及独立 Sol/high 审查已完成；不得按旧 #83 整图库提案扩大实现。

## 迁移、默认值与失败

`migrateData` 对输入做私有克隆，只接受已声明的起始版本，按连续迁移函数前进；每步必须恰好增加一个版本。缺少步骤、无效结构或不支持版本都失败。函数本身不写数据库、偏好或源文件，调用方在整次转换和校验成功后才提交。

本机读取与备份读取复用同一迁移规则：搜索单配置 v1 → 双配置 v2 只将旧值保留为 MCP，并补齐 API 默认值；连接 v2 → v3 保持既有配置含义；会话配置目前 v1，没有凭空制造的升级步骤。正常读取不自动写回，不改变协议／目标、不请求网络、不自动启用功能。

绘图设置与预设当前模块 v1，无版本旧草稿按 v1 使用纯克隆读入口。缺失字段默认 auto 比例／分辨率、未选模型、OpenAI auto／auto、数量 1、并发 1、提示音开启；存在但非法的字段严格拒绝。本机草稿连同被排除的 prompt／references 结构在控制器任务恢复前校验，失败保留原数据。OpenAI 自定义尺寸沿用可编辑字符串合同，包括中间无效输入，不新增每字段长度限制；transport 在生成时验证能力和尺寸，备份总预算照常执行。

新增字段要明确缺省语义及何时应用，不能将未知结构当成缺失字段。可编辑的无效数值文本仍可保留供用户修正；结构错误不能因恢复默认而抹去原值。工作区初始化在事务内预检助手默认、对话配置、分支创建配置和历史配置，失败先于默认助手创建或行修复，事务保持原数据。界面显示的错误／临时默认值不授权持久覆盖。

普通启动先等待原生附件／背景／绘图文件围栏并恢复未完成备份日志，再严格读取当前连接配置，然后才挂载业务控制器；失败保留原配置并阻止编辑。用户可通过 `#backup` 进入独占维护入口：只有经校验、包含完整连接及凭据的备份和明确的替换确认，才可受控替换不兼容的本机配置，原始存储值由日志快照保护，失败回滚。合并／副本或缺少必要类别不能绕过读取失败。正常 App 进入前同步封锁聊天／绘图并排空写入，活动请求／自动命名需完成或由用户先取消，仅内存图片拒绝重载。冷维护保留历史状态，后续绘图普通初始化才恢复自身日志；不以读取错误推测空数据，也不以持久 running 标记推测活动请求。

历史 Dexie schema v3 升级在版本事务内预检本次要搬迁的 `chats.generationConfig` 和对话 `lastUsedModelId`，然后才移动／移除旧字段。预检失败使版本事务回滚，旧 schema 和全部行保持；这不声称覆盖任意未来旧 schema 中所有其他字段。会话语义与版本规则仍由同一个严格读入口承担。

## 兼容未来的限定参数

文档 v5 要求 `compatibility.minimumReaderVersion: 5`，当前顶层必需能力为空，模块集合必须恰好匹配基础模块和实际存在的绘图类别。旧 v4 仍要求最低读者 4 及固定七模块。模块声明包含 `version`、`minimumReaderVersion`、`requiredCapabilities`；最低读者超过当前读者或未知必需能力时要求升级。只有版本较新的 `session` 或 `drawingSettings` 模块声明可由当前读者读取时，才允许在已声明参数区过滤未知可选项，然后按当前语义校验。

允许区限于助手 `defaultConfig`、对话 `settings.config`／`creationConfig.config` 和历史 `generationConfig` 内的会话参数、数值设置及已知协议的思考参数，以及 `drawing.settings` 与嵌套 `openai` 参数。未知协议、模型 ID、凭据、安全字段、资源引用、草稿身份／prompt／references、预设正文结构、任意顶层／行字段及不支持的结构变化仍严格拒绝。可选字段名称受格式与安全词限制；未知值不进入请求、日志或兼容报告。

先检查原始文档预算，再克隆、转换、完整校验，最后形成恢复计划。过滤报告只含路径和计数，预览／结果说明再次保存或导出可能丢失参数，并要求保留原始备份文件。私有偏好 `ayase-studio.data-compatibility.v1` 保留路径，纳入恢复日志的快照／回滚；再次导出将路径加入兼容元数据并持续警告。它不保存被过滤值，也不改写源文件。恢复不下载 URL、不访问来源路径、不发送供应商请求。

v1–v4 文档继续按各自原始合同读取：v1–v3 不获得宽松参数过滤，v4 保留 #105 的限定会话兼容合同，不接受绘图区／模块／绘图过滤路径。v5 不能让已发布旧客户端自动读懂新格式，任意未来结构或语义也不会自动迁移。格式与加密细节见 [AYASE-BACKUP.md](AYASE-BACKUP.md)。

## 自动检查的能力边界

`npm.cmd run check:data-contracts` 是 `npm.cmd run check` 的一部分。AST 检查读取当前静态 Dexie `stores` 声明、追踪 `getItem`／`setItem`／`removeItem` 的可解析键（含导入常量和辅助函数参数），比较表／偏好注册，并分别比较 `included` 表与 `backupTables`、`projected` 表与 `projectedBackupTables`，防止投影表作为原始 rows 导出。新增未注册入口、过期注册和表备份策略漂移应失败。测试源码被排除，不读取应用数据或凭据。

任意动态拼接或运行时计算的存储键不保证被静态发现；持久键应使用可静态解析的声明，无法避免的动态入口须由人工登记、审查和专项测试覆盖。字段覆盖仅保护关联到实际 TypeScript 类型的已声明字段；不能代替嵌套策略、真实投影、语义校验、资源检查或独立审查。

## 开发与验收要求

每次数据变化同步类型／策略／注册、读取和导出投影、版本及迁移／默认政策、相关文档和确定性测试。测试按变化覆盖旧／当前版本、跨多个版本与重复读取、默认值、非法／未来结构零写入、允许参数过滤与拒绝边界、报告的预览／重启／再次导出及事务／日志回滚。使用合成数据和独立数据库，不读取真实用户数据、凭据或请求供应商。

运行数据契约检查及相关测试，然后按 [DEVELOPMENT.md](DEVELOPMENT.md#required-verification-before-handoff) 完成适当门禁。数据格式、迁移、模块协议、安全或发布门禁变化必须经独立 Sol/high 审查；主代理核对证据和修复。通过局部测试不代表原生文件窗口、真实恢复、断电或跨版本发布验收。

#93 本地接入设置／预设、恢复和维护协调；合并／副本保留本机设置，替换只改包含的绘图类别且保留 prompt／references，旧包／缺失类别不清空绘图。原始草稿／预设和普通表在同一日志及 Dexie 提交中保护；旧日志没有绘图快照时跳过该类别。任务、成果、图片、原生未决保存日志始终保留。#105 绘图接入及确定性跨版本样例已补齐；#93 本地代码门禁、定向回归与独立 Sol/high 审查完成。隔离浏览器恢复、浅深／自定义主题宽窄窗口视觉验收及 Tauri 编译／启动已有证据，实际原生窗口／文件窗口接受项和 #94 压力／桌面关闭重启仍待独立验收。当前状态见 [#105 记录](ISSUE-105-IMPLEMENTATION.md) 和 [#93 记录](ISSUE-93-IMPLEMENTATION.md)，不得以实现或门禁通过代替 Issue 完成／关闭。
