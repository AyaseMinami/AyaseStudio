# #108 真实聊天组件隔离预览

2026-10-03 外框调整后，“设置”入口使用真实 `AppearanceSettings` 控件与预览；外观控制器只读取本隔离源的 `chat108-appearance` 专用键，透明度／玻璃开关／主题可保存并重载。此说明取代下文“主题与透明度只在内存”的旧描述。人物背景对比后顶栏与功能栏透明度默认 40%、侧栏默认 50%、气泡默认 12%，统一透明度同时更新四区域。夹具支持无背景、合成渐变、密集明暗构图和可选生成壁纸，并提供外框／侧栏／气泡成组候选按钮及背景遮罩控制；生成壁纸需放在忽略目录 `.chat108.local/anime-opacity/wallpaper.png`，它是本地对比素材，不作为默认壁纸；原生资源选择／背景库操作在此夹具禁用。绘图入口只展示同样的透明 header 和外框，不能据此声称完整绘图交互已验收。

本轮使用新端口启动，避免连接旧实例：`npx.cmd vite --config scripts/chat108/vite.config.ts --port 1534`，浏览器入口 <http://127.0.0.1:1534/scripts/chat108/index.html>。隔离原生启动检查：`npm.cmd run tauri dev -- --no-watch --config scripts/chat108/native.config.json`，使用独立应用标识；启动后需手工体验 OS 拖动／窗口按钮，不自动截取或操控原生窗口。

## #98 玻璃性能对照

生产构建后运行隔离预览，打开 <http://127.0.0.1:1541/scripts/chat108/index.html?glass-performance=1>：

```powershell
npx.cmd tsc --project scripts/chat108/tsconfig.json
npx.cmd vite build --config scripts/chat108/vite.config.ts
npx.cmd vite preview --config scripts/chat108/vite.config.ts --host 127.0.0.1 --port 1541 --strictPort
```

仅查询参数启用时显示“采集浅色性能／采集深色性能”。将内置浏览器设置为 1440×900，分别运行两次并保存只读结果框中的 JSON。每次约三分钟；采集中保持页面可见、不进行其他交互、不同时跑构建／测试。运行后恢复侧栏玻璃关闭、输入框开启，变更只保存在该夹具 origin 的专用键。

采集使用真实消息组件、80 条内存合成消息、密集合成背景和四种玻璃组合；每个场景等待 800ms、采集 2500ms，交替顺序重复三轮。滚动由 rAF 设置真实滚动区，流式只按至少 50ms／24 字符更新内存消息，缩放只改变真实工作区 CSS 宽度。记录帧间隔、Long Tasks、操作次数、滤镜及导航显示状态；这不是实际输入设备、生产网络／持久化、OS 窗口缩放、GPU／耗电或原生 WebView2 验收。rAF 间隔也不是 GPU 实际呈现帧的直接计数。

最终范围、结果与用户验收清单见 [收尾记录](../../docs/ISSUE-98-108-CLOSEOUT.md)。性能采集模块只由此隔离夹具引用，不进入生产应用。

如需复查宽度变化的异常样本，可追加 `&glass-scenario=workspace-resize`，每个主题只采集该场景的 12 个窗口，不必重复空闲、滚动和模拟输出。

仓库根目录运行：

```powershell
npx.cmd vite --config scripts/chat108/vite.config.ts
```

打开 <http://127.0.0.1:1518/scripts/chat108/index.html>。固定独立端口且禁用 HMR／文件监听，修改源文件后需重启并刷新。使用真实 `AppShell`、`ConversationNavigation`、`ChatHeader`、`ChatWorkspace` 与外观设置的 `AppearanceChatPreview`；不导入生产 App 入口、不读取真实连接或凭据、不发送供应商请求。

主工作区使用此端口源下的 `Chat108Synthetic` 数据库。Vite 只在本夹具编译时将头像库默认单例指向相同合成库；生产源码不修改。搜索菜单的服务可用性只能读取此独立源的 localStorage。主题与宽窄选项仅在内存中，不保存生产外观偏好。合成背景、图片附件和图片头像均由本地 canvas 生成。CSP 限制网络连接为同源，图片只允许同源及 data/blob。

右上角“预览控制”默认折叠，可切换明暗、默认／阅读／自定义配色、纯色／复杂合成背景、0–100% 统一透明度、宽窄聊天和外观预览。阅读模式切到浅色；选择深色主题时退出阅读配色，与真实设置一致。自定义配色指定深色用户气泡 `#18364a` 与暖色助手气泡（浅色主题 `#e9cfaa`、深色主题 `#443d32`），通过真实 `applyInitialAppearance` 和颜色推导应用，观察移入气泡后的消息操作／版本箭头／编辑控件与前景色；用户前景色仍服从生产可读性调整，助手气泡选色与当前主题正文适配。聊天顶部与输入工具栏的真实宽窄开关共享此内存状态。真实导航展开／收缩、菜单、创建和管理会话／助手、输入框展开、思考／搜索菜单、消息复制、图片预览、代码／表格／公式及生成统计均可观察。第一次建立六个助手、阅读助手的长列表及三组问答；最后一轮有两个版本。初始定位底部，可向上滚动检查短消息与图片。

消息编辑、删除、分支和版本切换调用真实 repository 命令；清空与发送使用真实 SessionStore 写入合成会话。发送只插入固定合成回复。编辑并发送保存编辑后显示离线提示，重新生成仅显示离线提示，均不执行模型生成。空模型选择器保留实际弹层；附件上传／原生文件选择、真实服务请求、实际生成过程和桌面窗口行为不属于本夹具验收。使用“恢复当前会话示例”可在合成库中恢复样例，已有合成会话不会在刷新时自动覆盖。

验证：

```powershell
npx.cmd tsc --project scripts/chat108/tsconfig.json
npx.cmd vite build --config scripts/chat108/vite.config.ts
git diff --check -- scripts/chat108
```

构建输出与缓存放在已忽略的 `.chat108.local/`。浏览器视觉验收和交互检查由主任务执行；此夹具本身不代表原生桌面验收。
