# 第三方许可与资源归属

核验日期：2026-10-03。#57 的文档整理以当前 Beta 1 开发状态为准；Issue 原文的 Alpha 表述是历史阶段。本文件整理已知声明及待核实项，不改变主项目许可证，也不将来源记录当作品牌授权。

## 主项目与依赖清单

Ayase Studio 自有源码和文档适用根目录 [MIT LICENSE](../LICENSE)，版权归 AyaseMinami。第三方代码、字体、品牌图像和工具仍受各自声明约束；本项目 MIT 不重新许可这些材料。仓库自制应用图标的源文件、导出过程及边界见 [品牌资源说明](../assets/branding/README.md)。

[完整锁定清单](THIRD-PARTY-DEPENDENCIES.md) 记录 272 个 npm 锁定位置（151 个非 dev 项）和 556 个 Rust 外部包的版本、原始许可表达式、源包入口和本机顶层许可文件。包括开发依赖、可选平台包和 Rust 全目标依赖，数量不等于安装包实际包含数量。所有条目都有包级许可声明；缺少本机全文、未安装平台包、嵌套代码和原始表达式的组合要求仍需分别核实。

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

## 尚待完成的分发核验

- 本轮完成依赖/资源登记与缺口标注；没有宣称安装包已完成全部许可随附要求。当前 `tauri.conf.json` 未配置独立的第三方 notices 资源；本轮 `dist` 也没有专门的许可全文集合，需在下一次分发前核对构建保留的版权、完整许可证、NOTICE 及需要提供的源代码材料。
- 缺少本机顶层全文的项目已在清单逐项标明；应结合精确发布版本及嵌套目录补足，不能因包级 SPDX 非空判定完整。
- 11 个厂商品牌的授权/修改/头像使用边界继续按来源记录待核实。没有据此推断违法或已获许可，也没有自动替换品牌资源。
- 本次没有重打安装包、改变打包脚本或发布检查门禁；安装包中的真实文件/链接范围、平台工具链声明及最终分发包仍待核验。

这满足 #57 对“无法确认的内容明确标注待核实”的记录要求，不能代替最终分发授权判断。与代码和缓存审查的共同结果见 [#57 / #106 审查记录](ISSUE-57-106-AUDIT.md)。
