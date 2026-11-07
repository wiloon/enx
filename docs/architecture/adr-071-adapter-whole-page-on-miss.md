---
status: accepted
date: 2026-11-07
related: adr-010（站点 adapter；本 ADR 修订它的「未命中」规则）、adr-034（整页只能划词查词）、adr-070（决定 3 的一次例外）
amends: adr-010（`contentSelector` 未命中的行为）、adr-070 决定 3（仅 #700）
---

# ADR-071：站点 adapter 可选择「未命中就退回整页」；#700 先于评估工具交付

#700 给 Standard Ebooks 加 adapter 时冒出两个所有者决定，各自改了一份已 accepted 的 ADR。按 `docs/agents/domain.md`「When a decision changes」，写成这份新 ADR，不在原 ADR 里追加修订。

## 决定 1：adapter 可选择未命中时退回整页（修订 ADR-010）

ADR-010 定的是：带 `contentSelector` 的 adapter 匹配不到时返回空正文，启用失败（`no-article-node`），不再兜底。这条仍是默认。

新增：adapter 可以显式打开「未命中就退回整页」（`SiteAdapter.wholePageOnMiss`）。打开后，`contentSelector` 匹配不到时按 ADR-034 的整页模式启用：只能划词查词，不绑定单击，不画下划线，不计阅读统计，也不报错、不上报失败。

- **用它的：** Standard Ebooks 的书页（`/ebooks/…/text/…`）。单独的标题页、版权页、colophon、尾注页没有 `bodymatter`，所有者希望这些页面安静地启用、能划词，而不是报错。
- **不用它的：** X、Reader、RSSX、Wikipedia 保持 ADR-010 的行为。

**为什么现在可以这样做：** ADR-010 定规则时，整页兜底还会拦截单击，所以「匹配不到就报错」更安全。ADR-034 修订（2026-11-07）之后，整页只能划词，不再碍事，退回整页的代价变小了。

**没选的方案：** 报错（用户在标题页、版权页上看到错误，还会产生失败上报）；只在已知的正文网址上启用 adapter（要猜站点的网址命名，`chapter-1`、`act-1`、`the-raven` 都有，容易漏）。

## 决定 2：#700 不附评估分数先交付（ADR-070 决定 3 的例外）

ADR-070 决定 3 要求每次正文识别改动附上评估工具的改前、改后分数。工具（#702）还没做，#700 先交付，靠它自己的测试和真实浏览器检查。#702 落地时把 Standard Ebooks 的整本页、分章节页和版权页网址加进站点清单。

这次例外只针对 #700；决定 3 对其他改动不变。

## 后果

- `wholePageOnMiss` 是每个 adapter 自己的选择。以后别的站点也要这种行为，打开这个字段即可，不用再改 ADR。
- 打开了它的 adapter，selector 失效（站点改版）时不会报错，只会悄悄退回整页，失败上报里看不到。这类退化要靠 ADR-070 的评估工具发现。
