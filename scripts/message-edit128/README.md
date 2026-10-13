# #128 隔离验收

运行 `npm.cmd run dev -- --config scripts/message-edit128/vite.config.ts`，打开 `http://127.0.0.1:1528/scripts/message-edit128/`。

使用真实 useChatSession、MessageEdits、仓库及 ChatWorkspace；Vite 仅替换 hook 的仓库工厂（独立 MessageEdit128Synthetic 数据库）、模拟原生文件适配和模拟 transport。独立 origin 中的连接配置只有合成凭据，CSP 限制同源网络，不读取生产数据库、受管文件或实际 Key。模拟保存/供应商故障可通过页首按钮控制。合成文件字节只保留在该页的内存及 sessionStorage，不是生产文件能力；新标签会重新合成已知初始原件，其它缺件可移除/编辑保存。

验收仅用户附件增删、待移除与撤销、文件选择/图片粘贴/投放隔离、预览、保存失败草稿保留、保存并发送的候选、浅深主题及 440×620/支持的窄窗口。不能将浏览器模拟当成原生文件窗口、退出重启、磁盘故障或真实供应商接受。

保持前端服务运行后，隔离原生启动：`npm.cmd run tauri dev -- --no-watch --config scripts/message-edit128/native.config.json`。使用独立应用标识，不安装或访问用户数据；启动不证明原生文件对话框/关闭互动已通过。
