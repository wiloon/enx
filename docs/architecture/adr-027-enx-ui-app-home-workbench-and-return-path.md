# ADR-027：enx-ui 应用区 Home 从「功能目录」改成**状态驱动的个人工作台**（新用户走 3 步引导、老用户看今日状态 + 继续阅读），卡片整块可点取消卡内按钮，品牌青蓝 `--brand` **进入应用区**（修订 ADR-013 决策 4），并补上应用区 → 营销站的返回入口

| 字段 | 值 |
| --- | --- |
| **状态** | **阶段 1 + 阶段 2 均已实现 — 阶段 2 于 2026-09-17 落地**（数据源见 [`adr-028`](adr-028-reading-stats-what-to-measure.md)）。**2026-09-17 五次修订**：用户提出「继续阅读不是主要功能」，**Home 的「继续阅读」整块移除**，位置让给状态条；见文末「阶段 2 落地与对 Decision 1 的修订」。**2026-09-16 二次修订**：统计的「测什么 / 怎么采 / 怎么存」已拆到 ADR-028，本 ADR 收敛为**只管交互、布局、配色**；Decision 1 的状态条字段、Decision 7 的 `overview` 契约、Decision 8 的 streak 结论均按 ADR-028 回写。**三次修订**：[`adr-029`](adr-029-lookup-quota-tiered-limits-and-count-gate-split.md) 把配额改成分档模型，剩余额度对所有用户都算得出来了，Decision 10 的显示方式随之改为**状态驱动**（用量 ≥70% 才上状态条）。**四次修订**：用户 2026-09-16 确认对外正式名为 **Catglish**（只有英文名、无中文名，且不再保留任何「猫眼 / cat's eye」表述），本 ADR 范围内的**用户可见**品牌串一并替换；`ENX` 作为开发代号保留，非 UI 代码一律不动。见 Decision 11。 |
| **日期** | 2026-09-16 |
| **关联 Spec** | 无独立 TASK-SPEC，留到编码阶段再写（同 ADR-008/010/011/017/025/026 的做法） |
| **关联 ADR** | [`adr-029-lookup-quota-tiered-limits-and-count-gate-split.md`](adr-029-lookup-quota-tiered-limits-and-count-gate-split.md)（配额分档后剩余额度对全体用户可算，本 ADR Decision 10 的额度显示改为状态驱动）、[`adr-028-reading-stats-what-to-measure.md`](adr-028-reading-stats-what-to-measure.md)（**配对 ADR**：本 ADR 管「Home 长什么样」，028 管「Home 上那些数字是什么、从哪来」。028 的结论反向改了本 ADR 的 Decision 1 / 7 / 8，见各处标注）、[`adr-016-enx-ui-app-shell-navigation.md`](adr-016-enx-ui-app-shell-navigation.md)（**主要依赖**：本 ADR 改的正是其建立的 App Shell 与 `/app` 概览页；其决策 5「`app-nav.ts` 是导航唯一事实源，加一个分区 = 加一行」继续成立，本 ADR 的 `Back to site` 就是加一行；其决策 6「本次范围 = 骨架 + 占位」正是 `/app` 现在这副样子的由来）、[`adr-013-catseye-marketing-site.md`](adr-013-catseye-marketing-site.md)（**本 ADR 显式修订其决策 4 的最后一条**「应用区不引用 `--brand`」，见 Decision 3；返回入口指向的 `/` 即其营销首页）、[`adr-022-enx-ui-reader-persistence-and-retention.md`](adr-022-enx-ui-reader-persistence-and-retention.md)（「继续阅读」直接复用其 `GET /api/reader/documents` 与 7 天 TTL 语义）、[`adr-019-enx-ui-paste-text-reader-web-to-extension-enable.md`](adr-019-enx-ui-paste-text-reader-web-to-extension-enable.md)（扩展安装状态用其 `useExtensionStatus()` / `pingExtension()`）、[`adr-018-dictionary-lookup-single-metered-seam.md`](adr-018-dictionary-lookup-single-metered-seam.md)（阶段 2 的 `stats/overview` **只读配额计数、不是查词**，显式在计量 seam 之外，同 ADR-021/026 的处理）、[`adr-009-billing-stripe-subscription-and-ai-credits.md`](adr-009-billing-stripe-subscription-and-ai-credits.md)（套餐 / 余额小卡读其 `GET /api/billing/me`；免费日配额表 `dictionary_lookup_quota` 的语义边界见 Decision 8） |
| **关联代码** | **阶段 1 已落地（2026-09-16）**：`src/app/(app)/app/page.tsx`（重写）、新增 `src/components/app/home/{OnboardingChecklist,ContinueReading,QuickTiles,PlanCard,ExtensionBanner,tile}.tsx`、`src/components/app/{app-nav.ts,AppSidebar.tsx}`、`src/components/ui/button.tsx`（`brand` variant）、`src/lib/site.ts`、`src/app/globals.css`、新增 `src/lib/readerSession.ts`（`/reader` 与 `/reader/history` 共用的 sessionStorage 交接，避免第三份拷贝）、测试 `src/app/(app)/app/__tests__/page.test.tsx` + `src/components/app/__tests__/AppSidebar.test.tsx`。**两处与本文不同的落地取舍**：(a) `StatStrip` **未创建**——阶段 1 没有数据源，渲染一个永远等不到数据的骨架是误导，留到阶段 2 随 `overview` 一起加；(b) 套餐小卡**暂不显示免费额度余量**（Decision 10），它要等 ADR-029 让额度对全体用户可算之后才有意义。**阶段 2 待实现**（enx-api）：新薄包或 `word/` 下新增 `stats_overview.go` + `enx-api.go` 注册 `GET /api/stats/overview`；enx-ui `src/services/api.ts` + `src/types/index.ts`。 |
| **关联清单** | 不阻塞 `docs/tasks/LAUNCH-CHECKLIST.md` 的任何阻塞项；属于上线前的观感打磨。与 §7.2（产品截图 / OG 图）相关——Home 是截图里最常出现的一屏，建议在出物料**之前**先落地阶段 1。**与 §7.4（品牌统一改名 Catglish）绑定执行**，见 Decision 12。无新增外部服务 / 密钥 / 配置项。 |

---

## 已确认的决策（2026-09-16，用户确认）

1. **本次只出方案，不改代码。** 用户在四个范围选项（仅返回入口 / +重做 Home / +新增统计端点 / 只出方案）中选择「先只出方案」。
2. 方案的两个问题源自用户的直接反馈：**(a)** `/app` 首页「感觉就像是在开发状态，不够美观，另外按钮也是黑色的」；**(b)** 「点击 Open App 之后，好像没有什么菜单或者链接或者按钮能够回到外层的页面了」。

---

## Context

### 现状：`/app` 是什么样

`src/app/(app)/app/page.tsx` 现在是一个 `SHORTCUTS` 常量数组渲染的四宫格：Word Lookup / Rephrase / Reading Stats / Billing，每张卡是「标题 + 两三行功能说明 + 一个 `w-full` 的实心按钮 `Go to X`」。按钮用 `Button` 的默认 variant，`--primary` 是 shadcn scaffold 带来的中性近黑 `oklch(0.205 0 0)`，所以四个满宽黑块并排。

这是 ADR-016 决策 6「本次范围 = 骨架 + 占位」的直接产物。**用户确认：这个四宫格是侧边栏菜单还不存在时做的临时产物**——当时它是应用区**唯一**的导航，四张卡各带一个按钮完全合理。ADR-016 加上侧边栏之后，它的导航职责被彻底接管，却没有人回来收尾。所以它不是「设计得不好」，是**一个已经完成历史任务、忘了拆除的脚手架**。

### 为什么它看着像「开发状态」

不是配色问题，是**信息层级**问题，三条叠加：

1. **和侧边栏重复**。左边 `AppSidebar` 已经把 Word Lookup / Rephrase / Reader / Reading Stats / Billing 全列了一遍，Home 再用四张大卡复述一次。用户每天进来看到的是同一份**产品说明书目录**，信息量为零——而首页恰恰是信息密度应该最高的一屏。
2. **四个等权重的满宽实心按钮**。实心按钮在视觉层级里是「本页的主操作」，一页放四个等于没有主操作，全在喊。加上说明文字长度不一，卡片高度参差，网格失衡。
3. **黑色**。`--brand`（青蓝，`oklch(0.55 0.13 200)`）目前按 ADR-013 只在营销区用；应用区是纯黑白灰。结果是用户从青蓝色的官网点 `Open App` 进来，颜色语言断档——而 enx-chrome 侧边栏**已经**把同一个 teal 当作它的 action color（见 `globals.css` 里 `--brand-hue` 的注释）。三个界面里只有应用区是黑白的，是它不一致，不是它保守。

### 现状：进了 `/app` 回不去官网

`AppSidebar` 的 logo 链接指向 `SITE.appPath`（即 `/app`），而 `NAV_MAIN` 的第一项 Home 也指向 `/app`——**同一个目的地占了两个入口**，而营销站 `/` 一个入口都没有。顶栏右侧只有用户名和 `Sign out`。所以登录用户想回官网（看定价、看 How it works、拿 Chrome Web Store 链接分享给别人），只能改地址栏或点浏览器后退。

这和 ADR-016 当初要解决的问题是**同一类**：那次是「进了 `/rephrase` 回不去 Home」，这次是「进了应用区回不去官网」。ADR-016 修好了应用区内部的导航，顺手删掉了 `/billing` 页里那个指向 `/` 的孤立「返回首页」链（当时判断它语义不一致——它在应用区里却指向营销区）。**那个判断对，但删干净之后没有补上一个正经的替代**，于是营销站的返回路径整个消失了。本 ADR 补这一刀。

### 为什么值得写 ADR

- **跨 ADR 修订**：Decision 3 要推翻 ADR-013 明文写死的「应用区（`(app)`）**不引用** `--brand`」。这种撤销前案的改动必须留下理由，否则下一个人读 ADR-013 会以为是违规实现。
- **难以反悔**：Home 的定位（工作台 vs 目录 vs 直接重定向到功能页）决定后续所有「新功能往哪放」的落点；`Button` 的 `brand` variant 一旦铺开，应用区全部主 CTA 的配色跟着走。
- **真实取舍**：Home 放什么、要不要干脆删掉 Home、统计数据从哪来、「连续 N 天」能不能算（**不能**，见 Decision 8），每个都有多个合理选项且代价不同。
- **一个容易踩的数据陷阱**：`dictionary_lookup_quota` 表**只对免费用户写行**（订阅用户在 `CheckAndIncrementLookup` 之前就被判定豁免），而且 `dictionary-lookup-daily = 0` 时**一行都不写**——查证后发现该表运行时其实是空的。把它当「每日活跃日志」或「今日查词数」的数据源，订阅用户的首页会永远显示 0。**→ 根因已由 [`adr-029`](adr-029-lookup-quota-tiered-limits-and-count-gate-split.md) 修掉**（分档 + 计数与拦截解耦）；但它日界是 UTC，仍不能直接当本地日的学习统计用。

---

## Options Considered

### A. Home 页到底放什么

| 方案 | 说明 | 结论 |
| --- | --- | --- |
| **A1.（采用）状态驱动的个人工作台** | 有数据时：今日状态条 + 继续阅读 + 最近查的词 + 紧凑入口 tile + 扩展状态 + 套餐小卡；无数据时：3 步上手引导 | Home 回答「我现在怎么样 / 接下来做什么」，而不是「这个产品有什么功能」。侧边栏负责导航，Home 负责状态，职责不重叠。新老用户各得其所。 |
| A2. 保持四宫格，只调样式（圆角、阴影、配色） | 最省事 | 治标。用户的「像开发状态」判断本质是「这一屏没告诉我任何我不知道的事」，换个圆角不解决。否决。 |
| A3. 删掉 `/app`，登录后直接落到 `/reader`（或 `/lookup`） | 工具型产品常见做法，少一跳 | 有道理，但扩展安装引导、免费配额提醒、订阅到期 / 余额不足提醒、新用户上手这几件事需要一个家，塞进功能页会污染功能页。且 ADR-016 的 shell 有 Home 项，删掉要连带改导航语义。**否决，但记录**：如果工作台上线后数据显示老用户在 Home 停留 < 2 秒且总是直奔同一个功能，就该重新考虑「记住上次所在分区并直接落地」。 |
| A4. Home 就是 Reading Stats（合并 `/app` 与 `/stats`） | 少一个分区 | 节奏不同：`/stats` 是历史趋势（日 / 周 / 月图表，回顾用，低频），Home 是今天的状态和下一步动作（高频）。合并会让高频信息被低频图表挤下去。否决。但 Home 顶部状态条应当是 `/stats` 的摘要 + 入口。 |

### B. 卡片交互形态（黑按钮问题的正解）

| 方案 | 说明 | 结论 |
| --- | --- | --- |
| **B1.（采用）整卡可点** | `<Link>` 包住整张 tile，hover 时边框转 `border-brand/40` + 轻微阴影，右侧一个小箭头图标，**卡内不放按钮** | 一步消掉 Home 上全部黑按钮；点击热区从一个按钮扩大到整张卡；视觉上从「四个主操作」降级成「四个去处」，符合它们的真实权重。 |
| B2. 保留按钮，只把颜色换成 brand | 改动最小 | 四个满宽实心青蓝块并排，只是把「黑色的喊」换成「青蓝的喊」，层级问题原样保留。否决。 |
| B3. 按钮降级为 `outline` / `ghost` | 比 B2 好 | 仍然是「卡片 + 按钮」的目录形态，且按钮成了卡内唯一可点区域，热区反而比整卡小。否决。 |

### C. 应用区的主色

| 方案 | 说明 | 结论 |
| --- | --- | --- |
| **C1.（采用）`Button` 新增 `brand` variant** | `brand: "bg-brand text-brand-foreground shadow-xs hover:bg-brand/90"`；应用区的**主** CTA 显式用 `variant="brand"`，中性操作继续 `outline` / `ghost`，破坏性继续 `destructive` | 纯增量，不动任何现有组件的默认行为，逐页迁移、随时可回退。shadcn 的 `default`（中性近黑）语义保留给中性场景。 |
| C2. 在 `(app)` 作用域内把 `--primary` 重定义为 `--brand` | 一处改，全应用区跟着变 | `--primary` 不只喂 Button：`--sidebar-primary`、focus ring 的 `--ring`、未来引入的 shadcn 组件都默认吃它。牵连面大且隐式，出问题难定位。否决。 |
| C3. 全局 `--primary = --brand` | 最激进，营销区应用区彻底统一 | 连带改营销区已经调好的视觉，且把「品牌色」和「中性主色」两个语义合并，以后想要一个中性实心按钮就没有了。否决。 |
| — | **对 ADR-013 决策 4 的修订** | ADR-013 写明「应用区（`(app)`）**不引用** `--brand`，行为零变化」。那一条的目的是**让营销区的视觉实验不污染当时稳定的应用区**——是个施工期的隔离措施，不是长期的设计主张。现在 `--brand` 已经定稿（hue 200 是查过同类产品配色后选的）、enx-chrome 侧边栏已经用同一个值当 action color，隔离的理由消失了。本 ADR 把它改成：**应用区通过 `Button` 的 `brand` variant 和 hover 态引用 `--brand`，用于主 CTA 与可点卡片的强调；中性 token 照旧。** |

### D. 回营销站的入口放哪

| 方案 | 说明 | 结论 |
| --- | --- | --- |
| **D1.（采用）侧边栏底部加 `Back to site → /`** | 进 `NAV_FOOTER`，和 Billing 同组，图标用 `Globe`（或 `ArrowLeft`） | 最明确、常驻可见、位置远离主导航不会误点。符合 ADR-016 决策 5「加一个入口 = `app-nav.ts` 加一行」。 |
| **D2.（采用，与 D1 同时）侧边栏 logo 改指 `/`** | `SITE.appPath` → `/` | 顺手消掉 logo 与 Home 项指向同一地址的重复；「点 logo 回主站」是网站通行直觉。两个入口互补：D2 符合习惯但不显眼，D1 显眼但需要看一眼。 |
| D3. 顶栏用户名改成头像下拉菜单，内含 Landing page / Billing / Sign out | 顺带解决顶栏两个裸控件（一段灰字 + 一个白底 Sign out 按钮）的开发感 | **采用，但列为阶段 2 可选**：要引入 shadcn `dropdown-menu`（`@radix-ui/react-dropdown-menu`）新依赖，和 ADR-016 决策 2「不为 5 个导航项引入重依赖」的克制一脉相承，所以单独决策、不和阶段 1 捆绑。 |
| D4. 应用区加页脚放链接 | — | 应用区现在没有页脚，为一个链接造一个页脚不划算。否决。 |

### E. 真实数据从哪来

| 方案 | 说明 | 结论 |
| --- | --- | --- |
| **E1.（采用）分两阶段** | 阶段 1 只用**已有**端点：`GET /api/reader/documents`（继续阅读）、`GET /api/billing/me`（套餐 / 余额）、`pingExtension()`（扩展状态）；阶段 2 再加 `GET /api/stats/overview` 喂状态条和最近查的词 | 阶段 1 零后端改动，观感问题当天就能验证；阶段 2 的端点顺带能把还是占位的 `/stats` 页喂上真数据，两件事一次投入。 |
| E2. 一次性做完再上 | 一步到位 | 把纯前端的观感修复压在后端排期后面，没必要。否决。 |
| E3. 前端拼现有端点凑统计 | 不动后端也能有数字 | 拼不出来：没有任何列出「我查过的词」的端点（`/api/load-count` 要调用方先给词表，`/api/word/:word` 是单词查询且**会计量**）。硬凑只会凑出错的数字或者误触发计费。否决。 |

### F. `GET /api/stats/overview` 的形状（阶段 2）

| 方案 | 说明 | 结论 |
| --- | --- | --- |
| **F1.（采用）一个聚合端点** | 一次返回 `today` / `vocab` / `recent` 三块 | Home 首屏一次往返；字段少、都来自同一个用户的两张表，聚合成本低。 |
| F2. 拆成三个端点 | 各自独立演进 | 首屏三次往返，且三块数据必然同屏出现，没有独立演进的现实需求。否决。 |
| — | **计量边界** | 这个端点**只读**（`COUNT` / `SELECT ... LIMIT`），不做任何词典查询、不落 `user_dicts`、不碰积分。显式在 ADR-018 的单一计量 seam **之外**，和 ADR-021 的管理端点、ADR-026 的反馈端点同一处理。 |

### G.「连续阅读 N 天」能不能算

| 方案 | 说明 | 结论 |
| --- | --- | --- |
| **G1.（原采用，已被 ADR-028 取代）v1 不做 streak** | 状态条只放能算准的三个数 | 见下条，**当时**没有可信的每日活跃数据源。宁可少一个数，不要一个会说谎的数。**→ ADR-028 的 `daily_stats`（有行即活跃）解开了这个阻塞，streak 移到 v1.1。** |
| G2. 拿 `dictionary_lookup_quota` 当每日活跃日志 | 表里就有 `(user_id, date, count)`，看着现成 | **陷阱**：订阅用户被判定豁免后**根本不进这个表**（`quota.CheckAndIncrementLookup` 在调用前就被跳过），而且 `limit <= 0` 时函数直接返回、一行不写。于是付费用户的 streak 永远是 0、今日查词永远是 0——**给最该被伺候好的用户显示最糟的数据**。否决。 |
| **G3.（→ 已落到 ADR-028）新建每日活跃表** | 每日一行，查词 / 阅读都记 | 方向正确，而且这才是 `/stats` 那三张「Daily / Weekly / Monthly」图表真正需要的底座。带迁移、带回填策略、带时区决策（UTC 还是用户本地？配额表用 UTC，对中国用户意味着「一天」从早上 8 点开始），值得单独一个 ADR——**即 [`adr-028`](adr-028-reading-stats-what-to-measure.md)；其 `daily_stats` 采用用户本地日期，见 028 Options E。** |

---

## Decision

### 1. Home = 状态驱动的个人工作台，两种形态

`/app` 根据「这个用户有没有数据」渲染两套内容。判定依据：阶段 1 用「有没有 Reader 文档」+ 扩展是否安装；阶段 2 改用 `overview.vocab.total > 0`。

**形态一：新用户（无数据）—— 3 步上手引导**

```
Welcome, yue wang!

  ① [✓/○] Add Catseye to Chrome          → chromeWebStoreUrl（brand CTA）
  ② [✓/○] Open any English page and
          turn Catseye on                 → 一句话说明，不可点
  ③ [✓/○] Finish your first article       → 或「没有英文页面？粘一段文字试试」→ /reader

  勾选状态：① 读 useExtensionStatus()，③ 读 articlesRead > 0（阶段 2，ADR-028）
```

新用户的 Home 现在最难看——四张卡说了一堆功能，却没告诉他第一步该干什么。引导清单直接解决这个。

**形态二：老用户（有数据）—— 工作台**

```
┌────────────────────────────────────────────────────────────┐
│ Welcome back, yue wang!                                     │
│ 今日阅读 1,200 词 · 查词 12 次 · 每千词 10 次 · 生词本 348   │ ← 状态条（阶段 2，字段见 ADR-028）
│ ▁▂▅▃▇▄▆  最近 7 天阅读量                                    │ ← sparkline
├───────────────────────────────┬────────────────────────────┤
│ Continue reading              │ Recent words               │
│ ┌───────────────────────────┐ │ [serendipity] [obscure]    │ ← chips，点进 /lookup
│ │ preview 前 80 字…  2h ago │ │ [nuance] [ubiquitous] …    │   （阶段 2）
│ │ preview…           1d ago │ │                            │
│ └───────────────────────────┘ │ ┌────────────────────────┐ │
│ View all →  /reader/history   │ │ Pro · 1,240 credits    │ │ ← 套餐小卡，整块可点
│                               │ │ Manage →       /billing│ │   （阶段 1 就能做）
├───────────────────────────────┴────────────────────────────┤
│ [🔍 Word Lookup]  [✨ Rephrase]  [📖 Reader]                │ ← 紧凑 tile，整块可点
├────────────────────────────────────────────────────────────┤
│ ⓘ Catseye extension connected · v1.4.2                     │ ← 装了：一行灰字
│   （没装时换成一条 brand 底色的 Add to Chrome 提示条）        │
└────────────────────────────────────────────────────────────┘
```

区块优先级（自上而下、信息价值递减）：**状态条 > 继续阅读 > 最近查的词 > 功能入口 > 扩展状态 > 套餐**。注意功能入口被降到第四位——它正是现在占满整屏的那四张卡。

**状态条为什么是「阅读视角」而不是「配额视角」**（本条按 ADR-028 修订）：初稿写的是「今日查词 12 / 50」，即剩余免费额度。但 `dictionary_lookup_quota` 对订阅用户不写行，付费用户会永远看到 `0 / 50`；更根本的是，**剩余额度是计费信息，不是学习信息**——它回答「我还能用多少」，而 Home 状态条该回答「我今天学得怎么样」。所以：

- 状态条 = `今日阅读 N 词 · 查词 M 次 · 每千词 K 次 · 生词本 T`（字段定义见 ADR-028 指标字典），全部对免费 / 付费用户一视同仁。
- **免费额度余量移进套餐小卡**，和 plan、积分余额放在一起——那里才是它的语义归属。ADR-029 之后它对所有用户都算得出来，但**不是每次都值得占位**，显示规则见 Decision 10。
- 状态条右侧挂一条 7 天 `wordsRead` sparkline（ADR-028 的 `overview.sparkline`），这是「成长曲线」在 Home 上的缩略版，完整四条曲线在 `/stats`。

### 2. 卡片整块可点，Home 上不放按钮

所有 tile / 卡片用 `<Link>` 包整块，`hover:border-brand/40 hover:shadow-sm transition-colors`，右上或右侧一个 `ArrowUpRight` / `ChevronRight`。Home 全页**零个实心按钮**，唯一的例外是「没装扩展」时那条提示里的 `Add to Chrome`（brand 实心）——那是新用户唯一真正的主操作，值得独占实心按钮这个层级。

### 3. `Button` 加 `brand` variant，应用区开始用品牌色

`src/components/ui/button.tsx` 的 `variants.variant` 增加一项：

```ts
brand: "bg-brand text-brand-foreground shadow-xs hover:bg-brand/90",
```

用法约定（写进组件注释）：**一屏最多一个 `brand` 实心按钮**，它是这一屏的主操作；次要操作 `outline`，第三级 `ghost`，删除类 `destructive`，`default`（中性近黑）保留给「既不是品牌主张也不是次要」的中性场景。同时修订 ADR-013 决策 4 的「应用区不引用 `--brand`」（理由见 Options C）。

本次只在 Home 落地；`/lookup`、`/rephrase`、`/reader`、`/billing` 的按钮迁移是独立的跟进项，不在本 ADR 范围（见 Out of Scope）。

### 4. 补上回营销站的两个入口

- `app-nav.ts` 的 `NAV_FOOTER` 加一项：`{ label: 'Back to site', href: '/', icon: Globe }`，排在 Billing 之后。
- `AppSidebar` 的 logo `href` 从 `SITE.appPath` 改为 `/`。

两处都是常规站内 `<Link>`，不开新标签页（它是同一个 Next.js 应用的另一半，不是外链）。`isNavItemActive(pathname, '/')` 对 `/app` 会因为 `startsWith('/' + '/')` 不成立而返回 false，`pathname === '/'` 在应用区也不成立，所以**不会误高亮**；但这是靠巧合成立的，实现时要给 `'/'` 加一条显式短路并配一个断言测试。

### 5.（阶段 2，可选）顶栏用户下拉菜单

引入 shadcn `dropdown-menu`，顶栏右侧的「用户名 + Sign out 按钮」合并成一个头像触发的菜单：邮箱 / 用户名（不可点）→ Billing → Landing page → Sign out。这是第三处返回入口，也顺带消掉顶栏那两个裸控件。代价是一个新 radix 依赖，所以和阶段 1 解耦、单独决定。

### 6. 数据分两阶段

**阶段 1（零后端改动）**能做：继续阅读（`listReaderDocuments()`，React Query，`queryKey: ['reader-documents']` 与 `/reader/history` 共享缓存）、套餐 / 余额小卡（`getBillingMe()`）、扩展状态（`useExtensionStatus()`）、全部布局 / 配色 / 可点卡片 / 返回入口 / 新用户引导（引导的第 ③ 步勾选先用「有没有 Reader 文档」近似）。

**阶段 2**加上状态条与最近查的词，需要 Decision 7 的端点。

### 7. `GET /api/stats/overview`（阶段 2）契约 —— **口径以 ADR-028 为准**

指标的定义、采集方式和存储都归 ADR-028；本 ADR 只锁定 Home 首屏需要哪些字段、一次取回：

```jsonc
{
  "today": {                       // 用户本地日期（ADR-028 Options E），不是 UTC
    "wordsRead": 1200,             // 估算值，见 ADR-028 Decision 2/8
    "articlesRead": 2,
    "wordLookups": 12,
    "newWords": 7,
    "wordsMastered": 3
  },
  "week": { /* 同构，本地周一起算 */ },
  "sparkline": [820, 0, 1500, 640, 0, 1200, 300],  // 最近 7 天 wordsRead，缺失补 0
  "vocab":  { "total": 348, "mastered": 96 },
  "recent": [ { "english": "serendipity", "chinese": "机缘巧合", "queryCount": 3 } ]
}
```

实现要点：

- `today` / `week` / `sparkline` 来自 ADR-028 的 `daily_stats`；`vocab` / `recent` 来自 `user_dicts`（当前快照，不走 `daily_stats`）。
- `recent` = `user_dicts WHERE user_id = ? ORDER BY updated_at DESC LIMIT 8` join `words`。**注意 `updated_at` 的真实语义**：`repo.UpsertUserDict` 在查词**和**标记「已认识」两条路径上都会 bump 它，所以严格说这是「最近有交互的词」而不是「最近查的词」。UI 文案用 **Recent words** 而不是 "Recently looked up"，避免声明一件不完全成立的事。
- **`overview` 里不再有任何配额字段**。剩余免费额度走 `GET /api/billing/me`，显示在套餐小卡里（见 Decision 10）。
- `vocab` 两条计数走 `COUNT(*)`，`user_dicts` 已有 `(user_id, word_id)` 主键；若首页出现慢查询再考虑 `(user_id, updated_at)` 索引，不预先加。
- 端点注册在 `apiGroup`（`clerkAuth`）下，**不进** `authGroup` 的查词路径，注释里写明它在 ADR-018 计量 seam 之外。
- 返回**空数据而非 404**：新用户拿到全 0 / `recent: []`，Home 据此走引导形态。
- `sparkline` 必须**补齐 7 个点**，没数据的那天是 `0` 而不是跳过——否则折线会把「没读」画成「连续读」。

### 8. streak 与「阅读量是估算值」的显示

- **streak 不在 v1**，但理由已经从「算不出来」变成「排期」：ADR-028 的 `daily_stats` 有行即活跃，v1.1 直接可算。（原 Options G1 的阻塞已解除。）
- **阅读量是推断值**，Home 上按 ADR-028 Decision 8 处理：显示概数（`1,200` 而不是 `1,237`），旁边一个 `ⓘ` 说明「按你查词和滚动到的位置估算」。Home 状态条不得把估算值渲染成看起来精确的数字。

### 9. `/stats` 页不在本次范围

Reading Stats 仍是占位。它的完整设计（四条曲线、日 / 周 / 月 / 年切换）在 ADR-028 Decision 7；本 ADR 只保证 Home 状态条点得进去。

### 10. 套餐小卡显示什么（用户 2026-09-16 确认）

- **Subscription plan**（`billing.subscription.plan` / `status`，ADR-009）。
- **积分余额**：ADR-009 的余额是**两个池**——`credits.subscriptionBalance`（订阅赠送）+ `credits.topupBalance`（充值）。卡上**主显示两者合计**（用户只关心「我还能用多少」），次行或 hover 再拆开。**不能只显示合计**：两个池的过期规则不同，订阅池到期清零时余额会突然变少，不拆开会让用户以为被吞了积分。
- **免费查词额度余量**放在这张卡里（从状态条移过来，见 Decision 1）。**按 ADR-029 Decision 8 状态驱动显示**——配额本身「不是开关、是档位」，它的展示也该是连续的而不是有/无：

  | 用量 | 状态条 | 套餐卡 |
  | --- | --- | --- |
  | 未启用拦截（两档都是 0） | 不显示 | **不显示**——没有上限就没有「剩余」可言 |
  | < 70% | 不显示 | 一行细节 |
  | ≥ 70% | 一行额度提醒（免费用户带升级入口） | 高亮 |
  | ≥ 100% | 显著提示 + 升级入口 | 高亮 |

  订阅用户撞到自己那档上限时**不给「去升级」文案**——对他们来说撞墙意味着账号异常，不是该掏钱（ADR-029 Decision 5）。
- 整卡可点 → `/billing`，不放按钮（Decision 2）。

### 11. 本 ADR 范围内的品牌改名（Catglish）

用户 2026-09-16 确认：对外正式名是 **Catglish**，**只有这一个英文名，没有中文名**；UI 上用户可见的 `ENX` / `Catseye` 全部替换。这不是本 ADR 的新决策——命名早在 2026-09-12 就定了（`adr-010` 已 Superseded，决策记录在 `starlabrys/ops` 的 `ADR-0004`，`catglish.com` 已注册），本 ADR 只是**顺带执行它落在自己范围内的那部分**，因为这些文件本来就要重写，改名是零边际成本。

**边界（用户明确）：`ENX` 是本项目的开发代号，继续保留。** 后端代码、非 UI 代码、内部标识符、日志前缀、代码注释**一律不动**——不为改产品名去动不需要动的代码。本 ADR 只改下面这几处**用户看得见**的字符串：

- `src/lib/site.ts` 的 `SITE.name`（侧边栏 logo 和顶栏都读它）
- `src/components/app/app-nav.ts` 的 `navTitleForPath` 兜底值
- `src/app/(app)/app/page.tsx` 重写时直接用新名
- 套餐小卡（Decision 10）里的 `enx Pro` → `Catglish Pro`

**顺带的一处删除**：`src/app/globals.css` 里 `--brand` 的注释把配色讲成「猫眼星云 cat's eye nebula」——**整段删掉，不保留任何猫眼表述**（商标冲突风险）。但同一段注释的**另一半理由必须留下**：hue 200 是为避开同类产品扎堆的 239–270 才选的，这条与产品名无关、继续成立。`enx-chrome/src/index.css` 里镜像的同一段一并改。（`adr-013` 已加修订注记。）

**范围外、但必须一起排期的**：`enx-chrome` 的 manifest / popup / 侧边栏、`enx-api` 的 429 与订阅提示文案、Stripe 产品名与描述、Chrome Web Store 条目——完整的逐文件清单在 `LAUNCH-CHECKLIST` §7.4，其中列了一组**长得像品牌名、实际是线上契约、改了会静默弄坏功能**的标识符（`data-enx-extension`、`enx-hl-*`、Stripe `lookup_key` 等），动手前先读那张表。

**Git 仓库改名不在本次范围**（用户明确以后再说）；README 已加一段命名说明，讲清 `ENX` = 开发代号、`Catglish` = 产品名、无中文名。

### 12. 测试

- `components/app/__tests__/AppSidebar.test.tsx` 现有的导航标签断言要加 `Back to site`；补一条「`/app` 下 `Back to site` 不是 `aria-current="page"`」的断言（守住 Decision 4 那个「靠巧合成立」的高亮行为）。
- 新增 `app/(app)/app/__tests__/page.test.tsx`：无数据 → 渲染 3 步引导；有数据 → 渲染状态条；卡片是 `<a href>` 而不是 `<button>`；`getBillingMe` 失败时套餐小卡静默隐藏、不炸整页；`overview` 失败时**既不渲染状态条也不渲染引导**（此时并不知道这个用户是不是新用户，猜错哪一边都比留白更糟）。
- 阶段 2 补 `overview` 的 handler 测试：新用户全零不 500；`sparkline` 恒为 7 个点。
- 改名后补一条断言：应用区渲染出的可见文案里不再出现 `Catseye` / `ENX`（`AppSidebar.test.tsx` 加一条 `queryByText(/Catseye|ENX/)` 为 null 即可），防止后续回归。

---

## Rationale

- **A1 而非 A2**：用户的措辞是「像在开发状态」，不是「颜色不好看」。一屏重复侧边栏内容、不含任何用户自己的数据，无论怎么调样式都会保持那个观感。把 Home 换成「我的状态」是唯一能真正改掉这个印象的改法，而且它顺带给扩展引导、配额提醒、余额提醒找到了家。
- **B1 而非 B2/B3**：黑按钮是症状。整卡可点一次性解决三件事——消掉黑块、恢复视觉层级、扩大点击热区——而只改按钮颜色一件都没解决。
- **C1 而非 C2/C3**：`brand` variant 是增量的、显式的、可逐页迁移的；重定义 `--primary` 是隐式的、一次性波及全部现有和未来组件的。在一个还没上线、shadcn 组件还会继续引入的项目里，选可回退的那个。
- **推翻 ADR-013 而不是绕过它**：ADR-013 那条「应用区不引用 `--brand`」是施工期隔离，写它的时候营销区还没定稿。现在 `--brand` 定稿了、enx-chrome 也用上了同一个 teal，隔离反而制造了不一致。这种情况该**显式修订**并留下理由，而不是实现时悄悄破例。
- **D1 + D2 一起做**：两者互补——logo 符合直觉但不显眼（用户不会先去点 logo 试试），文字入口显眼但要扫一眼侧边栏。同时做，两类用户都能找到。顺带消除 logo 和 Home 项指向同一地址的浪费。
- **E1 分两阶段**：观感问题是用户**现在**在抱怨的，不该被后端排期挡住。阶段 1 纯前端，落地后 Home 已经有真实的「继续阅读 + 套餐 + 扩展状态」，不是空壳。
- **G1 不做 streak（已由 ADR-028 解除）**：streak 是留存类产品最有效的小机制之一，很诱人。但用 `dictionary_lookup_quota` 实现会让付费用户永远看到 0——比没有这个数字糟得多。ADR-028 的 `daily_stats` 给了一个口径正确的活跃表，streak 因此从「不做」变成「v1.1 做」。
- **状态条用阅读视角而非配额视角**：剩余额度回答的是「我还能用多少」，属于计费；Home 状态条要回答「我今天学得怎么样」。把两者混在一行，既让付费用户看到一个恒为 0 的数，也让学习指标被计费指标挤掉了位置。

---

## Consequences

### Positive

- Home 每天呈现不同的、属于用户自己的内容，「开发状态」的观感从根上消失。
- 应用区与营销站、与 enx-chrome 侧边栏共用同一个品牌青蓝，三个界面视觉连贯。
- 应用区 ↔ 营销站双向可达，补上 ADR-016 删掉旧「返回首页」链之后留下的缺口。
- 新用户第一次进 `/app` 看到的是「下一步做什么」，而不是一份功能清单——对装完扩展还不知道怎么用的人是实打实的转化改善。
- 阶段 2 的 `overview` 端点是 `/stats` 从占位变成真页面的第一块砖。
- Home 是产品截图里出现频率最高的一屏（LAUNCH-CHECKLIST §7.2），先改再出物料，省一轮返工。

### Negative

- 改动集中在 ADR-016 刚定型不久的 shell 与概览页，`AppSidebar.test.tsx` 等既有测试要跟着改。
- `brand` variant 引入「什么时候用哪个 variant」的判断，不同页面可能不一致，直到全部迁移完为止应用区会有一段黑白 / 青蓝混搭的过渡期。
- Home 从一个静态常量数组变成要跑 2–3 个查询的页面：多了加载态、空态、失败态三种分支，代码量和维护面都上来了。
- 阶段 2 的 `overview` 是又一个「多个页面都会依赖的聚合端点」，以后往里加字段的压力会持续存在。

### Mitigation

- **过渡期混搭**：把「一屏最多一个 brand 实心按钮」写进 `button.tsx` 的注释，并把其余页面的按钮迁移单列成一条跟进项（不是散落的 TODO）。
- **加载态**：状态条和卡片用固定高度的骨架块占位，避免数据到达时布局跳动（首屏 CLS）。
- **失败态**：每个区块**各自**降级——`getBillingMe()` 挂了就隐藏套餐小卡，`listReaderDocuments()` 挂了「继续阅读」显示一行「Couldn't load」，任一个都不得炸掉整页。Home 是登录后的第一屏，它必须永远能渲染出来。
- **聚合端点膨胀**：`overview` 只服务 Home 首屏，字段增删以「Home 首屏是否要用」为唯一准入标准；`/stats` 的图表数据走它自己的端点，不往 `overview` 里塞。

---

## 实施顺序（任务拆解）

**阶段 1 —— 纯前端，不动 enx-api**（建议先做，可独立验证）

1. `button.tsx` 加 `brand` variant + 用法注释。
2. `app-nav.ts` 加 `Back to site`；`AppSidebar` logo 改指 `/`；`isNavItemActive` 给 `'/'` 加显式短路。
3. 新建 `src/components/app/home/`：`StatStrip`（阶段 1 先渲染骨架 / 隐藏）、`ContinueReading`、`QuickTiles`、`ExtensionBanner`、`PlanCard`、`OnboardingChecklist`。
4. 重写 `app/(app)/app/page.tsx`：按「有无数据」二选一渲染，各区块独立降级。
5. 更新 `AppSidebar.test.tsx`，新增 `app/(app)/app/__tests__/page.test.tsx`。
6. `pnpm test` + `pnpm build`（注意：enx-ui 要 Node 18+，用 `fnm exec --using=24`）。

**阶段 2 —— 加真实统计**

7. **前置：ADR-028 的 v1（`daily_stats` 表 + `POST /api/stats/ingest` + 扩展侧埋点）先落地**，否则状态条没有数据源。
8. enx-api：`stats/overview.go`（聚合 `daily_stats` 的 today / week / sparkline + `user_dicts` 的 vocab / recent）；`enx-api.go` 注册 `GET /api/stats/overview`；handler 测试。
9. enx-ui：`types/index.ts` 加 `StatsOverviewData`；`services/api.ts` 加 `getStatsOverview()`；`StatStrip`（含 sparkline）/ `RecentWords` 接真数据；引导清单第 ③ 步改读 `today.articlesRead` / 累计 `articlesRead`。
10. `task deploy:homelab`（GitOps：改 w10n-config 要 commit + push，不能 kubectl apply）。

**阶段 3 —— 可选**

11. 顶栏用户下拉菜单（引入 `dropdown-menu`）。
12. `/lookup`、`/rephrase`、`/reader`、`/billing` 的主按钮迁到 `brand` variant。
13. streak 回到状态条（依赖 ADR-028 v1.1）。

---

## Out of Scope（本次不做）

- `/stats` 的真实图表与图表库选型、统计数据的采集与存储、streak —— **全部归 [`adr-028`](adr-028-reading-stats-what-to-measure.md)**。本 ADR 只负责 Home 上呈现它们的那一条状态条和 sparkline。
- 应用区其余页面的按钮配色迁移（阶段 3，可独立推进）。
- 应用区暗色模式 / 主题切换（`next-themes`）——token 齐备但 ADR-013 已明确延后。
- `/billing` 页残留的中文正文清理（ADR-016 决策 3 就列为独立清理项，至今未做）。
- 新用户引导的「完成度百分比 / 奖励」等游戏化元素。
- Home 的个性化推荐（「今天该复习这 10 个词」）——依赖复习算法，那是另一条线。

---

## Revisit Trigger

- 工作台上线后，如果老用户在 Home 的停留时间稳定低于 2 秒且总是直奔同一个功能 → 重新评估 Options A3（登录后直接落到上次所在的分区）。
- 一旦 ADR-028 的 `daily_stats` 落地 → 回来加 streak（v1.1）。
- 一旦 ADR-028 的 L2/L3 埋点落地 → 评估状态条是否该加一个「升级率」指标，还是该让它留在 `/stats`（Home 状态条最多 4 个数，加一个就要挤掉一个）。
- 一旦 Home 需要第 4 个数据源 → 重新评估「一个聚合端点」是否还成立（F1 vs F2）。
- 一旦应用区引入第二个需要品牌色的复杂组件（如带品牌强调的表格 / 图表）→ 重新评估 C2（作用域内重定义 `--primary`）是否比一路加 variant 更省。

---

## 阶段 2 落地与对 Decision 1 的修订（2026-09-17）

**用户原话概括**：「Continue reading 从 Home 拿掉，我不认为这是一个主要的功能；Home 我更希望显示一些统计信息。」

### 改了什么

- `src/components/app/home/ContinueReading.tsx` **已删除**（不是隐藏）。`/reader` 页自己有两个 `/reader/history` 入口，删掉它不切断任何路径。
- 新增 `src/components/app/home/StatStrip.tsx`：今日阅读词数 / 今日查词 / 本周阅读词数 / 生词本规模，加一条 7 天 sparkline，整块链到 `/stats`。数据来自 `GET /api/stats/overview`（ADR-028）。
- `app/(app)/app/page.tsx` 的「有没有数据」判定从**「有没有 Reader 文档」改成 `overview.vocab.total > 0`**，正如 Decision 1 原本就写的阶段 2 计划。这个改动顺带修掉一个口径问题：原判定说的是「用过 `/reader` 这一条路径」，而生词本任何一条路径查词都会长，说的才是「用过 Catglish」。
- Decision 1 版式里的「最近查的词」这一格**没做**。`overview.recent` 已经在返回里，但 Home 加满四块之后它挤掉的是状态条的呼吸空间；留到有人真的想要再说。

### 为什么这一条值得记

「继续阅读」在阶段 1 是**因为当时只有这个端点**才放上 Home 的（Options E1 写得很直白：阶段 1 只用已有端点）。一个为了「先有东西可显示」而占住首屏的区块，很容易在数据源到位之后被当成既定设计留下来。它回答的是「你想重新打开哪份文档」——而 `/reader` 已经回答得更好——并且让粘贴文本阅读器（几个入口之一，且不是主场景）在首屏上看起来像是产品本身。

`/stats` 同一轮从「日 / 周 / 月 / 年三张静态卡片」改成一张图 + 切换，见 ADR-028 的「对 `/stats` 形态的修订」。
