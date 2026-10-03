# #114 隔离验收

`npx.cmd vite --config scripts/general114/vite.config.ts` 启动独立 origin（1524），浏览器打开 `/scripts/general114/index.html` 验证真实 BackupApp → App → 常规设置、头像库和开关。不要填写真实密钥或发送模型请求。

原生 `npm.cmd run tauri dev -- --config scripts/general114/native.config.json --no-watch` 使用专用 identifier，启动真实宿主与托盘。SDK 探针通过生产 close listener 隐藏窗口，并报告 `.general114.local/native-report.jsonl` 的 `hidden-alive`；再次启动该构建的 debug exe 验证单实例恢复，然后模拟退出事件、勾选不再提醒并确认退出。随后用 `restart.config.json` 启动，检查重启偏好和跳过普通确认后的真实进程退出。

这不是鼠标点击托盘／标题栏或 OS Alt+F4 的验收；这些交互仍需用户手动检查。备份工作区退出保护要求先返回应用，不在恢复中结束进程。所有 probe 数据与日志仅为合成验收，`.general114.local` 被现有 `*.local` 规则排除。

`disabled.config.json` 通过真实常规页关闭驻留、开启确认，验证 SDK close→勾选不再提醒→取消保持窗口与原偏好，再次 close→确认退出。探针和正式入口一样启用 React.StrictMode。Vite 禁用文件监视，修改 fixture 后须重启 Vite 再运行；否则可能继续使用缓存模块。

`settings.config.json` 使用另一专用 identifier，验证 SDK 隐藏／恢复后发送生产 `ayase-open-settings` 事件进入常规，返回聊天保留合成草稿，再次请求仍进入常规，最后经普通确认退出。报告 `tray-settings-opened` 和 `tray-settings-repeated`；不将 SDK 模拟菜单路径记为真实托盘鼠标点击验收。

## 确认框定位回归

同一 Vite 服务打开 `/scripts/general114/confirmation-position.html`，点击“打开退出确认”或“打开长内容确认”。页面使用真实 `useConfirmation` 和完整 App.css（包含 Tailwind 重置），无存储、原生命令或供应商请求。底层 `role=status` 的 `PASS` / `FAIL` 检查确认框中心与视口中心偏差不超过 1px，且四周至少留出 15px；调整视口会重新检查。修复前退出确认坐标为 `(0, 0)` 并报告 `FAIL`，显式恢复 auto margin 后居中。应覆盖浅深主题、1280×900、720×520、390×640，以及长内容内部滚动；取消、Escape 和回焦仍走真实组件。
