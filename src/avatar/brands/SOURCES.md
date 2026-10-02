# Built-in avatar brand assets

Checked on 2026-10-02 for #100 and the user's subsequent transparent-avatar request.
These official marks remain their owners' artwork and trademarks, outside Ayase
Studio's MIT license. No endorsement or ownership is implied.

All 11 assets originate from official sites or official CDN brand packages.
No third-party icon library, Cherry Studio asset or generated artwork is shipped.
The user approved removing backplates and explicitly authorized deterministic
pixel processing for Doubao. Exact transformations are recorded below.

## Sources and transformations

| Brand / file | Official source | Transformation |
| --- | --- | --- |
| [OpenAI](openai.svg) | [Official CDN ZIP](https://cdn.openai.com/brand/OpenAI-Logos-2025.zip), member `OpenAI-logos(new)/SVGs/OpenAI-black-monoblossom.svg`; [brand page](https://openai.com/brand/) | Exact transparent member bytes. Brand page's dynamic download target was not exposed; page-to-ZIP association is not claimed. Replaces the blue-circle favicon. |
| [Anthropic](anthropic.svg) | [Official homepage](https://www.anthropic.com/), mobile navigation inline AI glyph | Both glyph paths unchanged; standalone SVG namespace/35×24 dimensions added. Replaces opaque webclip. |
| [Gemini](gemini.png) | [Gemini homepage](https://gemini.google.com/), [512px PNG](https://www.gstatic.com/lamda/images/gemini_sparkle_4g_512_lt_f94943af3be039176192d.png) linked by icon declarations | Original transparent bytes unchanged. |
| [xAI](xai.svg) | [Official docs](https://docs.x.ai/), [favicon SVG](https://docs.x.ai/_next/static/media/favicon-light.1u6watcuoe8mg.svg?dpl=65f744a318e354c1cfb196e6a978815fc4482929) | Removed the independent white backplate path; glyph paths, clipping/mask unchanged. Current SpaceXAI-era mark. |
| [OpenRouter](openrouter.svg) | [Official brand assets](https://openrouter.ai/brand), [Grape glyph SVG](https://openrouter.ai/brand/logos/transparent/glyph/svg/glyph-grape.svg) | Original transparent bytes unchanged, 1024×730 proportions. |
| [DeepSeek](deepseek.png) | [Official homepage](https://www.deepseek.com/), [favicon ICO](https://www.deepseek.com/favicon.ico) | Lossless PNG extraction of sole 225px frame; decoded RGBA unchanged, already transparent. |
| [Zhipu](zhipu.svg) | [BigModel homepage](https://www.bigmodel.cn/), [official Z SVG](https://static.bigmodel.cn/wd-paas-front/img/z-pure-logo.b65701e5.svg), located through its page script | Removed gradient backplate and unused gradient; three white glyph paths unchanged. |
| [Qwen](qwen.png) | [Qwen homepage](https://qwen.ai/), [80px PNG](https://img.alicdn.com/imgextra/i4/O1CN01OXv3EM1FN8t9W4P79_!!6000000000474-2-tps-80-80.png) | Original transparent bytes unchanged. |
| [Moonshot](moonshot.svg) | [Official homepage](https://www.moonshot.cn/), linked [wordmark SVG](https://statics.kimi.ai/moonshot-ai/assets/static/moonshot-ai-wordmark.DeMGOuiG.svg) | Final independent planet path retained verbatim in 33×33 viewport, lettering omitted. Keeps company globe rather than Kimi product mark. |
| [Doubao](doubao.png) | [Official homepage](https://www.doubao.com/), [192px PNG](https://lf-flow-web-cdn.doubao.com/obj/flow-doubao/favicon/new-doubao/192x192.png) | [Reproducible pixel script](../../../scripts/providers100/remove-doubao-background.py) removes connected blue matte and inspects adjacent edges only. Original dimensions and other RGBA pixels preserved; no redrawing. |
| [MiniMax](minimax.png) | [Official brand page](https://www.minimax.cn/brand-vi), [brand ZIP](https://file.cdn.minimax.io/public/brand-vi/20260914/MiniMax_Logo_Asset.zip), member `MiniMax_Logo_Asset/png/Vertical/BrandColor_Black.png` | Original 1600×1600 transparent colored waveform and wordmark unchanged. Replaces tiny gradient-square favicon. |

## Byte provenance

| Shipped file | Bytes | SHA-256 |
| --- | ---: | --- |
| anthropic.svg | 357 | `b59f6e86b883c3d02e9a654f9a2a2225a4587f16d66b266079250028583cdcd2` |
| deepseek.png | 6370 | `cba0168e484cf74016847e09aff47c839f4198000a52f19e76f44a73dafe24e4` |
| doubao.png | 32516 | `841bb6fe7b478f49782607fc11e23b8faba56aaaaf36f707ca7706cd334ba694` |
| gemini.png | 61823 | `5e7cfecaa53f4f65a313fe89b0f389548126544a78fad8489510c70ae641a4a1` |
| minimax.png | 348254 | `dead3bc35c62af9e13d8d341f0037c51c97dff543e9084468976b029f76acb59` |
| moonshot.svg | 1284 | `ce212ecdf0b20ca9df28bf31a7212e339e3cad86a0fe0c7174c4f8f5e996deec` |
| openai.svg | 2969 | `7be72f1fea831d3ba81a545cee79b7e0ae69449d5d7837c9571ccbfb4aa1e00b` |
| openrouter.svg | 563 | `5b49593d44e6aa41011be377e182cd89e57473f1948e0dfb128f99a92adfc68d` |
| qwen.png | 1658 | `cd9390bc4209c319121d111f3a1f535b3c7dd909b8f860d41acc9744138d58df` |
| xai.svg | 1227 | `4b4ebeed93f28fbb40efce16c2e71727af474c2709c5ccaf78bfe7cf766b8843` |
| zhipu.svg | 491 | `e65e27301ca12d9a0c804ed0f2a35a51762c1b4f91d37ad8c709958a519f7f3c` |

Source hashes for transformed assets:

- Anthropic raw inline fragment: `408f5a26940ca5f71d518c7b5fd0016c8d94b4854218f6a2a8329a7c4def5d95`.
- xAI original SVG: `f441eef32955dabf2ded0bb66bf5674a53afb81557d9281c00735dd245dfdc86`.
- Zhipu original SVG: `1b9098f886c3033dadbae6c48e1064f58f6c5f303eb1a107ff40cab0d0011b1e`.
- Moonshot original wordmark: `441f80552221dbb5bac7af7b84265f0fee03655426359cd48d10952c65058c11`.
- Doubao original PNG: `dabb2abd94e3a6c11e7f1a42c9343839b6ef643c086751b71afbc68f615aec38`.
- DeepSeek original ICO: `30a4420e6e4dcb17fd7de560c5004346c2bc8cd971d2d5f5ee15326603e51321`.
- OpenAI ZIP: `b2c4cd1e86bbe76bdc4946a72d014efa455240c177f4878fd68cc9b88c71d2ec`.
- MiniMax ZIP: `c089a20fd690214bb0a7f474bebe5bcb1a0c7c4300369dcaad9b19eb5d0d6777`.

Doubao processing removes 19,720 backdrop pixels including originally transparent
pixels and inspects only 769 adjacent edge pixels for unmatting. All remaining
original RGBA pixels are exact. The imagegen candidate was rejected because it
regenerated details; its bytes are not used or shipped. Package containers and
unused candidates remain outside shipped assets.

Display keeps aspect ratio and uses 7.8125% padding. Five monochrome marks adapt
black/white to the current theme in the display layer; colored marks remain
unchanged. New independent user/assistant PNG snapshots capture the appearance
at selection time without a background fill; later theme changes do not
rewrite these pixels or old snapshots.

## Published guidance and unresolved constraints

These are source facts for review, not a claim that downloads grant an
open-source artwork license or that every referential use is prohibited.
No individual trademark permission or endorsement was obtained. No separate
redistributable artwork license was found for the website favicons. Accurate
supplier identification is distinct from incorporating marks into Ayase's own
branding.

| Brand | Official guidance checked | Relevant published facts |
| --- | --- | --- |
| OpenAI | [Brand guidelines and usage terms](https://openai.com/brand/) | Describes limited, nonexclusive, nontransferable permission subject to guidelines; logos should relate directly to OpenAI services, retain supplied appearance/spacing, acknowledge ownership, and not imply endorsement. The developer-site favicon is not represented as brand-kit Blossom artwork. |
| Anthropic | [Trademark Guidelines](https://www.anthropic.com/legal/trademark-guidelines) | Calls for specific permission and advance approval of materials, supplied images and size/spacing requirements; prohibits alterations/implied affiliation. The glyph is official-site artwork; individual approval is unverified. |
| Gemini | [Product icon guidance](https://partnermarketinghub.withgoogle.com/brands/google/branding-guidelines/how-to-show-googles-brand/), [compatibility guidance](https://partnermarketinghub.withgoogle.com/brands/google/use-cases/product-co-branding/) | General icon guidance asks approval and context; compatibility guidance discusses necessary icons in grids/product UI and calls for legal attribution. Selectable avatar context and attribution remain review concerns. |
| xAI | [Brand guidelines](https://x.ai/legal/brand-guidelines) | Allows accurate reference to company/services, prohibits implied endorsement, requests exact logos from its [download ZIP](https://data.x.ai/logos/SpaceXAI_Grok_Assets.zip). ZIP returned HTTP 403; imported SVG is instead the current official docs favicon. Brand-kit equivalence is unverified. |
| OpenRouter | [Brand assets](https://openrouter.ai/brand) | Supplies ready-to-use configurations and avatar glyph; asks no stretching, recoloring, or remixing. Separate open-source artwork license unavailable. |
| DeepSeek | [Terms of Use](https://cdn.deepseek.com/policies/en-US/deepseek-terms-of-use.html), section 6.2 | Reserves logos/prominent brand features to permitted or licensed uses; individual permission unverified. |
| Zhipu | [BigModel agreement](https://docs.bigmodel.cn/cn/terms/user-agreement), related [Z.ai terms](https://chat.z.ai/legal-agreement/terms-of-service) | BigModel agreement timed out, so exact asset-specific guidance unavailable. Related Z.ai terms ask prior written consent for company/affiliate marks; not presented as a BigModel artwork license. |
| Qwen | [Terms of Service](https://qwen.ai/termsservice), section V | Reserves ownership and prohibits unauthorized copying/modification/use/publication of marks; individual authorization unverified. |
| Moonshot | [Kimi manual](https://www.kimi.com/resources/kimi-brand), [Kimi logo terms](https://www.kimi.com/zh-cn/policies/logo-usage-terms), linked by Moonshot | Kimi terms cover media/news/noncommercial display, forbid alteration/misleading association, reserve revocation. Kimi-specific terms are not represented as a blanket Moonshot company-mark license. |
| Doubao | [Copyright statement](https://www.doubao.com/legal/ip_report), [service terms](https://www.doubao.com/legal/terms) | Restricts copying/use/bundling of owned content/marks without written permission, subject to applicable law; individual permission unverified. |
| MiniMax | [Brand book and terms](https://www.minimax.cn/brand-vi) | Reserves ownership, prohibits alteration/separation/sublicensing/misleading association, asks review for unaddressed scenarios. The vertical transparent brand-package asset is imported intact. |


## Verification boundaries

- Five PNGs decode as single-frame images; six SVGs are static, local assets.
  SVGs have no scripts, event handlers, external resources/fonts, animation,
  foreign objects, document types or entities. Internal clipping and masks are
  retained. Unknown/missing assets still fall back safely.
- Original transparent resources preserve source bytes; transformed glyph paths
  remain exact and Doubao foreground preservation is asserted by the script.
- Browser acceptance checks real Alpha PNG encoding, transparent containers,
  crop output including a 50% Alpha sample, both themes and displayed sizing.
  Native file dialogs and existing user snapshots are separate acceptance.
- Provenance and markup checks do not establish trademark permission. Published
  restrictions above remain available for review.
- No live provider calls, login, publication or Git delivery is involved.
