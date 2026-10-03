# 第三方依赖锁定清单

由 `node scripts/inventory-third-party.mjs` 生成；使用本机已安装依赖与离线 Cargo metadata，不安装、不联网。

本表记录原始许可证声明与本机证据文件名，不把 OR 改成 AND，不替项目选择许可分支，也不代替许可证全文/NOTICE 随包分发。
npm 包括开发、可选及跨平台锁定项；Rust 包括 metadata 返回的全部目标/构建/开发依赖，均是保守清单，不是 Windows EXE 的实际链接清单。
缺少本机许可文件与嵌套依赖需按 [许可说明](THIRD-PARTY-LICENSES.md) 继续核实；源码下载位置不等于品牌素材授权。

- package-lock.json SHA-256: `ca47a162e8f3a4654fb9f32b37287d79091cb5a165b264386b325197c802418d`
- src-tauri/Cargo.lock SHA-256: `63f58f8f02ad21f4bdb4feb30a9924a156af5eaebfd4cbbd3d78c81f58c62aff`
- npm: 272 个锁定位置；其中 151 个非 dev 项。
- Rust: 556 个外部包。

## npm

| 包 / 锁定位置 | 版本 | 范围 | 原始声明 | 本机顶层证据 |
| --- | --- | --- | --- | --- |
| [node_modules/@jridgewell/gen-mapping](https://www.npmjs.com/package/%40jridgewell%2Fgen-mapping/v/0.3.13) | 0.3.13 | 传递 / 开发 | MIT | LICENSE |
| [node_modules/@jridgewell/remapping](https://www.npmjs.com/package/%40jridgewell%2Fremapping/v/2.3.5) | 2.3.5 | 传递 / 开发 | MIT | LICENSE |
| [node_modules/@jridgewell/resolve-uri](https://www.npmjs.com/package/%40jridgewell%2Fresolve-uri/v/3.1.2) | 3.1.2 | 传递 / 开发 | MIT | LICENSE |
| [node_modules/@jridgewell/sourcemap-codec](https://www.npmjs.com/package/%40jridgewell%2Fsourcemap-codec/v/1.6.0) | 1.6.0 | 传递 / 开发 | MIT | LICENSE |
| [node_modules/@jridgewell/trace-mapping](https://www.npmjs.com/package/%40jridgewell%2Ftrace-mapping/v/0.3.31) | 0.3.31 | 传递 / 开发 | MIT | LICENSE |
| [node_modules/@napi-rs/canvas](https://www.npmjs.com/package/%40napi-rs%2Fcanvas/v/1.0.9) | 1.0.9 | 传递 / 非 dev / 可选 | MIT | LICENSE |
| [node_modules/@napi-rs/canvas-android-arm64](https://www.npmjs.com/package/%40napi-rs%2Fcanvas-android-arm64/v/1.0.9) | 1.0.9 | 传递 / 非 dev / 可选 | MIT | 未安装；仅锁文件声明 |
| [node_modules/@napi-rs/canvas-darwin-arm64](https://www.npmjs.com/package/%40napi-rs%2Fcanvas-darwin-arm64/v/1.0.9) | 1.0.9 | 传递 / 非 dev / 可选 | MIT | 未安装；仅锁文件声明 |
| [node_modules/@napi-rs/canvas-darwin-x64](https://www.npmjs.com/package/%40napi-rs%2Fcanvas-darwin-x64/v/1.0.9) | 1.0.9 | 传递 / 非 dev / 可选 | MIT | 未安装；仅锁文件声明 |
| [node_modules/@napi-rs/canvas-linux-arm-gnueabihf](https://www.npmjs.com/package/%40napi-rs%2Fcanvas-linux-arm-gnueabihf/v/1.0.9) | 1.0.9 | 传递 / 非 dev / 可选 | MIT | 未安装；仅锁文件声明 |
| [node_modules/@napi-rs/canvas-linux-arm64-gnu](https://www.npmjs.com/package/%40napi-rs%2Fcanvas-linux-arm64-gnu/v/1.0.9) | 1.0.9 | 传递 / 非 dev / 可选 | MIT | 未安装；仅锁文件声明 |
| [node_modules/@napi-rs/canvas-linux-arm64-musl](https://www.npmjs.com/package/%40napi-rs%2Fcanvas-linux-arm64-musl/v/1.0.9) | 1.0.9 | 传递 / 非 dev / 可选 | MIT | 未安装；仅锁文件声明 |
| [node_modules/@napi-rs/canvas-linux-riscv64-gnu](https://www.npmjs.com/package/%40napi-rs%2Fcanvas-linux-riscv64-gnu/v/1.0.9) | 1.0.9 | 传递 / 非 dev / 可选 | MIT | 未安装；仅锁文件声明 |
| [node_modules/@napi-rs/canvas-linux-x64-gnu](https://www.npmjs.com/package/%40napi-rs%2Fcanvas-linux-x64-gnu/v/1.0.9) | 1.0.9 | 传递 / 非 dev / 可选 | MIT | 未安装；仅锁文件声明 |
| [node_modules/@napi-rs/canvas-linux-x64-musl](https://www.npmjs.com/package/%40napi-rs%2Fcanvas-linux-x64-musl/v/1.0.9) | 1.0.9 | 传递 / 非 dev / 可选 | MIT | 未安装；仅锁文件声明 |
| [node_modules/@napi-rs/canvas-win32-arm64-msvc](https://www.npmjs.com/package/%40napi-rs%2Fcanvas-win32-arm64-msvc/v/1.0.9) | 1.0.9 | 传递 / 非 dev / 可选 | MIT | 未安装；仅锁文件声明 |
| [node_modules/@napi-rs/canvas-win32-x64-msvc](https://www.npmjs.com/package/%40napi-rs%2Fcanvas-win32-x64-msvc/v/1.0.9) | 1.0.9 | 传递 / 非 dev / 可选 | MIT | 无顶层许可文件；需查上游/嵌套目录 |
| [node_modules/@oxc-project/types](https://www.npmjs.com/package/%40oxc-project%2Ftypes/v/0.149.0) | 0.149.0 | 传递 / 开发 | MIT | LICENSE |
| [node_modules/@rolldown/binding-android-arm-eabi](https://www.npmjs.com/package/%40rolldown%2Fbinding-android-arm-eabi/v/1.2.8) | 1.2.8 | 传递 / 开发 / 可选 | MIT | 未安装；仅锁文件声明 |
| [node_modules/@rolldown/binding-android-arm64](https://www.npmjs.com/package/%40rolldown%2Fbinding-android-arm64/v/1.2.8) | 1.2.8 | 传递 / 开发 / 可选 | MIT | 未安装；仅锁文件声明 |
| [node_modules/@rolldown/binding-darwin-arm64](https://www.npmjs.com/package/%40rolldown%2Fbinding-darwin-arm64/v/1.2.8) | 1.2.8 | 传递 / 开发 / 可选 | MIT | 未安装；仅锁文件声明 |
| [node_modules/@rolldown/binding-darwin-x64](https://www.npmjs.com/package/%40rolldown%2Fbinding-darwin-x64/v/1.2.8) | 1.2.8 | 传递 / 开发 / 可选 | MIT | 未安装；仅锁文件声明 |
| [node_modules/@rolldown/binding-freebsd-x64](https://www.npmjs.com/package/%40rolldown%2Fbinding-freebsd-x64/v/1.2.8) | 1.2.8 | 传递 / 开发 / 可选 | MIT | 未安装；仅锁文件声明 |
| [node_modules/@rolldown/binding-linux-arm-gnueabihf](https://www.npmjs.com/package/%40rolldown%2Fbinding-linux-arm-gnueabihf/v/1.2.8) | 1.2.8 | 传递 / 开发 / 可选 | MIT | 未安装；仅锁文件声明 |
| [node_modules/@rolldown/binding-linux-arm64-gnu](https://www.npmjs.com/package/%40rolldown%2Fbinding-linux-arm64-gnu/v/1.2.8) | 1.2.8 | 传递 / 开发 / 可选 | MIT | 未安装；仅锁文件声明 |
| [node_modules/@rolldown/binding-linux-arm64-musl](https://www.npmjs.com/package/%40rolldown%2Fbinding-linux-arm64-musl/v/1.2.8) | 1.2.8 | 传递 / 开发 / 可选 | MIT | 未安装；仅锁文件声明 |
| [node_modules/@rolldown/binding-linux-ppc64-gnu](https://www.npmjs.com/package/%40rolldown%2Fbinding-linux-ppc64-gnu/v/1.2.8) | 1.2.8 | 传递 / 开发 / 可选 | MIT | 未安装；仅锁文件声明 |
| [node_modules/@rolldown/binding-linux-s390x-gnu](https://www.npmjs.com/package/%40rolldown%2Fbinding-linux-s390x-gnu/v/1.2.8) | 1.2.8 | 传递 / 开发 / 可选 | MIT | 未安装；仅锁文件声明 |
| [node_modules/@rolldown/binding-linux-x64-gnu](https://www.npmjs.com/package/%40rolldown%2Fbinding-linux-x64-gnu/v/1.2.8) | 1.2.8 | 传递 / 开发 / 可选 | MIT | 未安装；仅锁文件声明 |
| [node_modules/@rolldown/binding-linux-x64-musl](https://www.npmjs.com/package/%40rolldown%2Fbinding-linux-x64-musl/v/1.2.8) | 1.2.8 | 传递 / 开发 / 可选 | MIT | 未安装；仅锁文件声明 |
| [node_modules/@rolldown/binding-openharmony-arm64](https://www.npmjs.com/package/%40rolldown%2Fbinding-openharmony-arm64/v/1.2.8) | 1.2.8 | 传递 / 开发 / 可选 | MIT | 未安装；仅锁文件声明 |
| [node_modules/@rolldown/binding-win32-arm64-msvc](https://www.npmjs.com/package/%40rolldown%2Fbinding-win32-arm64-msvc/v/1.2.8) | 1.2.8 | 传递 / 开发 / 可选 | MIT | 未安装；仅锁文件声明 |
| [node_modules/@rolldown/binding-win32-x64-msvc](https://www.npmjs.com/package/%40rolldown%2Fbinding-win32-x64-msvc/v/1.2.8) | 1.2.8 | 传递 / 开发 / 可选 | MIT | 无顶层许可文件；需查上游/嵌套目录 |
| [node_modules/@rolldown/pluginutils](https://www.npmjs.com/package/%40rolldown%2Fpluginutils/v/1.0.1) | 1.0.1 | 传递 / 开发 | MIT | LICENSE |
| [node_modules/@tailwindcss/node](https://www.npmjs.com/package/%40tailwindcss%2Fnode/v/4.3.3) | 4.3.3 | 传递 / 开发 | MIT | LICENSE |
| [node_modules/@tailwindcss/node/node_modules/lightningcss](https://www.npmjs.com/package/lightningcss/v/1.32.0) | 1.32.0 | 传递 / 开发 | MPL-2.0 | LICENSE |
| [node_modules/@tailwindcss/node/node_modules/lightningcss-android-arm64](https://www.npmjs.com/package/lightningcss-android-arm64/v/1.32.0) | 1.32.0 | 传递 / 开发 / 可选 | MPL-2.0 | 未安装；仅锁文件声明 |
| [node_modules/@tailwindcss/node/node_modules/lightningcss-darwin-arm64](https://www.npmjs.com/package/lightningcss-darwin-arm64/v/1.32.0) | 1.32.0 | 传递 / 开发 / 可选 | MPL-2.0 | 未安装；仅锁文件声明 |
| [node_modules/@tailwindcss/node/node_modules/lightningcss-darwin-x64](https://www.npmjs.com/package/lightningcss-darwin-x64/v/1.32.0) | 1.32.0 | 传递 / 开发 / 可选 | MPL-2.0 | 未安装；仅锁文件声明 |
| [node_modules/@tailwindcss/node/node_modules/lightningcss-freebsd-x64](https://www.npmjs.com/package/lightningcss-freebsd-x64/v/1.32.0) | 1.32.0 | 传递 / 开发 / 可选 | MPL-2.0 | 未安装；仅锁文件声明 |
| [node_modules/@tailwindcss/node/node_modules/lightningcss-linux-arm-gnueabihf](https://www.npmjs.com/package/lightningcss-linux-arm-gnueabihf/v/1.32.0) | 1.32.0 | 传递 / 开发 / 可选 | MPL-2.0 | 未安装；仅锁文件声明 |
| [node_modules/@tailwindcss/node/node_modules/lightningcss-linux-arm64-gnu](https://www.npmjs.com/package/lightningcss-linux-arm64-gnu/v/1.32.0) | 1.32.0 | 传递 / 开发 / 可选 | MPL-2.0 | 未安装；仅锁文件声明 |
| [node_modules/@tailwindcss/node/node_modules/lightningcss-linux-arm64-musl](https://www.npmjs.com/package/lightningcss-linux-arm64-musl/v/1.32.0) | 1.32.0 | 传递 / 开发 / 可选 | MPL-2.0 | 未安装；仅锁文件声明 |
| [node_modules/@tailwindcss/node/node_modules/lightningcss-linux-x64-gnu](https://www.npmjs.com/package/lightningcss-linux-x64-gnu/v/1.32.0) | 1.32.0 | 传递 / 开发 / 可选 | MPL-2.0 | 未安装；仅锁文件声明 |
| [node_modules/@tailwindcss/node/node_modules/lightningcss-linux-x64-musl](https://www.npmjs.com/package/lightningcss-linux-x64-musl/v/1.32.0) | 1.32.0 | 传递 / 开发 / 可选 | MPL-2.0 | 未安装；仅锁文件声明 |
| [node_modules/@tailwindcss/node/node_modules/lightningcss-win32-arm64-msvc](https://www.npmjs.com/package/lightningcss-win32-arm64-msvc/v/1.32.0) | 1.32.0 | 传递 / 开发 / 可选 | MPL-2.0 | 未安装；仅锁文件声明 |
| [node_modules/@tailwindcss/node/node_modules/lightningcss-win32-x64-msvc](https://www.npmjs.com/package/lightningcss-win32-x64-msvc/v/1.32.0) | 1.32.0 | 传递 / 开发 / 可选 | MPL-2.0 | LICENSE |
| [node_modules/@tailwindcss/oxide](https://www.npmjs.com/package/%40tailwindcss%2Foxide/v/4.3.3) | 4.3.3 | 传递 / 开发 | MIT | LICENSE |
| [node_modules/@tailwindcss/oxide-android-arm64](https://www.npmjs.com/package/%40tailwindcss%2Foxide-android-arm64/v/4.3.3) | 4.3.3 | 传递 / 开发 / 可选 | MIT | 未安装；仅锁文件声明 |
| [node_modules/@tailwindcss/oxide-darwin-arm64](https://www.npmjs.com/package/%40tailwindcss%2Foxide-darwin-arm64/v/4.3.3) | 4.3.3 | 传递 / 开发 / 可选 | MIT | 未安装；仅锁文件声明 |
| [node_modules/@tailwindcss/oxide-darwin-x64](https://www.npmjs.com/package/%40tailwindcss%2Foxide-darwin-x64/v/4.3.3) | 4.3.3 | 传递 / 开发 / 可选 | MIT | 未安装；仅锁文件声明 |
| [node_modules/@tailwindcss/oxide-freebsd-x64](https://www.npmjs.com/package/%40tailwindcss%2Foxide-freebsd-x64/v/4.3.3) | 4.3.3 | 传递 / 开发 / 可选 | MIT | 未安装；仅锁文件声明 |
| [node_modules/@tailwindcss/oxide-linux-arm-gnueabihf](https://www.npmjs.com/package/%40tailwindcss%2Foxide-linux-arm-gnueabihf/v/4.3.3) | 4.3.3 | 传递 / 开发 / 可选 | MIT | 未安装；仅锁文件声明 |
| [node_modules/@tailwindcss/oxide-linux-arm64-gnu](https://www.npmjs.com/package/%40tailwindcss%2Foxide-linux-arm64-gnu/v/4.3.3) | 4.3.3 | 传递 / 开发 / 可选 | MIT | 未安装；仅锁文件声明 |
| [node_modules/@tailwindcss/oxide-linux-arm64-musl](https://www.npmjs.com/package/%40tailwindcss%2Foxide-linux-arm64-musl/v/4.3.3) | 4.3.3 | 传递 / 开发 / 可选 | MIT | 未安装；仅锁文件声明 |
| [node_modules/@tailwindcss/oxide-linux-x64-gnu](https://www.npmjs.com/package/%40tailwindcss%2Foxide-linux-x64-gnu/v/4.3.3) | 4.3.3 | 传递 / 开发 / 可选 | MIT | 未安装；仅锁文件声明 |
| [node_modules/@tailwindcss/oxide-linux-x64-musl](https://www.npmjs.com/package/%40tailwindcss%2Foxide-linux-x64-musl/v/4.3.3) | 4.3.3 | 传递 / 开发 / 可选 | MIT | 未安装；仅锁文件声明 |
| [node_modules/@tailwindcss/oxide-wasm32-wasi](https://www.npmjs.com/package/%40tailwindcss%2Foxide-wasm32-wasi/v/4.3.3) | 4.3.3 | 传递 / 开发 / 可选 | MIT | 未安装；仅锁文件声明 |
| [node_modules/@tailwindcss/oxide-win32-arm64-msvc](https://www.npmjs.com/package/%40tailwindcss%2Foxide-win32-arm64-msvc/v/4.3.3) | 4.3.3 | 传递 / 开发 / 可选 | MIT | 未安装；仅锁文件声明 |
| [node_modules/@tailwindcss/oxide-win32-x64-msvc](https://www.npmjs.com/package/%40tailwindcss%2Foxide-win32-x64-msvc/v/4.3.3) | 4.3.3 | 传递 / 开发 / 可选 | MIT | LICENSE |
| [node_modules/@tailwindcss/vite](https://www.npmjs.com/package/%40tailwindcss%2Fvite/v/4.3.3) | 4.3.3 | 直接 / 开发 | MIT | LICENSE |
| [node_modules/@tauri-apps/api](https://www.npmjs.com/package/%40tauri-apps%2Fapi/v/2.11.1) | 2.11.1 | 直接 / 非 dev | Apache-2.0 OR MIT | LICENSE_APACHE-2.0, LICENSE_MIT |
| [node_modules/@tauri-apps/cli](https://www.npmjs.com/package/%40tauri-apps%2Fcli/v/2.11.4) | 2.11.4 | 直接 / 开发 | Apache-2.0 OR MIT | LICENSE_APACHE-2.0, LICENSE_MIT |
| [node_modules/@tauri-apps/cli-darwin-arm64](https://www.npmjs.com/package/%40tauri-apps%2Fcli-darwin-arm64/v/2.11.4) | 2.11.4 | 传递 / 开发 / 可选 | Apache-2.0 OR MIT | 未安装；仅锁文件声明 |
| [node_modules/@tauri-apps/cli-darwin-x64](https://www.npmjs.com/package/%40tauri-apps%2Fcli-darwin-x64/v/2.11.4) | 2.11.4 | 传递 / 开发 / 可选 | Apache-2.0 OR MIT | 未安装；仅锁文件声明 |
| [node_modules/@tauri-apps/cli-linux-arm-gnueabihf](https://www.npmjs.com/package/%40tauri-apps%2Fcli-linux-arm-gnueabihf/v/2.11.4) | 2.11.4 | 传递 / 开发 / 可选 | Apache-2.0 OR MIT | 未安装；仅锁文件声明 |
| [node_modules/@tauri-apps/cli-linux-arm64-gnu](https://www.npmjs.com/package/%40tauri-apps%2Fcli-linux-arm64-gnu/v/2.11.4) | 2.11.4 | 传递 / 开发 / 可选 | Apache-2.0 OR MIT | 未安装；仅锁文件声明 |
| [node_modules/@tauri-apps/cli-linux-arm64-musl](https://www.npmjs.com/package/%40tauri-apps%2Fcli-linux-arm64-musl/v/2.11.4) | 2.11.4 | 传递 / 开发 / 可选 | Apache-2.0 OR MIT | 未安装；仅锁文件声明 |
| [node_modules/@tauri-apps/cli-linux-riscv64-gnu](https://www.npmjs.com/package/%40tauri-apps%2Fcli-linux-riscv64-gnu/v/2.11.4) | 2.11.4 | 传递 / 开发 / 可选 | Apache-2.0 OR MIT | 未安装；仅锁文件声明 |
| [node_modules/@tauri-apps/cli-linux-x64-gnu](https://www.npmjs.com/package/%40tauri-apps%2Fcli-linux-x64-gnu/v/2.11.4) | 2.11.4 | 传递 / 开发 / 可选 | Apache-2.0 OR MIT | 未安装；仅锁文件声明 |
| [node_modules/@tauri-apps/cli-linux-x64-musl](https://www.npmjs.com/package/%40tauri-apps%2Fcli-linux-x64-musl/v/2.11.4) | 2.11.4 | 传递 / 开发 / 可选 | Apache-2.0 OR MIT | 未安装；仅锁文件声明 |
| [node_modules/@tauri-apps/cli-win32-arm64-msvc](https://www.npmjs.com/package/%40tauri-apps%2Fcli-win32-arm64-msvc/v/2.11.4) | 2.11.4 | 传递 / 开发 / 可选 | Apache-2.0 OR MIT | 未安装；仅锁文件声明 |
| [node_modules/@tauri-apps/cli-win32-ia32-msvc](https://www.npmjs.com/package/%40tauri-apps%2Fcli-win32-ia32-msvc/v/2.11.4) | 2.11.4 | 传递 / 开发 / 可选 | Apache-2.0 OR MIT | 未安装；仅锁文件声明 |
| [node_modules/@tauri-apps/cli-win32-x64-msvc](https://www.npmjs.com/package/%40tauri-apps%2Fcli-win32-x64-msvc/v/2.11.4) | 2.11.4 | 传递 / 开发 / 可选 | Apache-2.0 OR MIT | 无顶层许可文件；需查上游/嵌套目录 |
| [node_modules/@tauri-apps/plugin-http](https://www.npmjs.com/package/%40tauri-apps%2Fplugin-http/v/2.6.0) | 2.6.0 | 直接 / 非 dev | MIT OR Apache-2.0 | LICENSE.spdx |
| [node_modules/@tauri-apps/plugin-opener](https://www.npmjs.com/package/%40tauri-apps%2Fplugin-opener/v/2.5.5) | 2.5.5 | 直接 / 非 dev | MIT OR Apache-2.0 | LICENSE.spdx |
| [node_modules/@types/chai](https://www.npmjs.com/package/%40types%2Fchai/v/5.2.3) | 5.2.3 | 传递 / 开发 | MIT | LICENSE |
| [node_modules/@types/debug](https://www.npmjs.com/package/%40types%2Fdebug/v/4.1.13) | 4.1.13 | 传递 / 非 dev | MIT | LICENSE |
| [node_modules/@types/deep-eql](https://www.npmjs.com/package/%40types%2Fdeep-eql/v/4.0.2) | 4.0.2 | 传递 / 开发 | MIT | LICENSE |
| [node_modules/@types/estree](https://www.npmjs.com/package/%40types%2Festree/v/1.0.9) | 1.0.9 | 传递 / 非 dev | MIT | LICENSE |
| [node_modules/@types/estree-jsx](https://www.npmjs.com/package/%40types%2Festree-jsx/v/1.0.5) | 1.0.5 | 传递 / 非 dev | MIT | LICENSE |
| [node_modules/@types/hast](https://www.npmjs.com/package/%40types%2Fhast/v/3.0.5) | 3.0.5 | 传递 / 非 dev | MIT | LICENSE |
| [node_modules/@types/katex](https://www.npmjs.com/package/%40types%2Fkatex/v/0.16.8) | 0.16.8 | 传递 / 非 dev | MIT | LICENSE |
| [node_modules/@types/mdast](https://www.npmjs.com/package/%40types%2Fmdast/v/4.0.4) | 4.0.4 | 直接 / 非 dev | MIT | LICENSE |
| [node_modules/@types/ms](https://www.npmjs.com/package/%40types%2Fms/v/2.1.0) | 2.1.0 | 传递 / 非 dev | MIT | LICENSE |
| [node_modules/@types/node](https://www.npmjs.com/package/%40types%2Fnode/v/26.5.1) | 26.5.1 | 传递 / 开发 | MIT | LICENSE |
| [node_modules/@types/react](https://www.npmjs.com/package/%40types%2Freact/v/19.3.0) | 19.3.0 | 直接 / 非 dev | MIT | LICENSE |
| [node_modules/@types/react-dom](https://www.npmjs.com/package/%40types%2Freact-dom/v/19.3.0) | 19.3.0 | 直接 / 开发 | MIT | LICENSE |
| [node_modules/@types/unist](https://www.npmjs.com/package/%40types%2Funist/v/3.0.3) | 3.0.3 | 传递 / 非 dev | MIT | LICENSE |
| [node_modules/@types/whatwg-mimetype](https://www.npmjs.com/package/%40types%2Fwhatwg-mimetype/v/3.0.2) | 3.0.2 | 传递 / 开发 | MIT | LICENSE |
| [node_modules/@types/ws](https://www.npmjs.com/package/%40types%2Fws/v/8.18.1) | 8.18.1 | 传递 / 开发 | MIT | LICENSE |
| [node_modules/@ungap/structured-clone](https://www.npmjs.com/package/%40ungap%2Fstructured-clone/v/1.4.0) | 1.4.0 | 传递 / 非 dev | ISC | LICENSE |
| [node_modules/@vitejs/plugin-react](https://www.npmjs.com/package/%40vitejs%2Fplugin-react/v/6.1.1) | 6.1.1 | 直接 / 开发 | MIT | LICENSE |
| [node_modules/@vitest/mocker](https://www.npmjs.com/package/%40vitest%2Fmocker/v/5.0.0) | 5.0.0 | 传递 / 开发 | MIT | LICENSE |
| [node_modules/@vitest/mocker/node_modules/magic-string](https://www.npmjs.com/package/magic-string/v/1.3.1) | 1.3.1 | 传递 / 开发 | MIT | LICENSE |
| [node_modules/@vitest/spy](https://www.npmjs.com/package/%40vitest%2Fspy/v/5.0.0) | 5.0.0 | 传递 / 开发 | MIT | LICENSE |
| [node_modules/assertion-error](https://www.npmjs.com/package/assertion-error/v/2.0.1) | 2.0.1 | 传递 / 开发 | MIT | LICENSE |
| [node_modules/bail](https://www.npmjs.com/package/bail/v/2.0.2) | 2.0.2 | 传递 / 非 dev | MIT | license |
| [node_modules/base64-js](https://www.npmjs.com/package/base64-js/v/1.5.1) | 1.5.1 | 传递 / 非 dev | MIT | LICENSE |
| [node_modules/buffer-image-size](https://www.npmjs.com/package/buffer-image-size/v/0.6.4) | 0.6.4 | 传递 / 开发 | MIT | LICENSE |
| [node_modules/ccount](https://www.npmjs.com/package/ccount/v/2.0.1) | 2.0.1 | 传递 / 非 dev | MIT | license |
| [node_modules/chai](https://www.npmjs.com/package/chai/v/6.2.2) | 6.2.2 | 传递 / 开发 | MIT | LICENSE |
| [node_modules/character-entities](https://www.npmjs.com/package/character-entities/v/2.0.2) | 2.0.2 | 传递 / 非 dev | MIT | license |
| [node_modules/character-entities-html4](https://www.npmjs.com/package/character-entities-html4/v/2.1.0) | 2.1.0 | 传递 / 非 dev | MIT | license |
| [node_modules/character-entities-legacy](https://www.npmjs.com/package/character-entities-legacy/v/3.0.0) | 3.0.0 | 传递 / 非 dev | MIT | license |
| [node_modules/character-reference-invalid](https://www.npmjs.com/package/character-reference-invalid/v/2.0.1) | 2.0.1 | 传递 / 非 dev | MIT | license |
| [node_modules/comma-separated-tokens](https://www.npmjs.com/package/comma-separated-tokens/v/2.0.3) | 2.0.3 | 传递 / 非 dev | MIT | license |
| [node_modules/commander](https://www.npmjs.com/package/commander/v/8.3.0) | 8.3.0 | 传递 / 非 dev | MIT | LICENSE |
| [node_modules/csstype](https://www.npmjs.com/package/csstype/v/3.2.3) | 3.2.3 | 传递 / 非 dev | MIT | LICENSE |
| [node_modules/debug](https://www.npmjs.com/package/debug/v/4.4.3) | 4.4.3 | 传递 / 非 dev | MIT | LICENSE |
| [node_modules/decode-named-character-reference](https://www.npmjs.com/package/decode-named-character-reference/v/1.3.0) | 1.3.0 | 传递 / 非 dev | MIT | license |
| [node_modules/dequal](https://www.npmjs.com/package/dequal/v/2.0.3) | 2.0.3 | 传递 / 非 dev | MIT | license |
| [node_modules/detect-libc](https://www.npmjs.com/package/detect-libc/v/2.1.2) | 2.1.2 | 传递 / 开发 | Apache-2.0 | LICENSE |
| [node_modules/devlop](https://www.npmjs.com/package/devlop/v/1.1.0) | 1.1.0 | 传递 / 非 dev | MIT | license |
| [node_modules/dexie](https://www.npmjs.com/package/dexie/v/4.4.6) | 4.4.6 | 直接 / 非 dev | Apache-2.0 | LICENSE, NOTICE |
| [node_modules/enhanced-resolve](https://www.npmjs.com/package/enhanced-resolve/v/5.25.1) | 5.25.1 | 传递 / 开发 | MIT | LICENSE |
| [node_modules/entities](https://www.npmjs.com/package/entities/v/7.0.1) | 7.0.1 | 传递 / 开发 | BSD-2-Clause | LICENSE |
| [node_modules/es-module-lexer](https://www.npmjs.com/package/es-module-lexer/v/2.3.2) | 2.3.2 | 传递 / 开发 | MIT | LICENSE |
| [node_modules/escape-string-regexp](https://www.npmjs.com/package/escape-string-regexp/v/5.0.0) | 5.0.0 | 传递 / 非 dev | MIT | license |
| [node_modules/estree-util-is-identifier-name](https://www.npmjs.com/package/estree-util-is-identifier-name/v/3.0.0) | 3.0.0 | 传递 / 非 dev | MIT | license |
| [node_modules/estree-walker](https://www.npmjs.com/package/estree-walker/v/3.0.3) | 3.0.3 | 传递 / 开发 | MIT | LICENSE |
| [node_modules/expect-type](https://www.npmjs.com/package/expect-type/v/1.4.0) | 1.4.0 | 传递 / 开发 | Apache-2.0 | LICENSE |
| [node_modules/extend](https://www.npmjs.com/package/extend/v/3.0.2) | 3.0.2 | 传递 / 非 dev | MIT | LICENSE |
| [node_modules/fake-indexeddb](https://www.npmjs.com/package/fake-indexeddb/v/6.2.5) | 6.2.5 | 直接 / 开发 | Apache-2.0 | LICENSE |
| [node_modules/fdir](https://www.npmjs.com/package/fdir/v/6.5.0) | 6.5.0 | 传递 / 开发 | MIT | LICENSE |
| [node_modules/fsevents](https://www.npmjs.com/package/fsevents/v/2.3.3) | 2.3.3 | 传递 / 开发 / 可选 | MIT | 未安装；仅锁文件声明 |
| [node_modules/graceful-fs](https://www.npmjs.com/package/graceful-fs/v/4.2.11) | 4.2.11 | 传递 / 开发 | ISC | LICENSE |
| [node_modules/happy-dom](https://www.npmjs.com/package/happy-dom/v/20.14.5) | 20.14.5 | 直接 / 开发 | MIT | LICENSE |
| [node_modules/hast-util-from-dom](https://www.npmjs.com/package/hast-util-from-dom/v/5.0.1) | 5.0.1 | 传递 / 非 dev | ISC | license |
| [node_modules/hast-util-from-html](https://www.npmjs.com/package/hast-util-from-html/v/2.0.3) | 2.0.3 | 传递 / 非 dev | MIT | license |
| [node_modules/hast-util-from-html-isomorphic](https://www.npmjs.com/package/hast-util-from-html-isomorphic/v/2.0.0) | 2.0.0 | 传递 / 非 dev | MIT | license |
| [node_modules/hast-util-from-parse5](https://www.npmjs.com/package/hast-util-from-parse5/v/8.0.3) | 8.0.3 | 传递 / 非 dev | MIT | license |
| [node_modules/hast-util-is-element](https://www.npmjs.com/package/hast-util-is-element/v/3.0.0) | 3.0.0 | 传递 / 非 dev | MIT | license |
| [node_modules/hast-util-parse-selector](https://www.npmjs.com/package/hast-util-parse-selector/v/4.0.0) | 4.0.0 | 传递 / 非 dev | MIT | license |
| [node_modules/hast-util-to-jsx-runtime](https://www.npmjs.com/package/hast-util-to-jsx-runtime/v/2.3.6) | 2.3.6 | 传递 / 非 dev | MIT | license |
| [node_modules/hast-util-to-text](https://www.npmjs.com/package/hast-util-to-text/v/4.0.2) | 4.0.2 | 传递 / 非 dev | MIT | license |
| [node_modules/hast-util-whitespace](https://www.npmjs.com/package/hast-util-whitespace/v/3.0.0) | 3.0.0 | 传递 / 非 dev | MIT | license |
| [node_modules/hastscript](https://www.npmjs.com/package/hastscript/v/9.0.1) | 9.0.1 | 传递 / 非 dev | MIT | license |
| [node_modules/highlight.js](https://www.npmjs.com/package/highlight.js/v/11.12.0) | 11.12.0 | 直接 / 非 dev | BSD-3-Clause | LICENSE |
| [node_modules/html-url-attributes](https://www.npmjs.com/package/html-url-attributes/v/3.0.1) | 3.0.1 | 传递 / 非 dev | MIT | license |
| [node_modules/inline-style-parser](https://www.npmjs.com/package/inline-style-parser/v/0.2.7) | 0.2.7 | 传递 / 非 dev | MIT | LICENSE |
| [node_modules/is-alphabetical](https://www.npmjs.com/package/is-alphabetical/v/2.0.1) | 2.0.1 | 传递 / 非 dev | MIT | license |
| [node_modules/is-alphanumerical](https://www.npmjs.com/package/is-alphanumerical/v/2.0.1) | 2.0.1 | 传递 / 非 dev | MIT | license |
| [node_modules/is-decimal](https://www.npmjs.com/package/is-decimal/v/2.0.1) | 2.0.1 | 传递 / 非 dev | MIT | license |
| [node_modules/is-hexadecimal](https://www.npmjs.com/package/is-hexadecimal/v/2.0.1) | 2.0.1 | 传递 / 非 dev | MIT | license |
| [node_modules/is-plain-obj](https://www.npmjs.com/package/is-plain-obj/v/4.1.0) | 4.1.0 | 传递 / 非 dev | MIT | license |
| [node_modules/jiti](https://www.npmjs.com/package/jiti/v/2.7.0) | 2.7.0 | 传递 / 开发 | MIT | LICENSE |
| [node_modules/js-tiktoken](https://www.npmjs.com/package/js-tiktoken/v/1.0.21) | 1.0.21 | 直接 / 非 dev | MIT | 无顶层许可文件；需查上游/嵌套目录 |
| [node_modules/katex](https://www.npmjs.com/package/katex/v/0.16.47) | 0.16.47 | 直接 / 非 dev | MIT | LICENSE |
| [node_modules/lightningcss](https://www.npmjs.com/package/lightningcss/v/1.33.0) | 1.33.0 | 传递 / 开发 | MPL-2.0 | LICENSE |
| [node_modules/lightningcss-android-arm64](https://www.npmjs.com/package/lightningcss-android-arm64/v/1.33.0) | 1.33.0 | 传递 / 开发 / 可选 | MPL-2.0 | 未安装；仅锁文件声明 |
| [node_modules/lightningcss-darwin-arm64](https://www.npmjs.com/package/lightningcss-darwin-arm64/v/1.33.0) | 1.33.0 | 传递 / 开发 / 可选 | MPL-2.0 | 未安装；仅锁文件声明 |
| [node_modules/lightningcss-darwin-x64](https://www.npmjs.com/package/lightningcss-darwin-x64/v/1.33.0) | 1.33.0 | 传递 / 开发 / 可选 | MPL-2.0 | 未安装；仅锁文件声明 |
| [node_modules/lightningcss-freebsd-x64](https://www.npmjs.com/package/lightningcss-freebsd-x64/v/1.33.0) | 1.33.0 | 传递 / 开发 / 可选 | MPL-2.0 | 未安装；仅锁文件声明 |
| [node_modules/lightningcss-linux-arm-gnueabihf](https://www.npmjs.com/package/lightningcss-linux-arm-gnueabihf/v/1.33.0) | 1.33.0 | 传递 / 开发 / 可选 | MPL-2.0 | 未安装；仅锁文件声明 |
| [node_modules/lightningcss-linux-arm64-gnu](https://www.npmjs.com/package/lightningcss-linux-arm64-gnu/v/1.33.0) | 1.33.0 | 传递 / 开发 / 可选 | MPL-2.0 | 未安装；仅锁文件声明 |
| [node_modules/lightningcss-linux-arm64-musl](https://www.npmjs.com/package/lightningcss-linux-arm64-musl/v/1.33.0) | 1.33.0 | 传递 / 开发 / 可选 | MPL-2.0 | 未安装；仅锁文件声明 |
| [node_modules/lightningcss-linux-x64-gnu](https://www.npmjs.com/package/lightningcss-linux-x64-gnu/v/1.33.0) | 1.33.0 | 传递 / 开发 / 可选 | MPL-2.0 | 未安装；仅锁文件声明 |
| [node_modules/lightningcss-linux-x64-musl](https://www.npmjs.com/package/lightningcss-linux-x64-musl/v/1.33.0) | 1.33.0 | 传递 / 开发 / 可选 | MPL-2.0 | 未安装；仅锁文件声明 |
| [node_modules/lightningcss-win32-arm64-msvc](https://www.npmjs.com/package/lightningcss-win32-arm64-msvc/v/1.33.0) | 1.33.0 | 传递 / 开发 / 可选 | MPL-2.0 | 未安装；仅锁文件声明 |
| [node_modules/lightningcss-win32-x64-msvc](https://www.npmjs.com/package/lightningcss-win32-x64-msvc/v/1.33.0) | 1.33.0 | 传递 / 开发 / 可选 | MPL-2.0 | LICENSE |
| [node_modules/longest-streak](https://www.npmjs.com/package/longest-streak/v/3.1.0) | 3.1.0 | 传递 / 非 dev | MIT | license |
| [node_modules/lowlight](https://www.npmjs.com/package/lowlight/v/3.3.0) | 3.3.0 | 直接 / 非 dev | MIT | license |
| [node_modules/lowlight/node_modules/highlight.js](https://www.npmjs.com/package/highlight.js/v/11.11.2) | 11.11.2 | 传递 / 非 dev | BSD-3-Clause | LICENSE |
| [node_modules/lucide-react](https://www.npmjs.com/package/lucide-react/v/1.45.0) | 1.45.0 | 直接 / 非 dev | ISC | LICENSE |
| [node_modules/magic-string](https://www.npmjs.com/package/magic-string/v/0.30.21) | 0.30.21 | 传递 / 开发 | MIT | LICENSE |
| [node_modules/markdown-table](https://www.npmjs.com/package/markdown-table/v/3.0.4) | 3.0.4 | 传递 / 非 dev | MIT | license |
| [node_modules/mdast-util-find-and-replace](https://www.npmjs.com/package/mdast-util-find-and-replace/v/3.0.2) | 3.0.2 | 传递 / 非 dev | MIT | license |
| [node_modules/mdast-util-from-markdown](https://www.npmjs.com/package/mdast-util-from-markdown/v/2.0.3) | 2.0.3 | 传递 / 非 dev | MIT | license |
| [node_modules/mdast-util-gfm](https://www.npmjs.com/package/mdast-util-gfm/v/3.1.0) | 3.1.0 | 传递 / 非 dev | MIT | license |
| [node_modules/mdast-util-gfm-autolink-literal](https://www.npmjs.com/package/mdast-util-gfm-autolink-literal/v/2.0.1) | 2.0.1 | 传递 / 非 dev | MIT | license |
| [node_modules/mdast-util-gfm-footnote](https://www.npmjs.com/package/mdast-util-gfm-footnote/v/2.1.0) | 2.1.0 | 传递 / 非 dev | MIT | license |
| [node_modules/mdast-util-gfm-strikethrough](https://www.npmjs.com/package/mdast-util-gfm-strikethrough/v/2.0.0) | 2.0.0 | 传递 / 非 dev | MIT | license |
| [node_modules/mdast-util-gfm-table](https://www.npmjs.com/package/mdast-util-gfm-table/v/2.0.0) | 2.0.0 | 传递 / 非 dev | MIT | license |
| [node_modules/mdast-util-gfm-task-list-item](https://www.npmjs.com/package/mdast-util-gfm-task-list-item/v/2.0.0) | 2.0.0 | 传递 / 非 dev | MIT | license |
| [node_modules/mdast-util-math](https://www.npmjs.com/package/mdast-util-math/v/3.0.0) | 3.0.0 | 传递 / 非 dev | MIT | license |
| [node_modules/mdast-util-mdx-expression](https://www.npmjs.com/package/mdast-util-mdx-expression/v/2.0.1) | 2.0.1 | 传递 / 非 dev | MIT | license |
| [node_modules/mdast-util-mdx-jsx](https://www.npmjs.com/package/mdast-util-mdx-jsx/v/3.2.0) | 3.2.0 | 传递 / 非 dev | MIT | license |
| [node_modules/mdast-util-mdxjs-esm](https://www.npmjs.com/package/mdast-util-mdxjs-esm/v/2.0.1) | 2.0.1 | 传递 / 非 dev | MIT | license |
| [node_modules/mdast-util-phrasing](https://www.npmjs.com/package/mdast-util-phrasing/v/4.1.0) | 4.1.0 | 传递 / 非 dev | MIT | license |
| [node_modules/mdast-util-to-hast](https://www.npmjs.com/package/mdast-util-to-hast/v/13.2.1) | 13.2.1 | 传递 / 非 dev | MIT | license |
| [node_modules/mdast-util-to-markdown](https://www.npmjs.com/package/mdast-util-to-markdown/v/2.1.2) | 2.1.2 | 传递 / 非 dev | MIT | license |
| [node_modules/mdast-util-to-string](https://www.npmjs.com/package/mdast-util-to-string/v/4.0.0) | 4.0.0 | 传递 / 非 dev | MIT | license |
| [node_modules/micromark](https://www.npmjs.com/package/micromark/v/4.0.2) | 4.0.2 | 传递 / 非 dev | MIT | license |
| [node_modules/micromark-core-commonmark](https://www.npmjs.com/package/micromark-core-commonmark/v/2.0.3) | 2.0.3 | 传递 / 非 dev | MIT | license |
| [node_modules/micromark-extension-gfm](https://www.npmjs.com/package/micromark-extension-gfm/v/3.0.0) | 3.0.0 | 传递 / 非 dev | MIT | license |
| [node_modules/micromark-extension-gfm-autolink-literal](https://www.npmjs.com/package/micromark-extension-gfm-autolink-literal/v/2.1.0) | 2.1.0 | 传递 / 非 dev | MIT | license |
| [node_modules/micromark-extension-gfm-footnote](https://www.npmjs.com/package/micromark-extension-gfm-footnote/v/2.1.0) | 2.1.0 | 传递 / 非 dev | MIT | license |
| [node_modules/micromark-extension-gfm-strikethrough](https://www.npmjs.com/package/micromark-extension-gfm-strikethrough/v/2.1.0) | 2.1.0 | 传递 / 非 dev | MIT | license |
| [node_modules/micromark-extension-gfm-table](https://www.npmjs.com/package/micromark-extension-gfm-table/v/2.1.2) | 2.1.2 | 传递 / 非 dev | MIT | license |
| [node_modules/micromark-extension-gfm-tagfilter](https://www.npmjs.com/package/micromark-extension-gfm-tagfilter/v/2.0.0) | 2.0.0 | 传递 / 非 dev | MIT | license |
| [node_modules/micromark-extension-gfm-task-list-item](https://www.npmjs.com/package/micromark-extension-gfm-task-list-item/v/2.1.0) | 2.1.0 | 传递 / 非 dev | MIT | license |
| [node_modules/micromark-extension-math](https://www.npmjs.com/package/micromark-extension-math/v/3.1.0) | 3.1.0 | 直接 / 非 dev | MIT | license |
| [node_modules/micromark-factory-destination](https://www.npmjs.com/package/micromark-factory-destination/v/2.0.1) | 2.0.1 | 传递 / 非 dev | MIT | license |
| [node_modules/micromark-factory-label](https://www.npmjs.com/package/micromark-factory-label/v/2.0.1) | 2.0.1 | 传递 / 非 dev | MIT | license |
| [node_modules/micromark-factory-space](https://www.npmjs.com/package/micromark-factory-space/v/2.0.1) | 2.0.1 | 传递 / 非 dev | MIT | license |
| [node_modules/micromark-factory-title](https://www.npmjs.com/package/micromark-factory-title/v/2.0.1) | 2.0.1 | 传递 / 非 dev | MIT | license |
| [node_modules/micromark-factory-whitespace](https://www.npmjs.com/package/micromark-factory-whitespace/v/2.0.1) | 2.0.1 | 传递 / 非 dev | MIT | license |
| [node_modules/micromark-util-character](https://www.npmjs.com/package/micromark-util-character/v/2.1.1) | 2.1.1 | 传递 / 非 dev | MIT | license |
| [node_modules/micromark-util-chunked](https://www.npmjs.com/package/micromark-util-chunked/v/2.0.1) | 2.0.1 | 传递 / 非 dev | MIT | license |
| [node_modules/micromark-util-classify-character](https://www.npmjs.com/package/micromark-util-classify-character/v/2.0.1) | 2.0.1 | 传递 / 非 dev | MIT | license |
| [node_modules/micromark-util-combine-extensions](https://www.npmjs.com/package/micromark-util-combine-extensions/v/2.0.1) | 2.0.1 | 传递 / 非 dev | MIT | license |
| [node_modules/micromark-util-decode-numeric-character-reference](https://www.npmjs.com/package/micromark-util-decode-numeric-character-reference/v/2.0.2) | 2.0.2 | 传递 / 非 dev | MIT | license |
| [node_modules/micromark-util-decode-string](https://www.npmjs.com/package/micromark-util-decode-string/v/2.0.1) | 2.0.1 | 直接 / 非 dev | MIT | license |
| [node_modules/micromark-util-encode](https://www.npmjs.com/package/micromark-util-encode/v/2.0.1) | 2.0.1 | 传递 / 非 dev | MIT | license |
| [node_modules/micromark-util-html-tag-name](https://www.npmjs.com/package/micromark-util-html-tag-name/v/2.0.1) | 2.0.1 | 传递 / 非 dev | MIT | license |
| [node_modules/micromark-util-normalize-identifier](https://www.npmjs.com/package/micromark-util-normalize-identifier/v/2.0.1) | 2.0.1 | 传递 / 非 dev | MIT | license |
| [node_modules/micromark-util-resolve-all](https://www.npmjs.com/package/micromark-util-resolve-all/v/2.0.1) | 2.0.1 | 传递 / 非 dev | MIT | license |
| [node_modules/micromark-util-sanitize-uri](https://www.npmjs.com/package/micromark-util-sanitize-uri/v/2.0.1) | 2.0.1 | 传递 / 非 dev | MIT | license |
| [node_modules/micromark-util-subtokenize](https://www.npmjs.com/package/micromark-util-subtokenize/v/2.1.0) | 2.1.0 | 传递 / 非 dev | MIT | license |
| [node_modules/micromark-util-symbol](https://www.npmjs.com/package/micromark-util-symbol/v/2.0.1) | 2.0.1 | 传递 / 非 dev | MIT | license |
| [node_modules/micromark-util-types](https://www.npmjs.com/package/micromark-util-types/v/2.0.2) | 2.0.2 | 直接 / 非 dev | MIT | license |
| [node_modules/ms](https://www.npmjs.com/package/ms/v/2.1.3) | 2.1.3 | 传递 / 非 dev | MIT | license.md |
| [node_modules/nanoid](https://www.npmjs.com/package/nanoid/v/3.3.19) | 3.3.19 | 传递 / 开发 | MIT | LICENSE |
| [node_modules/obug](https://www.npmjs.com/package/obug/v/2.2.1) | 2.2.1 | 传递 / 开发 | MIT | LICENSE |
| [node_modules/openai](https://www.npmjs.com/package/openai/v/7.15.0) | 7.15.0 | 直接 / 非 dev | Apache-2.0 | LICENSE |
| [node_modules/parse-entities](https://www.npmjs.com/package/parse-entities/v/4.0.2) | 4.0.2 | 传递 / 非 dev | MIT | license |
| [node_modules/parse-entities/node_modules/@types/unist](https://www.npmjs.com/package/%40types%2Funist/v/2.0.11) | 2.0.11 | 传递 / 非 dev | MIT | LICENSE |
| [node_modules/parse5](https://www.npmjs.com/package/parse5/v/7.3.0) | 7.3.0 | 传递 / 非 dev | MIT | LICENSE |
| [node_modules/parse5/node_modules/entities](https://www.npmjs.com/package/entities/v/6.0.1) | 6.0.1 | 传递 / 非 dev | BSD-2-Clause | LICENSE |
| [node_modules/pdfjs-dist](https://www.npmjs.com/package/pdfjs-dist/v/6.3.289) | 6.3.289 | 直接 / 非 dev | Apache-2.0 | LICENSE |
| [node_modules/picocolors](https://www.npmjs.com/package/picocolors/v/1.1.1) | 1.1.1 | 传递 / 开发 | ISC | LICENSE |
| [node_modules/picomatch](https://www.npmjs.com/package/picomatch/v/4.0.7) | 4.0.7 | 传递 / 开发 | MIT | LICENSE |
| [node_modules/postcss](https://www.npmjs.com/package/postcss/v/8.5.28) | 8.5.28 | 传递 / 开发 | MIT | LICENSE |
| [node_modules/property-information](https://www.npmjs.com/package/property-information/v/7.2.0) | 7.2.0 | 传递 / 非 dev | MIT | license |
| [node_modules/react](https://www.npmjs.com/package/react/v/19.3.0) | 19.3.0 | 直接 / 非 dev | MIT | LICENSE |
| [node_modules/react-dom](https://www.npmjs.com/package/react-dom/v/19.3.0) | 19.3.0 | 直接 / 非 dev | MIT | LICENSE |
| [node_modules/react-markdown](https://www.npmjs.com/package/react-markdown/v/10.1.0) | 10.1.0 | 直接 / 非 dev | MIT | license |
| [node_modules/rehype-katex](https://www.npmjs.com/package/rehype-katex/v/7.0.1) | 7.0.1 | 直接 / 非 dev | MIT | 无顶层许可文件；需查上游/嵌套目录 |
| [node_modules/remark-gfm](https://www.npmjs.com/package/remark-gfm/v/4.0.1) | 4.0.1 | 直接 / 非 dev | MIT | license |
| [node_modules/remark-math](https://www.npmjs.com/package/remark-math/v/6.0.0) | 6.0.0 | 直接 / 非 dev | MIT | 无顶层许可文件；需查上游/嵌套目录 |
| [node_modules/remark-parse](https://www.npmjs.com/package/remark-parse/v/11.0.0) | 11.0.0 | 直接 / 非 dev | MIT | license |
| [node_modules/remark-rehype](https://www.npmjs.com/package/remark-rehype/v/11.1.2) | 11.1.2 | 传递 / 非 dev | MIT | license |
| [node_modules/remark-stringify](https://www.npmjs.com/package/remark-stringify/v/11.0.0) | 11.0.0 | 传递 / 非 dev | MIT | license |
| [node_modules/rolldown](https://www.npmjs.com/package/rolldown/v/1.2.8) | 1.2.8 | 传递 / 开发 | MIT | LICENSE |
| [node_modules/scheduler](https://www.npmjs.com/package/scheduler/v/0.28.0) | 0.28.0 | 传递 / 非 dev | MIT | LICENSE |
| [node_modules/siginfo](https://www.npmjs.com/package/siginfo/v/2.0.0) | 2.0.0 | 传递 / 开发 | ISC | LICENSE |
| [node_modules/source-map-js](https://www.npmjs.com/package/source-map-js/v/1.2.1) | 1.2.1 | 传递 / 开发 | BSD-3-Clause | LICENSE |
| [node_modules/space-separated-tokens](https://www.npmjs.com/package/space-separated-tokens/v/2.0.2) | 2.0.2 | 传递 / 非 dev | MIT | license |
| [node_modules/stackback](https://www.npmjs.com/package/stackback/v/0.0.2) | 0.0.2 | 传递 / 开发 | MIT | 无顶层许可文件；需查上游/嵌套目录 |
| [node_modules/std-env](https://www.npmjs.com/package/std-env/v/4.2.0) | 4.2.0 | 传递 / 开发 | MIT | LICENCE |
| [node_modules/stringify-entities](https://www.npmjs.com/package/stringify-entities/v/4.0.4) | 4.0.4 | 传递 / 非 dev | MIT | license |
| [node_modules/style-to-js](https://www.npmjs.com/package/style-to-js/v/1.1.21) | 1.1.21 | 传递 / 非 dev | MIT | LICENSE |
| [node_modules/style-to-object](https://www.npmjs.com/package/style-to-object/v/1.0.14) | 1.0.14 | 传递 / 非 dev | MIT | LICENSE |
| [node_modules/tailwindcss](https://www.npmjs.com/package/tailwindcss/v/4.3.3) | 4.3.3 | 直接 / 开发 | MIT | LICENSE |
| [node_modules/tapable](https://www.npmjs.com/package/tapable/v/2.3.3) | 2.3.3 | 传递 / 开发 | MIT | LICENSE |
| [node_modules/tinybench](https://www.npmjs.com/package/tinybench/v/6.1.4) | 6.1.4 | 传递 / 开发 | MIT | LICENSE |
| [node_modules/tinyexec](https://www.npmjs.com/package/tinyexec/v/1.3.0) | 1.3.0 | 传递 / 开发 | MIT | LICENSE |
| [node_modules/tinyglobby](https://www.npmjs.com/package/tinyglobby/v/0.2.17) | 0.2.17 | 传递 / 开发 | MIT | LICENSE |
| [node_modules/trim-lines](https://www.npmjs.com/package/trim-lines/v/3.0.1) | 3.0.1 | 传递 / 非 dev | MIT | license |
| [node_modules/trough](https://www.npmjs.com/package/trough/v/2.2.0) | 2.2.0 | 传递 / 非 dev | MIT | license |
| [node_modules/typescript](https://www.npmjs.com/package/typescript/v/6.0.3) | 6.0.3 | 直接 / 开发 | Apache-2.0 | LICENSE.txt |
| [node_modules/undici-types](https://www.npmjs.com/package/undici-types/v/8.9.0) | 8.9.0 | 传递 / 开发 | MIT | LICENSE |
| [node_modules/unified](https://www.npmjs.com/package/unified/v/11.0.5) | 11.0.5 | 直接 / 非 dev | MIT | license |
| [node_modules/unist-util-find-after](https://www.npmjs.com/package/unist-util-find-after/v/5.0.0) | 5.0.0 | 传递 / 非 dev | MIT | license |
| [node_modules/unist-util-is](https://www.npmjs.com/package/unist-util-is/v/6.0.1) | 6.0.1 | 传递 / 非 dev | MIT | license |
| [node_modules/unist-util-position](https://www.npmjs.com/package/unist-util-position/v/5.0.0) | 5.0.0 | 传递 / 非 dev | MIT | license |
| [node_modules/unist-util-remove-position](https://www.npmjs.com/package/unist-util-remove-position/v/5.0.0) | 5.0.0 | 传递 / 非 dev | MIT | license |
| [node_modules/unist-util-stringify-position](https://www.npmjs.com/package/unist-util-stringify-position/v/4.0.0) | 4.0.0 | 传递 / 非 dev | MIT | license |
| [node_modules/unist-util-visit](https://www.npmjs.com/package/unist-util-visit/v/5.1.0) | 5.1.0 | 传递 / 非 dev | MIT | license |
| [node_modules/unist-util-visit-parents](https://www.npmjs.com/package/unist-util-visit-parents/v/6.0.2) | 6.0.2 | 传递 / 非 dev | MIT | license |
| [node_modules/vfile](https://www.npmjs.com/package/vfile/v/6.0.3) | 6.0.3 | 传递 / 非 dev | MIT | license |
| [node_modules/vfile-location](https://www.npmjs.com/package/vfile-location/v/5.0.3) | 5.0.3 | 传递 / 非 dev | MIT | license |
| [node_modules/vfile-message](https://www.npmjs.com/package/vfile-message/v/4.0.3) | 4.0.3 | 传递 / 非 dev | MIT | license |
| [node_modules/vite](https://www.npmjs.com/package/vite/v/8.3.0) | 8.3.0 | 直接 / 开发 | MIT | LICENSE.md |
| [node_modules/vitest](https://www.npmjs.com/package/vitest/v/5.0.0) | 5.0.0 | 直接 / 开发 | MIT | LICENSE.md |
| [node_modules/vitest/node_modules/magic-string](https://www.npmjs.com/package/magic-string/v/1.3.1) | 1.3.1 | 传递 / 开发 | MIT | LICENSE |
| [node_modules/web-namespaces](https://www.npmjs.com/package/web-namespaces/v/2.0.1) | 2.0.1 | 传递 / 非 dev | MIT | license |
| [node_modules/whatwg-mimetype](https://www.npmjs.com/package/whatwg-mimetype/v/3.0.0) | 3.0.0 | 传递 / 开发 | MIT | LICENSE.txt |
| [node_modules/why-is-node-running](https://www.npmjs.com/package/why-is-node-running/v/2.3.0) | 2.3.0 | 传递 / 开发 | MIT | LICENSE |
| [node_modules/ws](https://www.npmjs.com/package/ws/v/8.21.3) | 8.21.3 | 传递 / 非 dev | MIT | LICENSE |
| [node_modules/zwitch](https://www.npmjs.com/package/zwitch/v/2.0.4) | 2.0.4 | 传递 / 非 dev | MIT | license |

## Rust

| 包 | 版本 | 原始声明 | 本机顶层证据 |
| --- | --- | --- | --- |
| [adler2](https://crates.io/crates/adler2/2.0.1) | 2.0.1 | 0BSD OR MIT OR Apache-2.0 | LICENSE-0BSD, LICENSE-APACHE, LICENSE-MIT |
| [aho-corasick](https://crates.io/crates/aho-corasick/1.1.5) | 1.1.5 | Unlicense OR MIT | COPYING, LICENSE-MIT |
| [alloc-no-stdlib](https://crates.io/crates/alloc-no-stdlib/2.0.4) | 2.0.4 | BSD-3-Clause | LICENSE |
| [alloc-stdlib](https://crates.io/crates/alloc-stdlib/0.2.4) | 0.2.4 | BSD-3-Clause | 无顶层许可文件；需查上游/嵌套目录 |
| [android_system_properties](https://crates.io/crates/android_system_properties/0.1.6) | 0.1.6 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [anyhow](https://crates.io/crates/anyhow/1.0.104) | 1.0.104 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [arbitrary](https://crates.io/crates/arbitrary/1.4.2) | 1.4.2 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [async-broadcast](https://crates.io/crates/async-broadcast/0.7.2) | 0.7.2 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [async-channel](https://crates.io/crates/async-channel/2.5.0) | 2.5.0 | Apache-2.0 OR MIT | LICENSE-APACHE, LICENSE-MIT |
| [async-executor](https://crates.io/crates/async-executor/1.14.0) | 1.14.0 | Apache-2.0 OR MIT | LICENSE-APACHE, LICENSE-MIT |
| [async-io](https://crates.io/crates/async-io/2.6.0) | 2.6.0 | Apache-2.0 OR MIT | LICENSE-APACHE, LICENSE-MIT |
| [async-lock](https://crates.io/crates/async-lock/3.4.2) | 3.4.2 | Apache-2.0 OR MIT | LICENSE-APACHE, LICENSE-MIT |
| [async-process](https://crates.io/crates/async-process/2.5.0) | 2.5.0 | Apache-2.0 OR MIT | LICENSE-APACHE, LICENSE-MIT |
| [async-recursion](https://crates.io/crates/async-recursion/1.1.1) | 1.1.1 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [async-signal](https://crates.io/crates/async-signal/0.2.14) | 0.2.14 | Apache-2.0 OR MIT | LICENSE-APACHE, LICENSE-MIT |
| [async-task](https://crates.io/crates/async-task/4.7.1) | 4.7.1 | Apache-2.0 OR MIT | LICENSE-APACHE, LICENSE-MIT |
| [async-trait](https://crates.io/crates/async-trait/0.1.92) | 0.1.92 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [atk-sys](https://crates.io/crates/atk-sys/0.18.2) | 0.18.2 | MIT | LICENSE |
| [atk](https://crates.io/crates/atk/0.18.2) | 0.18.2 | MIT | COPYRIGHT, LICENSE |
| [atomic-waker](https://crates.io/crates/atomic-waker/1.1.2) | 1.1.2 | Apache-2.0 OR MIT | LICENSE-APACHE, LICENSE-MIT, LICENSE-THIRD-PARTY |
| [autocfg](https://crates.io/crates/autocfg/1.5.1) | 1.5.1 | Apache-2.0 OR MIT | LICENSE-APACHE, LICENSE-MIT |
| [base64](https://crates.io/crates/base64/0.21.7) | 0.21.7 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [base64](https://crates.io/crates/base64/0.22.1) | 0.22.1 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [base64](https://crates.io/crates/base64/0.23.1) | 0.23.1 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [bit-set](https://crates.io/crates/bit-set/0.8.0) | 0.8.0 | Apache-2.0 OR MIT | LICENSE-APACHE, LICENSE-MIT |
| [bit-vec](https://crates.io/crates/bit-vec/0.8.0) | 0.8.0 | Apache-2.0 OR MIT | LICENSE-APACHE, LICENSE-MIT |
| [bitflags](https://crates.io/crates/bitflags/1.3.2) | 1.3.2 | MIT/Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [bitflags](https://crates.io/crates/bitflags/2.13.2) | 2.13.2 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [block-buffer](https://crates.io/crates/block-buffer/0.10.4) | 0.10.4 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [block2](https://crates.io/crates/block2/0.6.2) | 0.6.2 | MIT | 无顶层许可文件；需查上游/嵌套目录 |
| [blocking](https://crates.io/crates/blocking/1.7.0) | 1.7.0 | Apache-2.0 OR MIT | LICENSE-APACHE, LICENSE-MIT |
| [brotli-decompressor](https://crates.io/crates/brotli-decompressor/5.0.3) | 5.0.3 | BSD-3-Clause/MIT | LICENSE |
| [brotli](https://crates.io/crates/brotli/8.0.4) | 8.0.4 | BSD-3-Clause AND MIT | LICENSE.BSD-3-Clause, LICENSE.MIT |
| [bs58](https://crates.io/crates/bs58/0.5.1) | 0.5.1 | MIT/Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [bumpalo](https://crates.io/crates/bumpalo/3.20.3) | 3.20.3 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [bytemuck](https://crates.io/crates/bytemuck/1.25.2) | 1.25.2 | Zlib OR Apache-2.0 OR MIT | LICENSE-APACHE, LICENSE-MIT, LICENSE-ZLIB |
| [byteorder-lite](https://crates.io/crates/byteorder-lite/0.1.0) | 0.1.0 | Unlicense OR MIT | LICENSE-MIT |
| [byteorder](https://crates.io/crates/byteorder/1.5.0) | 1.5.0 | Unlicense OR MIT | COPYING, LICENSE-MIT |
| [bytes](https://crates.io/crates/bytes/1.12.1) | 1.12.1 | MIT | LICENSE |
| [cairo-rs](https://crates.io/crates/cairo-rs/0.18.5) | 0.18.5 | MIT | COPYRIGHT, LICENSE |
| [cairo-sys-rs](https://crates.io/crates/cairo-sys-rs/0.18.2) | 0.18.2 | MIT | LICENSE |
| [camino](https://crates.io/crates/camino/1.2.5) | 1.2.5 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [cargo-platform](https://crates.io/crates/cargo-platform/0.1.9) | 0.1.9 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [cargo_metadata](https://crates.io/crates/cargo_metadata/0.19.2) | 0.19.2 | MIT | LICENSE-MIT |
| [cargo_toml](https://crates.io/crates/cargo_toml/0.22.3) | 0.22.3 | Apache-2.0 OR MIT | LICENSE |
| [cc](https://crates.io/crates/cc/1.4.6) | 1.4.6 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [cesu8](https://crates.io/crates/cesu8/1.1.0) | 1.1.0 | Apache-2.0/MIT | COPYRIGHT-RUST.txt |
| [cfb](https://crates.io/crates/cfb/0.7.3) | 0.7.3 | MIT | LICENSE |
| [cfg-expr](https://crates.io/crates/cfg-expr/0.15.8) | 0.15.8 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [cfg-if](https://crates.io/crates/cfg-if/1.0.4) | 1.0.4 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [cfg_aliases](https://crates.io/crates/cfg_aliases/0.2.2) | 0.2.2 | MIT | LICENSE |
| [chacha20](https://crates.io/crates/chacha20/0.10.2) | 0.10.2 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [chrono](https://crates.io/crates/chrono/0.4.45) | 0.4.45 | MIT OR Apache-2.0 | LICENSE.txt |
| [combine](https://crates.io/crates/combine/4.6.8) | 4.6.8 | MIT | LICENSE |
| [concurrent-queue](https://crates.io/crates/concurrent-queue/2.5.0) | 2.5.0 | Apache-2.0 OR MIT | LICENSE-APACHE, LICENSE-MIT |
| [cookie](https://crates.io/crates/cookie/0.18.2) | 0.18.2 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [cookie_store](https://crates.io/crates/cookie_store/0.22.1) | 0.22.1 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [core-foundation-sys](https://crates.io/crates/core-foundation-sys/0.8.7) | 0.8.7 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [core-foundation](https://crates.io/crates/core-foundation/0.10.1) | 0.10.1 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [core-foundation](https://crates.io/crates/core-foundation/0.9.4) | 0.9.4 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [core-graphics-types](https://crates.io/crates/core-graphics-types/0.2.0) | 0.2.0 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [core-graphics](https://crates.io/crates/core-graphics/0.25.0) | 0.25.0 | MIT OR Apache-2.0 | COPYRIGHT, LICENSE-APACHE, LICENSE-MIT |
| [core_detect](https://crates.io/crates/core_detect/1.0.0) | 1.0.0 | MIT/Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [cpufeatures](https://crates.io/crates/cpufeatures/0.2.17) | 0.2.17 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [cpufeatures](https://crates.io/crates/cpufeatures/0.3.1) | 0.3.1 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [crc32c](https://crates.io/crates/crc32c/0.6.8) | 0.6.8 | Apache-2.0/MIT | 无顶层许可文件；需查上游/嵌套目录 |
| [crc32fast](https://crates.io/crates/crc32fast/1.5.2) | 1.5.2 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [crossbeam-channel](https://crates.io/crates/crossbeam-channel/0.5.17) | 0.5.17 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT, LICENSE-THIRD-PARTY |
| [crossbeam-utils](https://crates.io/crates/crossbeam-utils/0.8.23) | 0.8.23 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [crypto-common](https://crates.io/crates/crypto-common/0.1.7) | 0.1.7 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [cssparser-macros](https://crates.io/crates/cssparser-macros/0.6.1) | 0.6.1 | MPL-2.0 | LICENSE |
| [cssparser](https://crates.io/crates/cssparser/0.36.0) | 0.36.0 | MPL-2.0 | LICENSE |
| [ctor-proc-macro](https://crates.io/crates/ctor-proc-macro/0.0.7) | 0.0.7 | Apache-2.0 OR MIT | LICENSE-APACHE, LICENSE-MIT |
| [ctor](https://crates.io/crates/ctor/0.8.0) | 0.8.0 | Apache-2.0 OR MIT | LICENSE-APACHE, LICENSE-MIT |
| [darling](https://crates.io/crates/darling/0.24.1) | 0.24.1 | MIT | LICENSE |
| [darling_core](https://crates.io/crates/darling_core/0.24.1) | 0.24.1 | MIT | LICENSE |
| [darling_macro](https://crates.io/crates/darling_macro/0.24.1) | 0.24.1 | MIT | LICENSE |
| [data-url](https://crates.io/crates/data-url/0.3.2) | 0.3.2 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [dbus](https://crates.io/crates/dbus/0.9.12) | 0.9.12 | Apache-2.0/MIT | LICENSE-APACHE, LICENSE-MIT |
| [defmt-macros](https://crates.io/crates/defmt-macros/1.1.1) | 1.1.1 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [defmt-parser](https://crates.io/crates/defmt-parser/1.0.0) | 1.0.0 | MIT OR Apache-2.0 | 无顶层许可文件；需查上游/嵌套目录 |
| [defmt](https://crates.io/crates/defmt/1.1.1) | 1.1.1 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [deranged](https://crates.io/crates/deranged/0.5.8) | 0.5.8 | MIT OR Apache-2.0 | LICENSE-Apache, LICENSE-MIT |
| [derive_arbitrary](https://crates.io/crates/derive_arbitrary/1.4.2) | 1.4.2 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [derive_more-impl](https://crates.io/crates/derive_more-impl/2.1.1) | 2.1.1 | MIT | LICENSE |
| [derive_more](https://crates.io/crates/derive_more/2.1.1) | 2.1.1 | MIT | LICENSE |
| [digest](https://crates.io/crates/digest/0.10.7) | 0.10.7 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [dirs-sys](https://crates.io/crates/dirs-sys/0.5.0) | 0.5.0 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [dirs](https://crates.io/crates/dirs/6.0.0) | 6.0.0 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [dispatch2](https://crates.io/crates/dispatch2/0.3.1) | 0.3.1 | Zlib OR Apache-2.0 OR MIT | 无顶层许可文件；需查上游/嵌套目录 |
| [displaydoc](https://crates.io/crates/displaydoc/0.2.7) | 0.2.7 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [dlopen2](https://crates.io/crates/dlopen2/0.8.2) | 0.8.2 | MIT | 无顶层许可文件；需查上游/嵌套目录 |
| [dlopen2_derive](https://crates.io/crates/dlopen2_derive/0.4.3) | 0.4.3 | MIT | 无顶层许可文件；需查上游/嵌套目录 |
| [document-features](https://crates.io/crates/document-features/0.2.12) | 0.2.12 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [dom_query](https://crates.io/crates/dom_query/0.27.0) | 0.27.0 | MIT | LICENSE |
| [dpi](https://crates.io/crates/dpi/0.1.2) | 0.1.2 | Apache-2.0 AND MIT | LICENSE, LICENSE-LIBM-MIT |
| [dtoa-short](https://crates.io/crates/dtoa-short/0.3.5) | 0.3.5 | MPL-2.0 | LICENSE |
| [dtoa](https://crates.io/crates/dtoa/1.0.11) | 1.0.11 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [dtor-proc-macro](https://crates.io/crates/dtor-proc-macro/0.0.6) | 0.0.6 | Apache-2.0 OR MIT | LICENSE-APACHE, LICENSE-MIT |
| [dtor](https://crates.io/crates/dtor/0.3.0) | 0.3.0 | Apache-2.0 OR MIT | LICENSE-APACHE, LICENSE-MIT |
| [dunce](https://crates.io/crates/dunce/1.0.5) | 1.0.5 | CC0-1.0 OR MIT-0 OR Apache-2.0 | LICENSE |
| [dyn-clone](https://crates.io/crates/dyn-clone/1.0.20) | 1.0.20 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [embed-resource](https://crates.io/crates/embed-resource/3.0.11) | 3.0.11 | MIT | LICENSE |
| [embed_plist](https://crates.io/crates/embed_plist/1.2.2) | 1.2.2 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [encoding_rs](https://crates.io/crates/encoding_rs/0.8.41) | 0.8.41 | (Apache-2.0 OR MIT) AND BSD-3-Clause | COPYRIGHT, LICENSE-APACHE, LICENSE-MIT, LICENSE-WHATWG |
| [endi](https://crates.io/crates/endi/1.1.1) | 1.1.1 | MIT | LICENSE-MIT |
| [enumflags2](https://crates.io/crates/enumflags2/0.7.12) | 0.7.12 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [enumflags2_derive](https://crates.io/crates/enumflags2_derive/0.7.12) | 0.7.12 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [equivalent](https://crates.io/crates/equivalent/1.0.2) | 1.0.2 | Apache-2.0 OR MIT | LICENSE-APACHE, LICENSE-MIT |
| [erased-serde](https://crates.io/crates/erased-serde/0.4.10) | 0.4.10 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [errno](https://crates.io/crates/errno/0.3.14) | 0.3.14 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [event-listener-strategy](https://crates.io/crates/event-listener-strategy/0.5.4) | 0.5.4 | Apache-2.0 OR MIT | LICENSE-APACHE, LICENSE-MIT |
| [event-listener](https://crates.io/crates/event-listener/5.4.2) | 5.4.2 | Apache-2.0 OR MIT | LICENSE-APACHE, LICENSE-MIT |
| [fallible-iterator](https://crates.io/crates/fallible-iterator/0.3.0) | 0.3.0 | MIT/Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [fallible-streaming-iterator](https://crates.io/crates/fallible-streaming-iterator/0.1.9) | 0.1.9 | MIT/Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [fastrand](https://crates.io/crates/fastrand/2.5.0) | 2.5.0 | Apache-2.0 OR MIT | LICENSE-APACHE, LICENSE-MIT |
| [fdeflate](https://crates.io/crates/fdeflate/0.3.7) | 0.3.7 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [field-offset](https://crates.io/crates/field-offset/0.3.6) | 0.3.6 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [find-msvc-tools](https://crates.io/crates/find-msvc-tools/0.1.12) | 0.1.12 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [flate2](https://crates.io/crates/flate2/1.1.10) | 1.1.10 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [fnv](https://crates.io/crates/fnv/1.0.7) | 1.0.7 | Apache-2.0 / MIT | LICENSE-APACHE, LICENSE-MIT |
| [foldhash](https://crates.io/crates/foldhash/0.1.5) | 0.1.5 | Zlib | LICENSE |
| [foldhash](https://crates.io/crates/foldhash/0.2.0) | 0.2.0 | Zlib | LICENSE |
| [foreign-types-macros](https://crates.io/crates/foreign-types-macros/0.2.4) | 0.2.4 | MIT/Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [foreign-types-shared](https://crates.io/crates/foreign-types-shared/0.3.1) | 0.3.1 | MIT/Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [foreign-types](https://crates.io/crates/foreign-types/0.5.0) | 0.5.0 | MIT/Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [form_urlencoded](https://crates.io/crates/form_urlencoded/1.2.2) | 1.2.2 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [futures-channel](https://crates.io/crates/futures-channel/0.3.34) | 0.3.34 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [futures-core](https://crates.io/crates/futures-core/0.3.34) | 0.3.34 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [futures-executor](https://crates.io/crates/futures-executor/0.3.34) | 0.3.34 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [futures-io](https://crates.io/crates/futures-io/0.3.34) | 0.3.34 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [futures-lite](https://crates.io/crates/futures-lite/2.6.1) | 2.6.1 | Apache-2.0 OR MIT | LICENSE-APACHE, LICENSE-MIT, LICENSE-THIRD-PARTY |
| [futures-macro](https://crates.io/crates/futures-macro/0.3.34) | 0.3.34 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [futures-sink](https://crates.io/crates/futures-sink/0.3.34) | 0.3.34 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [futures-task](https://crates.io/crates/futures-task/0.3.34) | 0.3.34 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [futures-util](https://crates.io/crates/futures-util/0.3.34) | 0.3.34 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [gdk-pixbuf-sys](https://crates.io/crates/gdk-pixbuf-sys/0.18.0) | 0.18.0 | MIT | LICENSE |
| [gdk-pixbuf](https://crates.io/crates/gdk-pixbuf/0.18.5) | 0.18.5 | MIT | COPYRIGHT, LICENSE |
| [gdk-sys](https://crates.io/crates/gdk-sys/0.18.2) | 0.18.2 | MIT | LICENSE |
| [gdk](https://crates.io/crates/gdk/0.18.2) | 0.18.2 | MIT | COPYRIGHT, LICENSE |
| [gdkwayland-sys](https://crates.io/crates/gdkwayland-sys/0.18.2) | 0.18.2 | MIT | LICENSE |
| [gdkx11-sys](https://crates.io/crates/gdkx11-sys/0.18.2) | 0.18.2 | MIT | LICENSE |
| [gdkx11](https://crates.io/crates/gdkx11/0.18.2) | 0.18.2 | MIT | COPYRIGHT, LICENSE |
| [generic-array](https://crates.io/crates/generic-array/0.14.7) | 0.14.7 | MIT | LICENSE |
| [getrandom](https://crates.io/crates/getrandom/0.2.17) | 0.2.17 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [getrandom](https://crates.io/crates/getrandom/0.3.4) | 0.3.4 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [getrandom](https://crates.io/crates/getrandom/0.4.3) | 0.4.3 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [gio-sys](https://crates.io/crates/gio-sys/0.18.1) | 0.18.1 | MIT | LICENSE |
| [gio](https://crates.io/crates/gio/0.18.4) | 0.18.4 | MIT | COPYRIGHT, LICENSE |
| [glib-macros](https://crates.io/crates/glib-macros/0.18.5) | 0.18.5 | MIT | COPYRIGHT, LICENSE |
| [glib-sys](https://crates.io/crates/glib-sys/0.18.1) | 0.18.1 | MIT | LICENSE |
| [glib](https://crates.io/crates/glib/0.18.5) | 0.18.5 | MIT | COPYRIGHT, LICENSE |
| [glob](https://crates.io/crates/glob/0.3.4) | 0.3.4 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [gobject-sys](https://crates.io/crates/gobject-sys/0.18.0) | 0.18.0 | MIT | LICENSE |
| [gtk-sys](https://crates.io/crates/gtk-sys/0.18.2) | 0.18.2 | MIT | LICENSE |
| [gtk3-macros](https://crates.io/crates/gtk3-macros/0.18.2) | 0.18.2 | MIT | COPYRIGHT, LICENSE |
| [gtk](https://crates.io/crates/gtk/0.18.2) | 0.18.2 | MIT | COPYRIGHT, LICENSE |
| [h2](https://crates.io/crates/h2/0.4.19) | 0.4.19 | MIT | LICENSE |
| [hashbrown](https://crates.io/crates/hashbrown/0.12.3) | 0.12.3 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [hashbrown](https://crates.io/crates/hashbrown/0.15.5) | 0.15.5 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [hashbrown](https://crates.io/crates/hashbrown/0.17.1) | 0.17.1 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [hashlink](https://crates.io/crates/hashlink/0.10.0) | 0.10.0 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [heck](https://crates.io/crates/heck/0.4.1) | 0.4.1 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [heck](https://crates.io/crates/heck/0.5.0) | 0.5.0 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [hermit-abi](https://crates.io/crates/hermit-abi/0.5.3) | 0.5.3 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [hex](https://crates.io/crates/hex/0.4.3) | 0.4.3 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [html5ever](https://crates.io/crates/html5ever/0.38.0) | 0.38.0 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [http-body-util](https://crates.io/crates/http-body-util/0.1.5) | 0.1.5 | MIT | LICENSE |
| [http-body](https://crates.io/crates/http-body/1.1.0) | 1.1.0 | MIT | LICENSE |
| [http-range](https://crates.io/crates/http-range/0.1.5) | 0.1.5 | MIT | LICENSE |
| [http](https://crates.io/crates/http/1.5.0) | 1.5.0 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [httparse](https://crates.io/crates/httparse/1.10.1) | 1.10.1 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [hyper-rustls](https://crates.io/crates/hyper-rustls/0.27.9) | 0.27.9 | Apache-2.0 OR ISC OR MIT | LICENSE-APACHE, LICENSE-ISC, LICENSE-MIT |
| [hyper-util](https://crates.io/crates/hyper-util/0.1.20) | 0.1.20 | MIT | LICENSE |
| [hyper](https://crates.io/crates/hyper/1.11.1) | 1.11.1 | MIT | LICENSE |
| [iana-time-zone-haiku](https://crates.io/crates/iana-time-zone-haiku/0.1.2) | 0.1.2 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [iana-time-zone](https://crates.io/crates/iana-time-zone/0.1.65) | 0.1.65 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [ico](https://crates.io/crates/ico/0.5.0) | 0.5.0 | MIT | LICENSE |
| [icu_collections](https://crates.io/crates/icu_collections/2.3.0) | 2.3.0 | Unicode-3.0 | LICENSE |
| [icu_locale_core](https://crates.io/crates/icu_locale_core/2.3.0) | 2.3.0 | Unicode-3.0 | LICENSE |
| [icu_normalizer](https://crates.io/crates/icu_normalizer/2.3.0) | 2.3.0 | Unicode-3.0 | LICENSE |
| [icu_normalizer_data](https://crates.io/crates/icu_normalizer_data/2.3.0) | 2.3.0 | Unicode-3.0 | LICENSE |
| [icu_properties](https://crates.io/crates/icu_properties/2.3.0) | 2.3.0 | Unicode-3.0 | LICENSE |
| [icu_properties_data](https://crates.io/crates/icu_properties_data/2.3.0) | 2.3.0 | Unicode-3.0 | LICENSE |
| [icu_provider](https://crates.io/crates/icu_provider/2.3.1) | 2.3.1 | Unicode-3.0 | LICENSE |
| [ident_case](https://crates.io/crates/ident_case/1.0.1) | 1.0.1 | MIT/Apache-2.0 | LICENSE |
| [idna](https://crates.io/crates/idna/1.1.0) | 1.1.0 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [idna_adapter](https://crates.io/crates/idna_adapter/1.2.2) | 1.2.2 | Apache-2.0 OR MIT | LICENSE-APACHE, LICENSE-MIT |
| [image-webp](https://crates.io/crates/image-webp/0.2.4) | 0.2.4 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [image](https://crates.io/crates/image/0.25.10) | 0.25.10 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [indexmap](https://crates.io/crates/indexmap/1.9.3) | 1.9.3 | Apache-2.0 OR MIT | LICENSE-APACHE, LICENSE-MIT |
| [indexmap](https://crates.io/crates/indexmap/2.14.2) | 2.14.2 | Apache-2.0 OR MIT | LICENSE-APACHE, LICENSE-MIT |
| [infer](https://crates.io/crates/infer/0.19.0) | 0.19.0 | MIT | LICENSE |
| [integer-encoding](https://crates.io/crates/integer-encoding/4.1.0) | 4.1.0 | MIT | LICENSE |
| [ipnet](https://crates.io/crates/ipnet/2.12.2) | 2.12.2 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [is-docker](https://crates.io/crates/is-docker/0.2.0) | 0.2.0 | MIT | LICENSE |
| [is-wsl](https://crates.io/crates/is-wsl/0.4.0) | 0.4.0 | MIT | LICENSE |
| [itoa](https://crates.io/crates/itoa/1.0.18) | 1.0.18 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [javascriptcore-rs-sys](https://crates.io/crates/javascriptcore-rs-sys/1.1.1) | 1.1.1 | MIT | LICENSE |
| [javascriptcore-rs](https://crates.io/crates/javascriptcore-rs/1.1.2) | 1.1.2 | MIT | LICENSE |
| [jiff-core](https://crates.io/crates/jiff-core/0.1.1) | 0.1.1 | Unlicense OR MIT | COPYING, LICENSE-MIT |
| [jiff-static](https://crates.io/crates/jiff-static/0.2.37) | 0.2.37 | Unlicense OR MIT | COPYING, LICENSE-MIT |
| [jiff-tzdb-platform](https://crates.io/crates/jiff-tzdb-platform/0.1.3) | 0.1.3 | Unlicense OR MIT | COPYING, LICENSE-MIT |
| [jiff-tzdb](https://crates.io/crates/jiff-tzdb/0.1.8) | 0.1.8 | Unlicense OR MIT | COPYING, LICENSE-MIT |
| [jiff](https://crates.io/crates/jiff/0.2.37) | 0.2.37 | Unlicense OR MIT | COPYING, LICENSE-MIT |
| [jni-sys-macros](https://crates.io/crates/jni-sys-macros/0.4.1) | 0.4.1 | MIT OR Apache-2.0 | 无顶层许可文件；需查上游/嵌套目录 |
| [jni-sys](https://crates.io/crates/jni-sys/0.3.1) | 0.3.1 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [jni-sys](https://crates.io/crates/jni-sys/0.4.1) | 0.4.1 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [jni](https://crates.io/crates/jni/0.21.1) | 0.21.1 | MIT/Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [js-sys](https://crates.io/crates/js-sys/0.3.105) | 0.3.105 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [json-patch](https://crates.io/crates/json-patch/3.0.1) | 3.0.1 | MIT/Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [jsonptr](https://crates.io/crates/jsonptr/0.6.3) | 0.6.3 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [keyboard-types](https://crates.io/crates/keyboard-types/0.7.0) | 0.7.0 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [leveldb-core](https://crates.io/crates/leveldb-core/0.1.2) | 0.1.2 | Apache-2.0 | LICENSE |
| [libappindicator-sys](https://crates.io/crates/libappindicator-sys/0.9.0) | 0.9.0 | Apache-2.0 OR MIT | 无顶层许可文件；需查上游/嵌套目录 |
| [libappindicator](https://crates.io/crates/libappindicator/0.9.0) | 0.9.0 | Apache-2.0 OR MIT | LICENSE-APACHE, LICENSE-MIT |
| [libc](https://crates.io/crates/libc/0.2.189) | 0.2.189 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [libdbus-sys](https://crates.io/crates/libdbus-sys/0.2.7) | 0.2.7 | Apache-2.0/MIT | LICENSE-APACHE, LICENSE-MIT |
| [libloading](https://crates.io/crates/libloading/0.7.4) | 0.7.4 | ISC | LICENSE |
| [libredox](https://crates.io/crates/libredox/0.1.24) | 0.1.24 | MIT | LICENSE |
| [libsqlite3-sys](https://crates.io/crates/libsqlite3-sys/0.35.0) | 0.35.0 | MIT | LICENSE |
| [linux-raw-sys](https://crates.io/crates/linux-raw-sys/0.12.1) | 0.12.1 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | COPYRIGHT, LICENSE-APACHE, LICENSE-Apache-2.0_WITH_LLVM-exception, LICENSE-MIT |
| [litemap](https://crates.io/crates/litemap/0.8.3) | 0.8.3 | Unicode-3.0 | LICENSE |
| [litrs](https://crates.io/crates/litrs/1.0.0) | 1.0.0 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [lock_api](https://crates.io/crates/lock_api/0.4.14) | 0.4.14 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [log](https://crates.io/crates/log/0.4.34) | 0.4.34 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [lru-slab](https://crates.io/crates/lru-slab/0.1.3) | 0.1.3 | MIT OR Apache-2.0 OR Zlib | LICENSE-APACHE, LICENSE-MIT, LICENSE-ZLIB |
| [markup5ever](https://crates.io/crates/markup5ever/0.38.0) | 0.38.0 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [memchr](https://crates.io/crates/memchr/2.8.3) | 2.8.3 | Unlicense OR MIT | COPYING, LICENSE-MIT |
| [memoffset](https://crates.io/crates/memoffset/0.9.1) | 0.9.1 | MIT | LICENSE |
| [mime](https://crates.io/crates/mime/0.3.17) | 0.3.17 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [miniz_oxide](https://crates.io/crates/miniz_oxide/0.8.9) | 0.8.9 | MIT OR Zlib OR Apache-2.0 | LICENSE, LICENSE-APACHE.md, LICENSE-MIT.md, LICENSE-ZLIB.md |
| [miniz_oxide](https://crates.io/crates/miniz_oxide/0.9.1) | 0.9.1 | MIT OR Zlib OR Apache-2.0 | LICENSE, LICENSE-APACHE.md, LICENSE-MIT.md, LICENSE-ZLIB.md |
| [mio](https://crates.io/crates/mio/1.2.3) | 1.2.3 | MIT | LICENSE |
| [moxcms](https://crates.io/crates/moxcms/0.8.1) | 0.8.1 | BSD-3-Clause OR Apache-2.0 | LICENSE-APACHE.md, LICENSE.md |
| [muda](https://crates.io/crates/muda/0.19.3) | 0.19.3 | Apache-2.0 OR MIT | LICENSE-APACHE, LICENSE-MIT, LICENSE.spdx |
| [multiversion-macros](https://crates.io/crates/multiversion-macros/0.9.0) | 0.9.0 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [multiversion](https://crates.io/crates/multiversion/0.9.0) | 0.9.0 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [multiversion_no_op](https://crates.io/crates/multiversion_no_op/1.0.0) | 1.0.0 | Apache-2.0 OR MIT | COPYRIGHT, LICENSE-APACHE, LICENSE-MIT |
| [ndk-sys](https://crates.io/crates/ndk-sys/0.6.0+11769913) | 0.6.0+11769913 | MIT OR Apache-2.0 | 无顶层许可文件；需查上游/嵌套目录 |
| [ndk](https://crates.io/crates/ndk/0.9.0) | 0.9.0 | MIT OR Apache-2.0 | 无顶层许可文件；需查上游/嵌套目录 |
| [new_debug_unreachable](https://crates.io/crates/new_debug_unreachable/1.0.6) | 1.0.6 | MIT | LICENSE-MIT |
| [num-conv](https://crates.io/crates/num-conv/0.2.2) | 0.2.2 | MIT OR Apache-2.0 | LICENSE-Apache, LICENSE-MIT |
| [num-traits](https://crates.io/crates/num-traits/0.2.19) | 0.2.19 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [num_enum](https://crates.io/crates/num_enum/0.7.6) | 0.7.6 | BSD-3-Clause OR MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-BSD, LICENSE-MIT |
| [num_enum_derive](https://crates.io/crates/num_enum_derive/0.7.6) | 0.7.6 | BSD-3-Clause OR MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-BSD, LICENSE-MIT |
| [objc2-app-kit](https://crates.io/crates/objc2-app-kit/0.3.2) | 0.3.2 | Zlib OR Apache-2.0 OR MIT | 无顶层许可文件；需查上游/嵌套目录 |
| [objc2-cloud-kit](https://crates.io/crates/objc2-cloud-kit/0.3.2) | 0.3.2 | Zlib OR Apache-2.0 OR MIT | 无顶层许可文件；需查上游/嵌套目录 |
| [objc2-core-data](https://crates.io/crates/objc2-core-data/0.3.2) | 0.3.2 | Zlib OR Apache-2.0 OR MIT | 无顶层许可文件；需查上游/嵌套目录 |
| [objc2-core-foundation](https://crates.io/crates/objc2-core-foundation/0.3.2) | 0.3.2 | Zlib OR Apache-2.0 OR MIT | 无顶层许可文件；需查上游/嵌套目录 |
| [objc2-core-graphics](https://crates.io/crates/objc2-core-graphics/0.3.2) | 0.3.2 | Zlib OR Apache-2.0 OR MIT | 无顶层许可文件；需查上游/嵌套目录 |
| [objc2-core-image](https://crates.io/crates/objc2-core-image/0.3.2) | 0.3.2 | Zlib OR Apache-2.0 OR MIT | 无顶层许可文件；需查上游/嵌套目录 |
| [objc2-core-location](https://crates.io/crates/objc2-core-location/0.3.2) | 0.3.2 | Zlib OR Apache-2.0 OR MIT | 无顶层许可文件；需查上游/嵌套目录 |
| [objc2-core-text](https://crates.io/crates/objc2-core-text/0.3.2) | 0.3.2 | Zlib OR Apache-2.0 OR MIT | 无顶层许可文件；需查上游/嵌套目录 |
| [objc2-encode](https://crates.io/crates/objc2-encode/4.1.0) | 4.1.0 | MIT | 无顶层许可文件；需查上游/嵌套目录 |
| [objc2-exception-helper](https://crates.io/crates/objc2-exception-helper/0.1.1) | 0.1.1 | Zlib OR Apache-2.0 OR MIT | 无顶层许可文件；需查上游/嵌套目录 |
| [objc2-foundation](https://crates.io/crates/objc2-foundation/0.3.2) | 0.3.2 | MIT | 无顶层许可文件；需查上游/嵌套目录 |
| [objc2-io-surface](https://crates.io/crates/objc2-io-surface/0.3.2) | 0.3.2 | Zlib OR Apache-2.0 OR MIT | 无顶层许可文件；需查上游/嵌套目录 |
| [objc2-quartz-core](https://crates.io/crates/objc2-quartz-core/0.3.2) | 0.3.2 | Zlib OR Apache-2.0 OR MIT | 无顶层许可文件；需查上游/嵌套目录 |
| [objc2-ui-kit](https://crates.io/crates/objc2-ui-kit/0.3.2) | 0.3.2 | Zlib OR Apache-2.0 OR MIT | 无顶层许可文件；需查上游/嵌套目录 |
| [objc2-user-notifications](https://crates.io/crates/objc2-user-notifications/0.3.2) | 0.3.2 | Zlib OR Apache-2.0 OR MIT | 无顶层许可文件；需查上游/嵌套目录 |
| [objc2-web-kit](https://crates.io/crates/objc2-web-kit/0.3.2) | 0.3.2 | Zlib OR Apache-2.0 OR MIT | 无顶层许可文件；需查上游/嵌套目录 |
| [objc2](https://crates.io/crates/objc2/0.6.4) | 0.6.4 | MIT | 无顶层许可文件；需查上游/嵌套目录 |
| [once_cell](https://crates.io/crates/once_cell/1.21.4) | 1.21.4 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [open](https://crates.io/crates/open/5.4.4) | 5.4.4 | MIT | LICENSE.md |
| [option-ext](https://crates.io/crates/option-ext/0.2.0) | 0.2.0 | MPL-2.0 | LICENSE.txt |
| [ordered-stream](https://crates.io/crates/ordered-stream/0.2.0) | 0.2.0 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [pango-sys](https://crates.io/crates/pango-sys/0.18.0) | 0.18.0 | MIT | LICENSE |
| [pango](https://crates.io/crates/pango/0.18.3) | 0.18.3 | MIT | COPYRIGHT, LICENSE |
| [parking](https://crates.io/crates/parking/2.2.1) | 2.2.1 | Apache-2.0 OR MIT | LICENSE-APACHE, LICENSE-MIT, LICENSE-THIRD-PARTY |
| [parking_lot](https://crates.io/crates/parking_lot/0.12.5) | 0.12.5 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [parking_lot_core](https://crates.io/crates/parking_lot_core/0.9.12) | 0.9.12 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [percent-encoding](https://crates.io/crates/percent-encoding/2.3.2) | 2.3.2 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [phf](https://crates.io/crates/phf/0.13.1) | 0.13.1 | MIT | LICENSE |
| [phf_codegen](https://crates.io/crates/phf_codegen/0.13.1) | 0.13.1 | MIT | LICENSE |
| [phf_generator](https://crates.io/crates/phf_generator/0.13.1) | 0.13.1 | MIT | LICENSE |
| [phf_macros](https://crates.io/crates/phf_macros/0.13.1) | 0.13.1 | MIT | LICENSE |
| [phf_shared](https://crates.io/crates/phf_shared/0.13.1) | 0.13.1 | MIT | LICENSE |
| [pin-project-lite](https://crates.io/crates/pin-project-lite/0.2.17) | 0.2.17 | Apache-2.0 OR MIT | LICENSE-APACHE, LICENSE-MIT |
| [piper](https://crates.io/crates/piper/0.2.5) | 0.2.5 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [pkg-config](https://crates.io/crates/pkg-config/0.3.34) | 0.3.34 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [plist](https://crates.io/crates/plist/1.10.1) | 1.10.1 | MIT | LICENCE |
| [png](https://crates.io/crates/png/0.17.16) | 0.17.16 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [png](https://crates.io/crates/png/0.18.1) | 0.18.1 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [polling](https://crates.io/crates/polling/3.11.0) | 3.11.0 | Apache-2.0 OR MIT | LICENSE-APACHE, LICENSE-MIT |
| [portable-atomic-util](https://crates.io/crates/portable-atomic-util/0.2.8) | 0.2.8 | Apache-2.0 OR MIT | LICENSE-APACHE, LICENSE-MIT |
| [portable-atomic](https://crates.io/crates/portable-atomic/1.15.0) | 1.15.0 | Apache-2.0 OR MIT | LICENSE-APACHE, LICENSE-MIT |
| [potential_utf](https://crates.io/crates/potential_utf/0.1.6) | 0.1.6 | Unicode-3.0 | LICENSE |
| [powerfmt](https://crates.io/crates/powerfmt/0.2.0) | 0.2.0 | MIT OR Apache-2.0 | LICENSE-Apache, LICENSE-MIT |
| [precomputed-hash](https://crates.io/crates/precomputed-hash/0.1.1) | 0.1.1 | MIT | LICENSE |
| [proc-macro-crate](https://crates.io/crates/proc-macro-crate/1.3.1) | 1.3.1 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [proc-macro-crate](https://crates.io/crates/proc-macro-crate/2.0.2) | 2.0.2 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [proc-macro-crate](https://crates.io/crates/proc-macro-crate/3.5.0) | 3.5.0 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [proc-macro-error-attr](https://crates.io/crates/proc-macro-error-attr/1.0.4) | 1.0.4 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [proc-macro-error](https://crates.io/crates/proc-macro-error/1.0.4) | 1.0.4 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [proc-macro2](https://crates.io/crates/proc-macro2/1.0.107) | 1.0.107 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [psl-types](https://crates.io/crates/psl-types/2.0.11) | 2.0.11 | MIT/Apache-2.0 | LICENSE, LICENSE-APACHE |
| [publicsuffix](https://crates.io/crates/publicsuffix/2.3.0) | 2.3.0 | MIT/Apache-2.0 | LICENSE, LICENSE-APACHE |
| [pxfm](https://crates.io/crates/pxfm/0.1.30) | 0.1.30 | BSD-3-Clause OR Apache-2.0 | LICENSE-APACHE.md, LICENSE.md |
| [quick-error](https://crates.io/crates/quick-error/2.0.1) | 2.0.1 | MIT/Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [quick-xml](https://crates.io/crates/quick-xml/0.42.0) | 0.42.0 | MIT | LICENSE-MIT.md |
| [quinn-proto](https://crates.io/crates/quinn-proto/0.11.17) | 0.11.17 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [quinn-udp](https://crates.io/crates/quinn-udp/0.5.15) | 0.5.15 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [quinn](https://crates.io/crates/quinn/0.11.11) | 0.11.11 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [quote](https://crates.io/crates/quote/1.0.47) | 1.0.47 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [r-efi](https://crates.io/crates/r-efi/5.3.0) | 5.3.0 | MIT OR Apache-2.0 OR LGPL-2.1-or-later | 无顶层许可文件；需查上游/嵌套目录 |
| [r-efi](https://crates.io/crates/r-efi/6.0.0) | 6.0.0 | MIT OR Apache-2.0 OR LGPL-2.1-or-later | 无顶层许可文件；需查上游/嵌套目录 |
| [rand](https://crates.io/crates/rand/0.10.2) | 0.10.2 | MIT OR Apache-2.0 | COPYRIGHT, LICENSE-APACHE, LICENSE-MIT |
| [rand_core](https://crates.io/crates/rand_core/0.10.1) | 0.10.1 | MIT OR Apache-2.0 | COPYRIGHT, LICENSE-APACHE, LICENSE-MIT |
| [rand_pcg](https://crates.io/crates/rand_pcg/0.10.2) | 0.10.2 | MIT OR Apache-2.0 | COPYRIGHT, LICENSE-APACHE, LICENSE-MIT |
| [raw-window-handle](https://crates.io/crates/raw-window-handle/0.6.2) | 0.6.2 | MIT OR Apache-2.0 OR Zlib | LICENSE-APACHE.md, LICENSE-MIT.md, LICENSE-ZLIB.md |
| [redox_syscall](https://crates.io/crates/redox_syscall/0.5.18) | 0.5.18 | MIT | LICENSE |
| [redox_users](https://crates.io/crates/redox_users/0.5.2) | 0.5.2 | MIT | LICENSE |
| [ref-cast-impl](https://crates.io/crates/ref-cast-impl/1.0.27) | 1.0.27 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [ref-cast](https://crates.io/crates/ref-cast/1.0.27) | 1.0.27 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [regex-automata](https://crates.io/crates/regex-automata/0.4.18) | 0.4.18 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [regex-syntax](https://crates.io/crates/regex-syntax/0.8.11) | 0.8.11 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [regex](https://crates.io/crates/regex/1.13.1) | 1.13.1 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [reqwest](https://crates.io/crates/reqwest/0.12.28) | 0.12.28 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [reqwest](https://crates.io/crates/reqwest/0.13.5) | 0.13.5 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [rfd](https://crates.io/crates/rfd/0.16.0) | 0.16.0 | MIT | LICENSE |
| [ring](https://crates.io/crates/ring/0.17.14) | 0.17.14 | Apache-2.0 AND ISC | LICENSE, LICENSE-BoringSSL, LICENSE-other-bits |
| [rusqlite](https://crates.io/crates/rusqlite/0.37.0) | 0.37.0 | MIT | LICENSE |
| [rustc-hash](https://crates.io/crates/rustc-hash/2.1.3) | 2.1.3 | Apache-2.0 OR MIT | LICENSE-APACHE, LICENSE-MIT |
| [rustc_version](https://crates.io/crates/rustc_version/0.4.1) | 0.4.1 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [rustix](https://crates.io/crates/rustix/1.1.4) | 1.1.4 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | COPYRIGHT, LICENSE-APACHE, LICENSE-Apache-2.0_WITH_LLVM-exception, LICENSE-MIT |
| [rustls-pki-types](https://crates.io/crates/rustls-pki-types/1.15.1) | 1.15.1 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [rustls-webpki](https://crates.io/crates/rustls-webpki/0.103.15) | 0.103.15 | ISC | LICENSE |
| [rustls](https://crates.io/crates/rustls/0.23.44) | 0.23.44 | Apache-2.0 OR ISC OR MIT | LICENSE-APACHE, LICENSE-ISC, LICENSE-MIT |
| [rustversion](https://crates.io/crates/rustversion/1.0.23) | 1.0.23 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [ryu](https://crates.io/crates/ryu/1.0.23) | 1.0.23 | Apache-2.0 OR BSL-1.0 | LICENSE-APACHE, LICENSE-BOOST |
| [same-file](https://crates.io/crates/same-file/1.0.6) | 1.0.6 | Unlicense/MIT | COPYING, LICENSE-MIT |
| [schemars](https://crates.io/crates/schemars/0.8.22) | 0.8.22 | MIT | LICENSE |
| [schemars](https://crates.io/crates/schemars/0.9.0) | 0.9.0 | MIT | LICENSE |
| [schemars](https://crates.io/crates/schemars/1.2.2) | 1.2.2 | MIT | LICENSE |
| [schemars_derive](https://crates.io/crates/schemars_derive/0.8.22) | 0.8.22 | MIT | LICENSE |
| [scopeguard](https://crates.io/crates/scopeguard/1.2.0) | 1.2.0 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [selectors](https://crates.io/crates/selectors/0.36.1) | 0.36.1 | MPL-2.0 | 无顶层许可文件；需查上游/嵌套目录 |
| [semver](https://crates.io/crates/semver/1.0.28) | 1.0.28 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [serde-untagged](https://crates.io/crates/serde-untagged/0.1.9) | 0.1.9 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [serde](https://crates.io/crates/serde/1.0.229) | 1.0.229 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [serde_core](https://crates.io/crates/serde_core/1.0.229) | 1.0.229 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [serde_derive](https://crates.io/crates/serde_derive/1.0.229) | 1.0.229 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [serde_derive_internals](https://crates.io/crates/serde_derive_internals/0.29.1) | 0.29.1 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [serde_json](https://crates.io/crates/serde_json/1.0.151) | 1.0.151 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [serde_repr](https://crates.io/crates/serde_repr/0.1.21) | 0.1.21 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [serde_spanned](https://crates.io/crates/serde_spanned/0.6.9) | 0.6.9 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [serde_spanned](https://crates.io/crates/serde_spanned/1.1.1) | 1.1.1 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [serde_urlencoded](https://crates.io/crates/serde_urlencoded/0.7.1) | 0.7.1 | MIT/Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [serde_with](https://crates.io/crates/serde_with/3.23.0) | 3.23.0 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [serde_with_macros](https://crates.io/crates/serde_with_macros/3.23.0) | 3.23.0 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [serialize-to-javascript-impl](https://crates.io/crates/serialize-to-javascript-impl/0.1.2) | 0.1.2 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [serialize-to-javascript](https://crates.io/crates/serialize-to-javascript/0.1.2) | 0.1.2 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [servo_arc](https://crates.io/crates/servo_arc/0.4.3) | 0.4.3 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [sha2](https://crates.io/crates/sha2/0.10.9) | 0.10.9 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [shlex](https://crates.io/crates/shlex/2.0.1) | 2.0.1 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [signal-hook-registry](https://crates.io/crates/signal-hook-registry/1.4.8) | 1.4.8 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [simd-adler32](https://crates.io/crates/simd-adler32/0.3.10) | 0.3.10 | MIT | LICENSE.md |
| [simdutf8](https://crates.io/crates/simdutf8/0.1.5) | 0.1.5 | MIT OR Apache-2.0 | LICENSE-Apache, LICENSE-MIT |
| [siphasher](https://crates.io/crates/siphasher/1.0.3) | 1.0.3 | MIT/Apache-2.0 | COPYING |
| [slab](https://crates.io/crates/slab/0.4.12) | 0.4.12 | MIT | LICENSE |
| [smallvec](https://crates.io/crates/smallvec/1.16.1) | 1.16.1 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [snap](https://crates.io/crates/snap/1.1.2) | 1.1.2 | BSD-3-Clause | COPYING |
| [socket2](https://crates.io/crates/socket2/0.6.5) | 0.6.5 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [softbuffer](https://crates.io/crates/softbuffer/0.4.8) | 0.4.8 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [soup3-sys](https://crates.io/crates/soup3-sys/0.5.0) | 0.5.0 | MIT | LICENSE |
| [soup3](https://crates.io/crates/soup3/0.5.0) | 0.5.0 | MIT | LICENSE |
| [stable_deref_trait](https://crates.io/crates/stable_deref_trait/1.2.1) | 1.2.1 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [string_cache](https://crates.io/crates/string_cache/0.9.0) | 0.9.0 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [string_cache_codegen](https://crates.io/crates/string_cache_codegen/0.6.1) | 0.6.1 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [strsim](https://crates.io/crates/strsim/0.11.1) | 0.11.1 | MIT | LICENSE |
| [subtle](https://crates.io/crates/subtle/2.6.1) | 2.6.1 | BSD-3-Clause | LICENSE |
| [swift-rs](https://crates.io/crates/swift-rs/1.0.8) | 1.0.8 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [syn](https://crates.io/crates/syn/1.0.109) | 1.0.109 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [syn](https://crates.io/crates/syn/2.0.119) | 2.0.119 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [syn](https://crates.io/crates/syn/3.0.5) | 3.0.5 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [sync_wrapper](https://crates.io/crates/sync_wrapper/1.0.2) | 1.0.2 | Apache-2.0 | LICENSE |
| [synstructure](https://crates.io/crates/synstructure/0.13.2) | 0.13.2 | MIT | LICENSE |
| [system-configuration-sys](https://crates.io/crates/system-configuration-sys/0.6.0) | 0.6.0 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [system-configuration](https://crates.io/crates/system-configuration/0.7.0) | 0.7.0 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [system-deps](https://crates.io/crates/system-deps/6.2.2) | 6.2.2 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [tao-macros](https://crates.io/crates/tao-macros/0.1.4) | 0.1.4 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT, LICENSE.spdx |
| [tao](https://crates.io/crates/tao/0.35.3) | 0.35.3 | Apache-2.0 | LICENSE, LICENSE.spdx |
| [target-lexicon](https://crates.io/crates/target-lexicon/0.12.16) | 0.12.16 | Apache-2.0 WITH LLVM-exception | LICENSE |
| [tauri-build](https://crates.io/crates/tauri-build/2.6.3) | 2.6.3 | Apache-2.0 OR MIT | LICENSE_APACHE-2.0, LICENSE_MIT |
| [tauri-codegen](https://crates.io/crates/tauri-codegen/2.6.3) | 2.6.3 | Apache-2.0 OR MIT | LICENSE_APACHE-2.0, LICENSE_MIT |
| [tauri-macros](https://crates.io/crates/tauri-macros/2.6.3) | 2.6.3 | Apache-2.0 OR MIT | LICENSE_APACHE-2.0, LICENSE_MIT |
| [tauri-plugin-dialog](https://crates.io/crates/tauri-plugin-dialog/2.7.3) | 2.7.3 | Apache-2.0 OR MIT | LICENSE.spdx, LICENSE_APACHE-2.0, LICENSE_MIT |
| [tauri-plugin-fs](https://crates.io/crates/tauri-plugin-fs/2.5.2) | 2.5.2 | Apache-2.0 OR MIT | LICENSE.spdx, LICENSE_APACHE-2.0, LICENSE_MIT |
| [tauri-plugin-http](https://crates.io/crates/tauri-plugin-http/2.6.0) | 2.6.0 | Apache-2.0 OR MIT | LICENSE.spdx, LICENSE_APACHE-2.0, LICENSE_MIT |
| [tauri-plugin-opener](https://crates.io/crates/tauri-plugin-opener/2.5.5) | 2.5.5 | Apache-2.0 OR MIT | LICENSE.spdx, LICENSE_APACHE-2.0, LICENSE_MIT |
| [tauri-plugin-single-instance](https://crates.io/crates/tauri-plugin-single-instance/2.4.4) | 2.4.4 | Apache-2.0 OR MIT | LICENSE.spdx, LICENSE_APACHE-2.0, LICENSE_MIT |
| [tauri-plugin-window-state](https://crates.io/crates/tauri-plugin-window-state/2.4.1) | 2.4.1 | Apache-2.0 OR MIT | LICENSE.spdx, LICENSE_APACHE-2.0, LICENSE_MIT |
| [tauri-plugin](https://crates.io/crates/tauri-plugin/2.6.3) | 2.6.3 | Apache-2.0 OR MIT | 无顶层许可文件；需查上游/嵌套目录 |
| [tauri-runtime-wry](https://crates.io/crates/tauri-runtime-wry/2.11.4) | 2.11.4 | Apache-2.0 OR MIT | LICENSE_APACHE-2.0, LICENSE_MIT |
| [tauri-runtime](https://crates.io/crates/tauri-runtime/2.11.3) | 2.11.3 | Apache-2.0 OR MIT | LICENSE_APACHE-2.0, LICENSE_MIT |
| [tauri-utils](https://crates.io/crates/tauri-utils/2.9.3) | 2.9.3 | Apache-2.0 OR MIT | LICENSE_APACHE-2.0, LICENSE_MIT |
| [tauri-winres](https://crates.io/crates/tauri-winres/0.3.6) | 0.3.6 | MIT | LICENSE |
| [tauri](https://crates.io/crates/tauri/2.11.5) | 2.11.5 | Apache-2.0 OR MIT | LICENSE_APACHE-2.0, LICENSE_MIT |
| [tempfile](https://crates.io/crates/tempfile/3.27.0) | 3.27.0 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [tendril](https://crates.io/crates/tendril/0.5.1) | 0.5.1 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [thiserror-impl](https://crates.io/crates/thiserror-impl/1.0.69) | 1.0.69 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [thiserror-impl](https://crates.io/crates/thiserror-impl/2.0.20) | 2.0.20 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [thiserror](https://crates.io/crates/thiserror/1.0.69) | 1.0.69 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [thiserror](https://crates.io/crates/thiserror/2.0.20) | 2.0.20 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [time-core](https://crates.io/crates/time-core/0.1.9) | 0.1.9 | MIT OR Apache-2.0 | LICENSE-Apache, LICENSE-MIT |
| [time-macros](https://crates.io/crates/time-macros/0.2.32) | 0.2.32 | MIT OR Apache-2.0 | LICENSE-Apache, LICENSE-MIT |
| [time](https://crates.io/crates/time/0.3.55) | 0.3.55 | MIT OR Apache-2.0 | LICENSE-Apache, LICENSE-MIT |
| [tinystr](https://crates.io/crates/tinystr/0.8.4) | 0.8.4 | Unicode-3.0 | LICENSE |
| [tinyvec](https://crates.io/crates/tinyvec/1.13.3) | 1.13.3 | Zlib OR Apache-2.0 OR MIT | LICENSE-APACHE.md, LICENSE-MIT.md, LICENSE-ZLIB.md |
| [tokio-macros](https://crates.io/crates/tokio-macros/2.7.2) | 2.7.2 | MIT | LICENSE |
| [tokio-rustls](https://crates.io/crates/tokio-rustls/0.26.5) | 0.26.5 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [tokio-util](https://crates.io/crates/tokio-util/0.7.19) | 0.7.19 | MIT | LICENSE |
| [tokio](https://crates.io/crates/tokio/1.53.1) | 1.53.1 | MIT | LICENSE |
| [toml](https://crates.io/crates/toml/0.8.2) | 0.8.2 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [toml](https://crates.io/crates/toml/0.9.12+spec-1.1.0) | 0.9.12+spec-1.1.0 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [toml](https://crates.io/crates/toml/1.1.6+spec-1.1.0) | 1.1.6+spec-1.1.0 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [toml_datetime](https://crates.io/crates/toml_datetime/0.6.3) | 0.6.3 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [toml_datetime](https://crates.io/crates/toml_datetime/0.7.5+spec-1.1.0) | 0.7.5+spec-1.1.0 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [toml_datetime](https://crates.io/crates/toml_datetime/1.1.1+spec-1.1.0) | 1.1.1+spec-1.1.0 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [toml_edit](https://crates.io/crates/toml_edit/0.19.15) | 0.19.15 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [toml_edit](https://crates.io/crates/toml_edit/0.20.2) | 0.20.2 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [toml_edit](https://crates.io/crates/toml_edit/0.25.15+spec-1.1.0) | 0.25.15+spec-1.1.0 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [toml_parser](https://crates.io/crates/toml_parser/1.1.3+spec-1.1.0) | 1.1.3+spec-1.1.0 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [toml_writer](https://crates.io/crates/toml_writer/1.1.2+spec-1.1.0) | 1.1.2+spec-1.1.0 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [tower-http](https://crates.io/crates/tower-http/0.6.11) | 0.6.11 | MIT | LICENSE |
| [tower-layer](https://crates.io/crates/tower-layer/0.3.3) | 0.3.3 | MIT | LICENSE |
| [tower-service](https://crates.io/crates/tower-service/0.3.3) | 0.3.3 | MIT | LICENSE |
| [tower](https://crates.io/crates/tower/0.5.3) | 0.5.3 | MIT | LICENSE |
| [tracing-attributes](https://crates.io/crates/tracing-attributes/0.1.31) | 0.1.31 | MIT | LICENSE |
| [tracing-core](https://crates.io/crates/tracing-core/0.1.36) | 0.1.36 | MIT | LICENSE |
| [tracing](https://crates.io/crates/tracing/0.1.44) | 0.1.44 | MIT | LICENSE |
| [tray-icon](https://crates.io/crates/tray-icon/0.24.2) | 0.24.2 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT, LICENSE.spdx |
| [try-lock](https://crates.io/crates/try-lock/0.2.5) | 0.2.5 | MIT | LICENSE |
| [typeid](https://crates.io/crates/typeid/1.0.3) | 1.0.3 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [typenum](https://crates.io/crates/typenum/1.20.1) | 1.20.1 | MIT OR Apache-2.0 | LICENSE, LICENSE-APACHE, LICENSE-MIT |
| [uds_windows](https://crates.io/crates/uds_windows/1.2.1) | 1.2.1 | MIT | LICENSE |
| [unic-char-property](https://crates.io/crates/unic-char-property/0.9.0) | 0.9.0 | MIT/Apache-2.0 | 无顶层许可文件；需查上游/嵌套目录 |
| [unic-char-range](https://crates.io/crates/unic-char-range/0.9.0) | 0.9.0 | MIT/Apache-2.0 | 无顶层许可文件；需查上游/嵌套目录 |
| [unic-common](https://crates.io/crates/unic-common/0.9.0) | 0.9.0 | MIT/Apache-2.0 | 无顶层许可文件；需查上游/嵌套目录 |
| [unic-ucd-ident](https://crates.io/crates/unic-ucd-ident/0.9.0) | 0.9.0 | MIT/Apache-2.0 | 无顶层许可文件；需查上游/嵌套目录 |
| [unic-ucd-version](https://crates.io/crates/unic-ucd-version/0.9.0) | 0.9.0 | MIT/Apache-2.0 | 无顶层许可文件；需查上游/嵌套目录 |
| [unicode-ident](https://crates.io/crates/unicode-ident/1.0.24) | 1.0.24 | (MIT OR Apache-2.0) AND Unicode-3.0 | LICENSE-APACHE, LICENSE-MIT, LICENSE-UNICODE |
| [unicode-segmentation](https://crates.io/crates/unicode-segmentation/1.13.3) | 1.13.3 | MIT OR Apache-2.0 | COPYRIGHT, LICENSE-APACHE, LICENSE-MIT |
| [untrusted](https://crates.io/crates/untrusted/0.9.0) | 0.9.0 | ISC | LICENSE.txt |
| [url](https://crates.io/crates/url/2.5.8) | 2.5.8 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [urlpattern](https://crates.io/crates/urlpattern/0.3.0) | 0.3.0 | MIT | LICENSE |
| [utf8_iter](https://crates.io/crates/utf8_iter/1.0.4) | 1.0.4 | Apache-2.0 OR MIT | COPYRIGHT, LICENSE-APACHE, LICENSE-MIT |
| [uuid](https://crates.io/crates/uuid/1.26.1) | 1.26.1 | Apache-2.0 OR MIT | LICENSE-APACHE, LICENSE-MIT |
| [vcpkg](https://crates.io/crates/vcpkg/0.2.15) | 0.2.15 | MIT/Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [version-compare](https://crates.io/crates/version-compare/0.2.1) | 0.2.1 | MIT | LICENSE |
| [version_check](https://crates.io/crates/version_check/0.9.5) | 0.9.5 | MIT/Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [vswhom-sys](https://crates.io/crates/vswhom-sys/0.1.3) | 0.1.3 | MIT | LICENSE |
| [vswhom](https://crates.io/crates/vswhom/0.1.0) | 0.1.0 | MIT | LICENSE |
| [walkdir](https://crates.io/crates/walkdir/2.5.0) | 2.5.0 | Unlicense/MIT | COPYING, LICENSE-MIT |
| [want](https://crates.io/crates/want/0.3.1) | 0.3.1 | MIT | LICENSE |
| [wasi](https://crates.io/crates/wasi/0.11.1+wasi-snapshot-preview1) | 0.11.1+wasi-snapshot-preview1 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | LICENSE-APACHE, LICENSE-Apache-2.0_WITH_LLVM-exception, LICENSE-MIT |
| [wasip2](https://crates.io/crates/wasip2/1.0.4+wasi-0.2.12) | 1.0.4+wasi-0.2.12 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | LICENSE-APACHE, LICENSE-Apache-2.0_WITH_LLVM-exception, LICENSE-MIT |
| [wasm-bindgen-futures](https://crates.io/crates/wasm-bindgen-futures/0.4.78) | 0.4.78 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [wasm-bindgen-macro-support](https://crates.io/crates/wasm-bindgen-macro-support/0.2.128) | 0.2.128 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [wasm-bindgen-macro](https://crates.io/crates/wasm-bindgen-macro/0.2.128) | 0.2.128 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [wasm-bindgen-shared](https://crates.io/crates/wasm-bindgen-shared/0.2.128) | 0.2.128 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [wasm-bindgen](https://crates.io/crates/wasm-bindgen/0.2.128) | 0.2.128 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [wasm-streams](https://crates.io/crates/wasm-streams/0.5.0) | 0.5.0 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [web-sys](https://crates.io/crates/web-sys/0.3.105) | 0.3.105 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [web-time](https://crates.io/crates/web-time/1.1.0) | 1.1.0 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [web_atoms](https://crates.io/crates/web_atoms/0.2.6) | 0.2.6 | MIT OR Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [webkit2gtk-sys](https://crates.io/crates/webkit2gtk-sys/2.0.2) | 2.0.2 | MIT | LICENSE |
| [webkit2gtk](https://crates.io/crates/webkit2gtk/2.0.2) | 2.0.2 | MIT | LICENSE |
| [webpki-roots](https://crates.io/crates/webpki-roots/1.0.9) | 1.0.9 | CDLA-Permissive-2.0 | LICENSE |
| [webview2-com-macros](https://crates.io/crates/webview2-com-macros/0.8.1) | 0.8.1 | MIT | 无顶层许可文件；需查上游/嵌套目录 |
| [webview2-com-sys](https://crates.io/crates/webview2-com-sys/0.38.2) | 0.38.2 | MIT | 无顶层许可文件；需查上游/嵌套目录 |
| [webview2-com](https://crates.io/crates/webview2-com/0.38.2) | 0.38.2 | MIT | 无顶层许可文件；需查上游/嵌套目录 |
| [winapi-i686-pc-windows-gnu](https://crates.io/crates/winapi-i686-pc-windows-gnu/0.4.0) | 0.4.0 | MIT/Apache-2.0 | 无顶层许可文件；需查上游/嵌套目录 |
| [winapi-util](https://crates.io/crates/winapi-util/0.1.11) | 0.1.11 | Unlicense OR MIT | COPYING, LICENSE-MIT |
| [winapi-x86_64-pc-windows-gnu](https://crates.io/crates/winapi-x86_64-pc-windows-gnu/0.4.0) | 0.4.0 | MIT/Apache-2.0 | 无顶层许可文件；需查上游/嵌套目录 |
| [winapi](https://crates.io/crates/winapi/0.3.9) | 0.3.9 | MIT/Apache-2.0 | LICENSE-APACHE, LICENSE-MIT |
| [window-vibrancy](https://crates.io/crates/window-vibrancy/0.6.0) | 0.6.0 | Apache-2.0 OR MIT | LICENSE-APACHE, LICENSE-MIT, LICENSE.spdx |
| [windows-collections](https://crates.io/crates/windows-collections/0.2.0) | 0.2.0 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows-core](https://crates.io/crates/windows-core/0.61.2) | 0.61.2 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows-core](https://crates.io/crates/windows-core/0.62.2) | 0.62.2 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows-future](https://crates.io/crates/windows-future/0.2.1) | 0.2.1 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows-implement](https://crates.io/crates/windows-implement/0.60.2) | 0.60.2 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows-interface](https://crates.io/crates/windows-interface/0.59.3) | 0.59.3 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows-link](https://crates.io/crates/windows-link/0.1.3) | 0.1.3 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows-link](https://crates.io/crates/windows-link/0.2.1) | 0.2.1 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows-numerics](https://crates.io/crates/windows-numerics/0.2.0) | 0.2.0 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows-registry](https://crates.io/crates/windows-registry/0.6.1) | 0.6.1 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows-result](https://crates.io/crates/windows-result/0.3.4) | 0.3.4 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows-result](https://crates.io/crates/windows-result/0.4.1) | 0.4.1 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows-strings](https://crates.io/crates/windows-strings/0.4.2) | 0.4.2 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows-strings](https://crates.io/crates/windows-strings/0.5.1) | 0.5.1 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows-sys](https://crates.io/crates/windows-sys/0.45.0) | 0.45.0 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows-sys](https://crates.io/crates/windows-sys/0.52.0) | 0.52.0 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows-sys](https://crates.io/crates/windows-sys/0.59.0) | 0.59.0 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows-sys](https://crates.io/crates/windows-sys/0.60.2) | 0.60.2 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows-sys](https://crates.io/crates/windows-sys/0.61.2) | 0.61.2 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows-targets](https://crates.io/crates/windows-targets/0.42.2) | 0.42.2 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows-targets](https://crates.io/crates/windows-targets/0.52.6) | 0.52.6 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows-targets](https://crates.io/crates/windows-targets/0.53.5) | 0.53.5 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows-threading](https://crates.io/crates/windows-threading/0.1.0) | 0.1.0 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows-version](https://crates.io/crates/windows-version/0.1.7) | 0.1.7 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows](https://crates.io/crates/windows/0.61.3) | 0.61.3 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows_aarch64_gnullvm](https://crates.io/crates/windows_aarch64_gnullvm/0.42.2) | 0.42.2 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows_aarch64_gnullvm](https://crates.io/crates/windows_aarch64_gnullvm/0.52.6) | 0.52.6 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows_aarch64_gnullvm](https://crates.io/crates/windows_aarch64_gnullvm/0.53.1) | 0.53.1 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows_aarch64_msvc](https://crates.io/crates/windows_aarch64_msvc/0.42.2) | 0.42.2 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows_aarch64_msvc](https://crates.io/crates/windows_aarch64_msvc/0.52.6) | 0.52.6 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows_aarch64_msvc](https://crates.io/crates/windows_aarch64_msvc/0.53.1) | 0.53.1 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows_i686_gnu](https://crates.io/crates/windows_i686_gnu/0.42.2) | 0.42.2 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows_i686_gnu](https://crates.io/crates/windows_i686_gnu/0.52.6) | 0.52.6 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows_i686_gnu](https://crates.io/crates/windows_i686_gnu/0.53.1) | 0.53.1 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows_i686_gnullvm](https://crates.io/crates/windows_i686_gnullvm/0.52.6) | 0.52.6 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows_i686_gnullvm](https://crates.io/crates/windows_i686_gnullvm/0.53.1) | 0.53.1 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows_i686_msvc](https://crates.io/crates/windows_i686_msvc/0.42.2) | 0.42.2 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows_i686_msvc](https://crates.io/crates/windows_i686_msvc/0.52.6) | 0.52.6 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows_i686_msvc](https://crates.io/crates/windows_i686_msvc/0.53.1) | 0.53.1 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows_x86_64_gnu](https://crates.io/crates/windows_x86_64_gnu/0.42.2) | 0.42.2 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows_x86_64_gnu](https://crates.io/crates/windows_x86_64_gnu/0.52.6) | 0.52.6 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows_x86_64_gnu](https://crates.io/crates/windows_x86_64_gnu/0.53.1) | 0.53.1 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows_x86_64_gnullvm](https://crates.io/crates/windows_x86_64_gnullvm/0.42.2) | 0.42.2 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows_x86_64_gnullvm](https://crates.io/crates/windows_x86_64_gnullvm/0.52.6) | 0.52.6 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows_x86_64_gnullvm](https://crates.io/crates/windows_x86_64_gnullvm/0.53.1) | 0.53.1 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows_x86_64_msvc](https://crates.io/crates/windows_x86_64_msvc/0.42.2) | 0.42.2 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows_x86_64_msvc](https://crates.io/crates/windows_x86_64_msvc/0.52.6) | 0.52.6 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [windows_x86_64_msvc](https://crates.io/crates/windows_x86_64_msvc/0.53.1) | 0.53.1 | MIT OR Apache-2.0 | license-apache-2.0, license-mit |
| [winnow](https://crates.io/crates/winnow/0.5.40) | 0.5.40 | MIT | LICENSE-MIT |
| [winnow](https://crates.io/crates/winnow/0.7.15) | 0.7.15 | MIT | LICENSE-MIT |
| [winnow](https://crates.io/crates/winnow/1.0.4) | 1.0.4 | MIT | LICENSE-MIT |
| [winreg](https://crates.io/crates/winreg/0.55.0) | 0.55.0 | MIT | LICENSE |
| [wit-bindgen](https://crates.io/crates/wit-bindgen/0.57.1) | 0.57.1 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | LICENSE-APACHE, LICENSE-Apache-2.0_WITH_LLVM-exception, LICENSE-MIT |
| [writeable](https://crates.io/crates/writeable/0.6.4) | 0.6.4 | Unicode-3.0 | LICENSE |
| [wry](https://crates.io/crates/wry/0.55.1) | 0.55.1 | Apache-2.0 OR MIT | LICENSE-APACHE, LICENSE-MIT, LICENSE.spdx |
| [x11-dl](https://crates.io/crates/x11-dl/2.21.0) | 2.21.0 | MIT | LICENSE-MIT |
| [x11](https://crates.io/crates/x11/2.21.0) | 2.21.0 | MIT | LICENSE-MIT |
| [yoke-derive](https://crates.io/crates/yoke-derive/0.8.2) | 0.8.2 | Unicode-3.0 | LICENSE |
| [yoke](https://crates.io/crates/yoke/0.8.3) | 0.8.3 | Unicode-3.0 | LICENSE |
| [zbus](https://crates.io/crates/zbus/5.19.0) | 5.19.0 | MIT | LICENSE |
| [zbus_macros](https://crates.io/crates/zbus_macros/5.19.0) | 5.19.0 | MIT | LICENSE |
| [zbus_names](https://crates.io/crates/zbus_names/4.3.4) | 4.3.4 | MIT | LICENSE |
| [zcheapstr](https://crates.io/crates/zcheapstr/1.1.0) | 1.1.0 | MIT | LICENSE |
| [zerofrom-derive](https://crates.io/crates/zerofrom-derive/0.1.7) | 0.1.7 | Unicode-3.0 | LICENSE |
| [zerofrom](https://crates.io/crates/zerofrom/0.1.8) | 0.1.8 | Unicode-3.0 | LICENSE |
| [zeroize](https://crates.io/crates/zeroize/1.9.0) | 1.9.0 | Apache-2.0 OR MIT | LICENSE-APACHE, LICENSE-MIT |
| [zerotrie](https://crates.io/crates/zerotrie/0.2.5) | 0.2.5 | Unicode-3.0 | LICENSE |
| [zerovec-derive](https://crates.io/crates/zerovec-derive/0.11.6) | 0.11.6 | Unicode-3.0 | LICENSE |
| [zerovec](https://crates.io/crates/zerovec/0.11.8) | 0.11.8 | Unicode-3.0 | LICENSE |
| [zip](https://crates.io/crates/zip/2.4.2) | 2.4.2 | MIT | LICENSE |
| [zlib-rs](https://crates.io/crates/zlib-rs/0.6.7) | 0.6.7 | Zlib | LICENSE |
| [zmij](https://crates.io/crates/zmij/1.0.23) | 1.0.23 | MIT | LICENSE-MIT |
| [zopfli](https://crates.io/crates/zopfli/0.8.3) | 0.8.3 | Apache-2.0 | COPYING |
| [zune-core](https://crates.io/crates/zune-core/0.5.3) | 0.5.3 | MIT OR Apache-2.0 OR Zlib | LICENSE-APACHE, LICENSE-MIT, LICENSE-ZLIB |
| [zune-jpeg](https://crates.io/crates/zune-jpeg/0.5.15) | 0.5.15 | MIT OR Apache-2.0 OR Zlib | LICENSE-APACHE, LICENSE-MIT, LICENSE-ZLIB |
| [zvariant](https://crates.io/crates/zvariant/5.15.0) | 5.15.0 | MIT | LICENSE |
| [zvariant_derive](https://crates.io/crates/zvariant_derive/5.15.0) | 5.15.0 | MIT | LICENSE |
| [zvariant_utils](https://crates.io/crates/zvariant_utils/4.2.0) | 4.2.0 | MIT | LICENSE |
