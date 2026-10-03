# #114 常规设置与后台驻留

2026-10-03：用户确认新增“常规”分类、头像并入个人资料、缩小日常头像预览，并授权本地实施；后续应用级行为与个人偏好可在常规按用途分组。Issue 原文未描述托盘与设置布局，本轮对话补充这些决定，远端验收评论记录最终范围。

## 结果

- 常规导航置首并作为首次设置入口；个人资料采用 64×64px 头像，头像库及大裁切编辑仍使用现有弹窗。没有新增头像格式或改变资源所有权。
- 后台运行和退出确认默认开启并在本机重启后保留；驻留关闭才把普通关闭作为退出。托盘左键／打开菜单、重复启动恢复已有窗口；明确的退出菜单始终进入退出流程。
- 隐藏保留原 WebView、聊天与绘图任务，不调用绘图停机。真正退出依次执行普通确认和独立绘图保护；“不再提醒”仅控制普通确认，取消任何确认都不记住新选择。
- 本机 general v1 偏好严格校验、纯克隆默认，未知原文零覆盖；设备行为明确排除可移植备份。合同见 [DATA-CONTRACTS.md](DATA-CONTRACTS.md)。
- 备份工作区真正退出要求先返回应用，避免打断维护；仍允许隐藏窗口。没有开启自启动、通知、自动请求或失败重试。

## 证据

- 最终 `npm.cmd run check`：159 文件、2755 项前端测试；数据注册检查覆盖 14 表、9 偏好键、9 备份表；TypeScript／Vite 构建通过。
- Rust 单元测试 147 通过、1 忽略；Cargo check 和 Tauri dev 编译／启动成功。
- 独立 Sol/high 只读审查发现嵌套头像弹窗 cancel 传播缺陷；两个 cancel 处理器隔离传播，三个 bubbles:false 回归先红后绿；复审通过。另做实际生命周期 hook 的确定性 StrictMode 重放验证，确认只保留一组有效监听及完整释放。
- 内置浏览器的真实应用独立 origin 验证 1280×720／720×520 浅深主题、64px 头像、无页面横向溢出、开关刷新保留、头像库打开和关闭回焦；窄屏分类栏沿原规则局部横向滚动。预览保存在本地 `.general114.local/general-settings.jpg`。
- 隔离原生 identifier、SDK 生产路径：`hidden-alive`、`restored-by-second-instance`、带“不再提醒”的普通确认后退出，首轮进程退出码 0；StrictMode 重启保存 `{backgroundResident:true,confirmBeforeExit:false}`，明确退出无需普通确认，进程退出码 0。
- 第二原生场景经真实常规页关闭驻留、开启确认，SDK close 后勾选不再提醒并取消，窗口仍可见且偏好为 `{backgroundResident:false,confirmBeforeExit:true}`；再次确认退出，进程退出码 0。原生阶段记录为 `.general114.local/native-report.jsonl`；复现入口见 [scripts/general114](../scripts/general114/README.md)。

## 接受边界

用户随后明确反馈已实际体验、本轮结果可以接受，并授权提交、推送代码及通过 #114。本轮用户实际使用接受与上述自动化／SDK 证据分别记录；用户未逐项列举所有鼠标、键盘或运行中任务场景，不据此补造逐项测试结果。

未使用原生桌面截图或原生 UI 自动化，未读取真实凭据、调用供应商。SDK 隐藏／恢复／退出证据不替代真实鼠标托盘左／右键、标题栏 ×、OS Alt+F4、运行中任务及异常关机的逐项交互测试。尤其不能从前端定向测试推断真实供应商后台完成或原生失焦节流表现。授权交付到 dev、验收评论和 Issue 关闭；实际提交与远端状态以 Git 历史及 Issue 为准。未授权或执行安装包打包及 Release。

原生 API 参考：[Tauri 托盘](https://v2.tauri.app/learn/system-tray/)与[单实例插件](https://v2.tauri.app/plugin/single-instance/)。

## 托盘设置入口后续补充（2026-10-03）

用户在原 #114 交付后要求补齐托盘“设置”。右键菜单现在依次提供“打开 Ayase Studio／设置／退出”。设置恢复已有 main 窗口，发出 `ayase-open-settings` 并切到常规；不重载应用，保留聊天草稿和任务。根监听在启动保护期间保留请求，备份恢复页继续保护，备份准备及绘图退出期间延迟导航。无新增持久化字段或原生权限。

补充验证：`npm.cmd run check` 160 文件、2758 项测试及构建通过；Cargo check 通过。独立 Sol/high 审查修正隔离探针的受限 SDK 恢复调用后复审通过，改用第二实例走生产 Rust 恢复。Tauri dev 编译／启动与 `settings.config.json` 原生 SDK 探针通过：`tray-settings-hidden`、`tray-settings-opened`（visible:true）、`tray-settings-repeated`（draftPreserved:true），经普通确认后进程退出码 0。日志为 `.general114.local/tray-check-final.log`、`tray-native-final.log` 和 `native-report.jsonl`。真实右键选择菜单仍待手动接受；本次 SDK 证据与此前用户接受分开记录。
