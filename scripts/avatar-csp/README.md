# 内置头像与桌面 CSP

运行 `npm.cmd exec vite -- --config scripts/avatar-csp/vite.config.ts`，在 Codex in-app browser 打开 `http://127.0.0.1:1536/scripts/avatar-csp/index.html`。

响应头使用生产 CSP 的资源限制；仅增加 Vite React refresh 所需的开发脚本许可。同源 fetch 必须失败，11 家内置图案仍须成功生成透明 PNG。选择豆包并点击使用后，编辑器和助手展示应显示图案；切换主题重复验证。

夹具复用内存头像库，草稿也只在内存中。不会读取生产数据或调用服务商。确定性失败测试验证保留原头像、提示错误和重试。

保持夹具服务运行，执行 `npm.cmd run tauri dev -- --config scripts/avatar-csp/native.config.json`。隔离标识的宿主自动检查 WebView 中的 CSP 和 11 个快照，通过图片请求在服务日志输出 `AVATAR_CSP_NATIVE /?result=passed`，然后销毁测试窗口。失败同样回报；启动成功不能代替已安装发布版验收。
