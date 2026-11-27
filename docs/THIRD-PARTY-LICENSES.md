# 第三方许可与资源归属

核验日期：2026-11-27（初核 2026-10-03）。本文件随 `#106` 正式版 `0.1.0` 发布前整改更新：已补齐随安装包分发的根目录 [THIRD-PARTY-NOTICES.txt](../THIRD-PARTY-NOTICES.txt)（注册于 `src-tauri/tauri.conf.json` `bundle.resources`），并按用户于 2026-11-27 拍板的个人非商用开源项目边界维持 11 个厂商品牌标识现状；本文件不改变主项目 MIT 许可证，也不将来源记录当作品牌授权。

## 主项目与依赖清单

Ayase Studio 自有源码和文档适用根目录 [MIT LICENSE](../LICENSE)，版权归 AyaseMinami。第三方代码、字体、品牌图像和工具仍受各自声明约束；本项目 MIT 不重新许可这些材料。仓库自制应用图标的源文件、导出过程及边界见 [品牌资源说明](../assets/branding/README.md)。

[完整锁定清单](THIRD-PARTY-DEPENDENCIES.md) 记录 272 个 npm 锁定位置（151 个非 dev 项）和 608 个 Rust 外部包的版本、原始许可表达式、源包入口和本机顶层许可文件。包括开发依赖、可选平台包和 Rust 全目标依赖，数量不等于安装包实际包含数量。所有条目都有包级许可声明；缺少本机全文、未安装平台包、嵌套代码和原始表达式的组合要求仍需分别核实。

#76 新增官方 Tauri updater 和 minisign 验签依赖。`src-tauri/src/update_signature.rs` 的公开测试向量来自锁定 `minisign-verify 0.2.5`，遵循该 crate MIT 许可（其内置 `src/crypto` 衍生自 rust-crypto 并保留 Graydon Hoare 与 Mozilla Foundation 版权声明），仅用于合成验签／篡改测试，不是发布密钥。

从仓库根目录运行以下命令刷新记录；需要已安装 npm 依赖和已缓存 Cargo 包，不会安装或联网。两个锁文件的 SHA-256 随清单保存；依赖升级后应重新核对。

```powershell
node scripts/inventory-third-party.mjs
```

## 主要代码、图标和字体

| 对象 | 当前来源与声明 | 核验说明 |
| --- | --- | --- |
| React / React DOM、Dexie、OpenAI JS、highlight.js / lowlight、unified / remark / rehype、js-tiktoken | 锁定 npm 包，主要为 MIT；逐包见清单 | 不将这些依赖的代码归为 Ayase 自有代码。js-tiktoken、remark-math、rehype-katex 的当前本机包没有顶层全文，需保留对应上游声明。 |
| Lucide 图标 | `lucide-react/LICENSE`：ISC；其中列出的 Feather 衍生图标另附 MIT | 全文含 Lucide Icons and Contributors 与 Cole Bemis 版权；不能只依据 package.json 的 ISC 字段丢掉 Feather 部分。[官方许可](https://lucide.dev/license)。 |
| KaTeX 与数学字体 | `katex/LICENSE`：MIT，Khan Academy and other contributors；[字体项目许可](https://github.com/KaTeX/katex-fonts/blob/master/LICENSE)：MIT，Khan Academy | `SafeMarkdown.tsx` 导入 KaTeX CSS。当前构建输出含 59 个外置字体文件，另有可能内联的小资源；它们来自 KaTeX，不能描述为“应用不附带字体”。 |
| 系统界面字体 | 操作系统提供；仓库没有另外复制 Microsoft YaHei、Segoe UI 等系统字体文件 | CSS 指定字体族不等于重新分发字体文件；用户自行选择的系统字体也不属于本项目许可。 |
| PDF.js 与 worker | `pdfjs-dist/LICENSE`：Apache-2.0；[官方项目](https://github.com/mozilla/pdf.js/blob/master/LICENSE) | 通过动态 import 打包主模块及 worker。包内可选字体、CMap、WASM、ICC 各有独立声明，见下表，不能全部归为 Apache-2.0。 |
| Tauri 与插件、Rust 依赖 | Cargo 锁定版本的 crate 原始许可；MIT/Apache 双许可居多，另有 MPL、BSD、ISC、Unicode、CDLA 等 | 完整表达式保留 AND、OR、例外及上游旧式斜杠，不自动解释为单一许可。MPL 项包括 cssparser、cssparser-macros、dtoa-short、option-ext、selectors；具体 Windows 编译/分发范围需按产物核验。 |
| SVG／GIF 原生处理 | resvg／usvg、roxmltree、image GIF codec 及传递依赖的锁定许可 | resvg／usvg 为 Apache-2.0 OR MIT，roxmltree 为 MIT OR Apache-2.0；具体原始表达式和本机 LICENSE 文件见锁定清单。SVG 字体由操作系统提供，不复制系统字体文件到仓库。 |
| SQLite | `libsqlite3-sys` Rust 包为 MIT；其 bundled SQLite 有独立来源与公有领域声明 | 不能以封装 crate 的 MIT 替代 SQLite 自身归属。[SQLite 官方声明](https://www.sqlite.org/copyright.html)。 |
| ring / TLS 根证书 | ring 附 `LICENSE`、`LICENSE-BoringSSL`、`LICENSE-other-bits`；webpki-roots 声明 CDLA-Permissive-2.0 | 保留复合来源，不根据顶层 Rust 项目许可证覆盖嵌套代码/数据声明。 |
| NSIS 安装器模板 | [仓库保留的 Tauri MIT 声明](../src-tauri/windows/LICENSE-TAURI-MIT) | 模板改编来源与版权继续保留；安装器工具链/WebView2 的分发材料需按最终包另核对。 |

上游补充来源：[js-tiktoken 仓库许可](https://github.com/dqbd/tiktoken/blob/main/LICENSE)、[remark-math / rehype-katex 仓库许可](https://github.com/remarkjs/remark-math/blob/main/license)。2026-10-03 可读取的上游文本均为 MIT；这些主分支链接只补充来源，锁定版本与最终随包全文仍须对应，不能把主分支当作冻结证据。

### PDF.js 包内附加资源

| 包内目录 | 独立声明文件 | 当前构建范围 |
| --- | --- | --- |
| `standard_fonts` | `LICENSE_FOXIT`、`LICENSE_LIBERATION` | Foxit 文件记录 BSD 条件；Liberation 文件记录 GPL v2 及字体例外。当前 Vite 配置没有整目录复制，也未配置 `standardFontDataUrl`。 |
| `cmaps` | `LICENSE` | 包内 CMap 声明；当前未整目录复制或配置 `cMapUrl`。 |
| `wasm` | `LICENSE_QCMS`、`LICENSE_PDFJS_QCMS`、`LICENSE_OPENJPEG`、`LICENSE_PDFJS_OPENJPEG`、`LICENSE_JBIG2`、`LICENSE_PDFJS_JBIG2` | 当前构建未输出独立 WASM 文件；后续若加入解码资源必须逐项携带对应声明。 |
| `iccs` | `LICENSE`（CC0 1.0） | 当前未整目录复制。 |

上表通过本机 `pdfjs-dist@6.3.289` 文件及本轮构建目录核对，只说明这些独立文件未整体输出，不断言 worker 内没有内嵌第三方实现。

## 厂商标识与外部图片

11 个厂商标识的官方 URL、字节哈希、裁切/去底过程及逐品牌使用条款已记录在 [SOURCES.md](../src/avatar/brands/SOURCES.md)。本轮重新核对全部 11 个已入库文件与记录哈希一致。它们不是 Ayase MIT 资源，也不表示厂商背书。

该来源记录明确列出尚未取得单独授权、部分网站 favicon 未找到可再分发美术许可、以及品牌图形改动/自由选择为头像的使用场景问题。用户授权本地处理图片不等于品牌权利人授权。来源可访问、解码成功或图片哈希一致，均不能消除这些待核实项；本轮没有替换或进一步修改图像。

用户自行导入的头像、壁纸、附件以及模型生成内容不是仓库附带的第三方素材，其权利状态取决于用户和相应服务，不能自动适用主项目 MIT。

## 分发随附与核验状态（2026-11-27 更新）

- 根目录 [THIRD-PARTY-NOTICES.txt](../THIRD-PARTY-NOTICES.txt) 已按锁定依赖编写，并通过 `src-tauri/tauri.conf.json` 的 `bundle.resources` 注册为安装目录随包文件，涵盖 Ayase Studio MIT、主要前端/Rust MIT/Apache-2.0/ISC/BSD/MPL 依赖、KaTeX 及数学字体 MIT、Lucide ISC + Feather MIT、PDF.js Apache-2.0、SQLite 公有领域归属、ring/BoringSSL/webpki-roots 复合声明、resvg/usvg/roxmltree、Tauri NSIS 模板 MIT 及非 MIT 品牌标识声明。
- 11 个厂商品牌标识经用户 2026-11-27 拍板，按个人非商用开源项目边界保留现状，维持 [README.md](../README.md)、[THIRD-PARTY-NOTICES.txt](../THIRD-PARTY-NOTICES.txt) 与 [SOURCES.md](../src/avatar/brands/SOURCES.md) 的非 MIT / 非厂商背书声明及原始字节哈希，不替换或重采样。
- 缺少本机顶层全文的传递/可选依赖已在 [完整锁定清单](THIRD-PARTY-DEPENDENCIES.md) 逐项标明；构建 `v0.1.0` 候选安装包后仍须在 Windows 实机确认安装目录中 `THIRD-PARTY-NOTICES.txt` 已随包到位。

历史记录见 [#57 / #106 审查记录](ISSUE-57-106-AUDIT.md)，本轮正式版发布前整改与实机验收清单见 [#106 正式版发布前方案](ISSUE-106-PRE-RELEASE-PLAN.md)。
