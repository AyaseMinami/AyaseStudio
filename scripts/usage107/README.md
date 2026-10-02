# #107 隔离验收

在仓库根目录运行 `npx.cmd vite --config scripts/usage107/vite.config.ts`，打开 `http://127.0.0.1:1507/scripts/usage107/index.html`。

挂载实际 `ChatWorkspace`／`Composer`／统计组件，使用独立 `Usage107Synthetic` IndexedDB、合成计数及无操作发送回调。覆盖开始生成、缓存命中、零、缺失、停止、非流式、继续生成和无统计旧消息；可切换主题／窄宽度、重新读取及刷新验证本地存储。旧消息→开始生成→完成可比较输入框位置是否稳定，悬浮统计入口不应出现整行背景。入口不加载真实连接设置或凭据，不发供应商请求。

原生启动检查使用 `npm.cmd run tauri dev -- --config scripts/usage107/native.config.json`；该配置使用独立应用标识和隔离前端。启动成功不代表原生交互或真实供应商缓存验收。

入口独立类型检查：`npx.cmd tsc --noEmit -p scripts/usage107/tsconfig.json`。验收服务关闭 HMR／文件监听，修改后重新启动 Vite 并刷新页面再验证，避免沿用缓存模块。
