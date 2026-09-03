# ADR-013：把 enx-ui 扩成 Catseye 官网——新增免登录营销区（route group 分层 + 静态渲染），v1 只做首页（Hero + 演示视频占位 + 核心功能 + 工作原理 + 竞品对照 + 安装 + 结尾 CTA + 页脚），英文单语

| 字段 | 值 |
| --- | --- |
| **状态** | Proposed — 2026-09-02。设计决策已与用户收敛（品牌名 = Catseye、v1 = 精简首页、结构 = route group 分层 + 静态渲染）；实现走 TDD，本 ADR 的 Decision + 内容清单直接作为实现依据，不另写 TASK-SPEC（同 ADR-008 / 010 / 011 / 012 的做法）。 |
| **日期** | 2026-09-02 |
| **关联 ADR** | [`adr-010-product-naming-catseye.md`](adr-010-product-naming-catseye.md)（正式产品名 **猫眼翻译 / Catseye**；本 ADR 让官网正式启用 `Catseye` 作为对外品牌名，`ENX` / `enx` 收敛为代码内部代号）、[`adr-004-no-aws-amplify-hand-rolled-cognito.md`](adr-004-no-aws-amplify-hand-rolled-cognito.md)（现有 Cognito 客户端鉴权；营销区必须在鉴权边界**之外**）、[`adr-012-enx-ui-idiomatic-rephrasing.md`](adr-012-enx-ui-idiomatic-rephrasing.md)（enx-ui 现有页面形态：`'use client'` + shadcn 卡片 + React Query；营销区反过来是 Server Component + 静态渲染，两套并存） |
| **关联配置** | `w10n-config/enx/market-research.md`（竞品分析）、`w10n-config/enx/monetization.md`（定价——v1 官网不含 `/pricing`，留到后续） |
| **参考站点** | [relingo.net](https://relingo.net)（信息架构与视觉基调的主参考）、[immersivetranslate.com](https://immersivetranslate.com)（同赛道、免登录页面的范围参考） |

---

## 已确认的决策（2026-09-02，用户确认）

1. **enx-ui 同时作为 Catseye 官网**：在同一个 Next.js 应用里划出「营销区」（免登录）和「应用区」（现有的登录后功能），不新建独立仓库 / 独立部署。
2. **对外品牌名 = `Catseye`**：官网标题、logo、文案统一用 `Catseye`。`ENX` / `enx` 仅作代码与内部文档的代号（`CONTEXT.md`、`enx-api`、`enx-chrome` 等仓库名不改）。
3. **英文单语**：不做 i18n、不加语言切换器（`relingo` 有语言切换，本站**不抄这一条**）。`<html lang="en">`（已是现状）。UI 文案全英文，符合 `.ai/instructions.md`。
4. **v1 范围 = 精简首页**：单页 `/`，从上到下：站点顶栏 → Hero → **演示视频占位** → 核心功能 → 工作原理（3 步）→ 安装 → 结尾 CTA → 页脚。**不做** `/features` 独立页、`/pricing`、`/docs`、`/changelog`、FAQ、隐私条款页——这些留到后续 ADR / 迭代。
5. **结构 = route group 分层 + 静态渲染**：`(marketing)` route group 走 SSG（`force-static`），`(app)` route group 保留现有客户端鉴权行为。同一套 `enx-ui` 构建与部署。
6. **演示视频这一版只放占位**：预留一个 16:9 容器 + 海报图 + 播放控件；视频文件（或托管链接）后补，通过一个常量开关接入，不阻塞官网上线。
7. **首页加一个竞品对照表**：一张紧凑的能力矩阵，Catseye vs 3–4 个面向英文站受众的同类工具（Immersive Translate / Readlang / LingQ / Language Reactor）。只放**客观、可公开核实**的功能事实（打勾 / 部分 / 无），不搬 `w10n-config/enx/market-research.md` 里的战略判断、结构性劣势、财务与增长策略（那份文档明确只放私有仓库）。

---

## Context

### enx-ui 现状

- **单一入口**：`src/app/page.tsx` 直接渲染 `<AuthWrapper />`——未登录显示 `LoginForm`，登录后显示功能卡片 dashboard（Word Lookup / Idiomatic Phrasing / 订阅与积分 / Hello World）。**根路径 `/` 就是应用入口**，没有任何免登录的介绍性内容。
- **登录后跳转目标是 `/`**：`src/hooks/useAuth.ts:92`、`src/app/auth/callback/page.tsx:34` 都把用户送回 `/`。
- **技术栈**：Next 15.4（App Router，Turbopack）、React 19、Tailwind v4、shadcn 风格 UI（`src/components/ui/`）、`@tanstack/react-query`、`jotai`、字体 `Geist` / `Geist_Mono`（`next/font`）。
- **设计 token**：`src/app/globals.css` 已有整套 shadcn 语义 token（`--background` / `--primary` / `--muted` / `--card` …，中性灰色板，`--radius: 0.625rem`），并有 `.dark` 变体的完整重定义，但**没有** `next-themes` / 主题切换器接线。
- **构建**：`next.config.ts` 用 `output: "standalone"`。**没有** enx-ui 专属的 `Taskfile` / `Dockerfile` / 部署 workflow——部署方式未在仓库里固化（`.github/workflows/` 下只有 `deploy-enx-api.yml`）。
- **API 基址**：`src/services/api.ts` 用 `NEXT_PUBLIC_API_BASE_URL`，默认 `https://enx-api.wiloon.lab`。
- **测试**：Jest（jsdom）+ RTL 单测，Playwright E2E。`.ai/instructions.md` 规定任何功能性改动**必须**配自动化测试。

### 为什么做官网

产品（`enx-chrome` 扩展 + `enx-api` 后端 + `enx-ui`）准备上线（见 ADR-010 命名、ADR-009 计费）。一个能被访客在**不安装、不注册**的前提下看懂「这是什么、怎么用、怎么装」的公开站点，是上线的前置条件。同类独立工具（沉浸式翻译、Relingo、Trancy、Readlang）都有这样一层：Hero 讲价值 → 演示视频/动图 → 功能分块 → 安装引导 → 文档中心。enx-ui 已经是 Next.js 应用，加一层营销页比另起一个站省事，且能共用设计 token、字体、组件、部署管线。

### 为什么值得写 ADR

- **难以反悔**：`/` 的语义要从「应用入口」改成「营销首页」，牵动登录跳转、E2E 期望、书签；route group 分层一旦定下，后续所有页面（功能页、文档、定价）都按这个骨架长。
- **反直觉**：现在 `enx-ui` 全部页面都是 `'use client'` + 运行时鉴权；营销区反过来要 Server Component + 静态渲染 + 免鉴权，两种范式在同一个 `src/app/` 下并存，后来者需要知道边界在哪。
- **真实取舍**：营销区放哪（route group / 子项目 / 独立站生成器）、`/` 对已登录用户怎么处理（智能重定向 vs 永远静态）、演示视频怎么承载、品牌名对外用哪个，都有多个合理选项、各有代价。

---

## Options Considered

### A. 营销区放在哪

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| A1.（采用）同 `enx-ui` 内新增 `(marketing)` route group | `src/app/(marketing)/` 放营销页，`src/app/(app)/` 放现有登录后功能 | 共用设计 token / 字体 / shadcn 组件 / 构建 / 部署；一个仓库一次发布；营销页能直接 `<Link>` 到应用页 | `src/app/` 下并存「静态免鉴权」和「客户端鉴权」两种范式，边界要靠约定和文档维持 |
| A2. 新建独立子项目 `enx-www` | 独立 Next.js / Astro 仓库 | 彻底隔离，营销站可用更轻的框架 | 设计 token / 组件 / 部署管线要再搭一套；跨仓库改动；monorepo 多一个成员 |
| A3. 用独立站生成器（Framer / 无头 CMS / 纯静态 HTML） | 非代码方式维护 | 非工程同学也能改文案 | 脱离仓库和 code review；与产品视觉体系割裂；截图 / 组件复用不了 |

### B. `/` 对已登录用户怎么处理

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| B1. 智能 `/`：匿名看营销页，已登录重定向到应用 | `/` 里读鉴权态再决定渲染/跳转 | 老用户输 `/` 直接进应用，习惯不变 | `/` 不能纯静态（要么客户端闪一下再跳，要么 middleware 读 token——但 token 在 localStorage，middleware 读不到）；破坏「首页永远可缓存」 |
| B2.（采用）`/` 永远是静态营销首页；应用入口移到 `/app` | `/` 静态；顶栏放「Open App / Sign in」按钮指向 `/app`；登录跳转、auth callback 改到 `/app` | `/` 纯静态、可 CDN 缓存；营销页和应用页彻底解耦；符合 relingo / immersivetranslate 的模式（首页永远是营销页） | 老用户书签 `/` 会落到营销页，需多点一下「Open App」；要改两处跳转目标 + E2E |

### C. 渲染方式

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| C1.（采用）营销区 Server Component + `force-static` | `(marketing)` 全部静态预渲染；顶栏的「已登录/未登录」链接做成一个小 client island | 首屏快、可缓存、SEO 友好；不拉 React Query / 鉴权 JS | 顶栏鉴权态要单独隔离成客户端组件 |
| C2. 营销区也 `'use client'` | 跟现有页面一致 | 范式统一 | 静态营销内容白白进客户端 bundle；SEO / 首屏不如 SSG |
| C3. SSR（每次请求渲染） | `dynamic` | 能按请求定制 | 营销首页没有按请求定制的需求；平白增加服务端负载 |

### D. 演示视频怎么承载

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| D1.（采用 v1）占位：16:9 容器 + 海报图 + 播放控件，视频源是一个常量，未配置就只显示海报 | `DemoVideo` 组件读 `DEMO_VIDEO_URL` 常量；空 → 渲染海报图（产品截图）+ 「Demo coming soon」；非空 → `<video controls preload="none" poster>` 或（YouTube 链接时）点击加载的 facade iframe | 官网不被视频制作阻塞；上线后填一个常量即可接入；`preload="none"` 不拖首屏 | 上线首日没有视频，只有截图 |
| D2. 上线前必须先做好视频 | 先录屏再上线 | 首日就有完整演示 | 视频制作周期不确定，阻塞整个官网上线 |
| D3. 直接嵌 YouTube iframe（页面加载即加载） | 标准 `<iframe>` | 简单 | 每次访问都拉 YouTube 的一堆 JS / cookie，拖慢首屏、有隐私顾虑；国内访问不稳 |

### E. 品牌名对外用哪个

| 方案 | 说明 | 结论 |
| --- | --- | --- |
| `Catseye` | ADR-010 定的正式名 | **采用**。官网标题 / logo / 文案统一 `Catseye`。 |
| `ENX` | 现有代码 / 文档代号 | 仅作内部代号保留，不对外。 |
| 占位待定 | 用变量，之后再定 | 否决——ADR-010 已定，没有再拖的理由；商标 / 域名 follow-up 属 ADR-010 的 Open Follow-ups，不阻塞官网文案。 |

### F. 文档站（安装手册 / 使用文档）

| 方案 | 说明 | 结论 |
| --- | --- | --- |
| 现在就并入 Nextra `/docs` | 与 Next.js 同栈，可进同一个 `enx-ui` | v1 **不做**。v1 的「安装」是首页里一段带截图的引导；完整 `/docs` 留到后续 ADR，届时评估 Nextra vs 独立站。 |

### G. 暗色模式

| 方案 | 说明 | 结论 |
| --- | --- | --- |
| 营销区加主题切换器 | 接 `next-themes` | v1 **不做**。营销区固定浅色（参考 relingo，浅色单一）。但**必须用语义 token 写**，让 `.dark` 生效时不视觉崩坏，为后续留口子。 |

### H. 竞品对照怎么放

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| H1.（采用）首页内嵌一张紧凑能力矩阵 | 行 = 能力点，列 = Catseye + 3–4 个同类工具，格子用 ✅ / ~ / —；Catseye 列高亮；表上/下一句话点出「同时做到这几点的只有 Catseye」 | 访客一眼看清定位差异；数据来自 market-research §4.2，事实性强、易维护 | 把竞争定位公开了（可接受——对照表是常规营销手段）；竞品功能会变，表要偶尔校 |
| H2. 独立 `/compare` 或 `/vs/<competitor>` 页 | 每个竞品一页详细对比 | SEO（「catseye vs X」长尾） | v1 是精简首页，多页对比是后续工作；也更容易显得挑衅 |
| H3. 不放 | —— | 最稳妥、不树敌 | 用户明确要求放；且不放就少了一个把「学习导向 vs 翻译导向」讲清楚的有力位置 |

**公开边界**：`w10n-config/enx/market-research.md` 第 11 行明确「竞品判断、定价、财务推算、增长策略**不放公开的 `enx` 仓库**」。首页对照表只取 §4.2 的**功能事实矩阵**，不取 §4.3「独特交叉点」的论证口吻、§4.4「结构性劣势」、§7 的市场规模 / LTV / 定价。措辞中立，不贬低竞品（不写「competitor X doesn't let you actually read」这类话）。

---

## Decision

### 1. 路由结构（采用 A1 + B2）

```
src/app/
  layout.tsx                      # 根布局：<html lang="en">、字体、QueryProvider —— 不改
  globals.css                     # 加一组营销区专用 token（见 Decision 4）—— 增量

  (marketing)/
    layout.tsx                    # 站点顶栏 + 页脚；export const dynamic = 'force-static'
    page.tsx                      # "/" —— Catseye 落地页（Server Component）
    robots.ts                     # (可放这层，也可放 app 根) —— 允许抓取
    sitemap.ts                    # 列出 "/"（后续页面加进来）

  (app)/
    layout.tsx                    # 薄层，保持现有行为（不引入新逻辑）
    app/page.tsx                  # "/app" —— 现在 page.tsx 里的 <AuthWrapper />（整体搬过来）
    lookup/…                      # 不动
    rephrase/…                    # 不动（ADR-012）
    billing/…                     # 不动

  auth/…  verify-email/…  forgot-password/…  reset-password/…   # 不动
```

- **删除** `src/app/page.tsx` 现有内容（`<AuthWrapper />`），其职责搬到 `src/app/(app)/app/page.tsx`（路由 `/app`）。route group `()` 不进 URL，所以营销页在 `/`、应用 dashboard 在 `/app`。
- **跳转目标改动**（只有两处）：
  - `src/hooks/useAuth.ts:92` `router.push('/')` → `router.push('/app')`
  - `src/app/auth/callback/page.tsx:34` `router.replace('/')` → `router.replace('/app')`
  - `logoutMutation` 登出后可继续回 `/`（营销首页，语义正确）。
- `(app)/layout.tsx` 仅作分组，不放鉴权逻辑——鉴权仍在各页面的 `AuthWrapper` / hook 里（不在本 ADR 范围内动它）。

### 2. `(marketing)/layout.tsx`

- `export const dynamic = 'force-static'`（显式声明静态）。
- 结构：`<SiteHeader />` + `{children}` + `<SiteFooter />`。
- 不包 `QueryProvider` 之外的东西（根布局已经包了 `QueryProvider`，营销页不用它，但保留无害）。
- 固定浅色：容器上不加 `.dark`；配色全走语义 token。

### 3. 首页 section 清单（采用 D 的 v1 = D1；顺序参考 relingo）

`src/app/(marketing)/page.tsx` 组合以下组件（都在 `src/components/site/`）：

| # | 组件 | 内容 | 备注 |
| --- | --- | --- | --- |
| — | `SiteHeader` | 左：`Catseye` 字标 + logo。中/右：锚点导航 `Features` `How it works` `Install`（v1 是同页锚点，不是独立路由）。最右：`<HeaderAuthLinks />`（client island）+ 主 CTA `Add to Chrome`。 | 见 Decision 5 |
| 1 | `Hero` | H1 一句话价值主张 + 副标题 + 双 CTA（`Add to Chrome` 主、`See how it works` 次锚点）+ 产品截图。 | 文案见「内容清单」 |
| 2 | `DemoVideo` | **预留位**。居中 16:9（`aspect-video`）容器，海报图 + 播放按钮。读 `DEMO_VIDEO_URL`：空→海报 + `Demo coming soon` 字样；非空→`<video controls preload="none" poster>`，YouTube 链接则渲染点击加载的 facade。 | 见 Decision 6 |
| 3 | `FeatureSection` ×N | 核心功能，左右图文交替。v1 覆盖：**Word highlight while you read** / **Click any word for its meaning** / **Select a sentence to translate it** / **Idiomatic phrasing**（对应 CONTEXT.md 术语：单词高亮 / 点击查词 / 划词整句翻译 / 地道表达）。每块：小标题 + 1–2 句说明 + 截图或 GIF（`alt` 必填）。 | 术语用 CONTEXT.md 的英文侧 |
| 4 | `HowItWorks` | 3 步：`1. Add the extension` → `2. Turn on learning mode on any English page` → `3. Read — new words get underlined, click to look up, select to translate`。每步一句 + 小图标（`lucide-react`）。 | |
| 5 | `Comparison` | 竞品对照能力矩阵（见下方「竞品对照」小节）。 | 采用 H1 |
| 6 | `InstallCTA` | `Add to Chrome` 大按钮（Chrome Web Store 链接）。Edge / Firefox 暂标 `Coming soon` 或隐藏（用常量控制）。 | |
| 7 | `CtaBanner` | 结尾再来一次 `Add to Chrome` + 一句话。 | |

**竞品对照（`Comparison`，采用 H1）**

- Server Component，纯静态。数据是组件内的一个常量数组（`rows: { label, catseye, competitors[] }`），不外部请求。
- 列：`Catseye`（高亮）+ `Immersive Translate` + `Readlang` + `LingQ` + `Language Reactor`。
- 格子取值 `'yes' | 'partial' | 'no'`，渲染为 ✅ / ~ / —（配 `aria-label`，不只靠符号/颜色传意）。
- 表上一句引导语、表下一句收束（措辞见「内容清单」），**中立**，不出现贬低竞品的句子。
- 窄屏：表格外层 `overflow-x-auto`（横向滚动），不让页面body横向滚。
- 表下加一行小字免责：`Comparison based on publicly available information as of <month year>. Features change — corrections welcome.`
- 数据来源标注在组件注释里：`// Source: w10n-config/enx/market-research.md §4.2 (facts only)`。
| — | `SiteFooter` | 列：Product（Add to Chrome / Open App）、Resources（GitHub、后续 Docs/Changelog 占位可先不放）、Legal（Privacy 后续）。版权行 `© <year> Catseye`。 | 只放已存在的链接，不放死链 |

### 4. 视觉 token（globals.css 增量，采用 G）

- 复用现有 shadcn 中性 token（背景 / 前景 / card / muted / border / radius / 字体）——营销区和应用区视觉同源。
- **新增一个品牌强调色**，只用于营销区的 CTA 高亮、链接、图标点缀，呼应「猫眼星云」的青蓝意象：

  ```css
  :root {
    --brand: oklch(0.55 0.13 230);            /* 青蓝，暂定；实现阶段微调 */
    --brand-foreground: oklch(0.985 0 0);
  }
  .dark {
    --brand: oklch(0.7 0.12 230);
    --brand-foreground: oklch(0.205 0 0);
  }
  ```

  并在 `@theme inline` 里加 `--color-brand` / `--color-brand-foreground` 映射，使 `bg-brand` / `text-brand` 可用。
- 应用区（`(app)`）**不引用** `--brand`，行为零变化。
- 排版基调：大量留白、克制、浅色（对标 relingo）。字体沿用 `Geist`。

### 5. 顶栏鉴权态（采用 C1）

- `SiteHeader` 本身是 Server Component（静态）。
- 只有 `<HeaderAuthLinks />` 是 `'use client'`：读现有鉴权 hook / store，
  - 未登录 → `Sign in`（→ `/app`，`AuthWrapper` 会显示 `LoginForm`）
  - 已登录 → `Open App`（→ `/app`）
  - 首屏未 hydrate 时渲染一个中性占位（如 `Open App`，或骨架），避免 CLS。
- `Add to Chrome` 按钮对所有人一样，属静态部分。

### 6. `DemoVideo` 组件契约

```ts
// src/lib/site.ts
export const SITE = {
  name: 'Catseye',
  tagline: '...',                       // 见内容清单
  chromeWebStoreUrl: 'https://chromewebstore.google.com/detail/<id>',  // 待填真实 id
  edgeAddonUrl: '',                     // 空 = 显示 Coming soon
  firefoxAddonUrl: '',
  githubUrl: 'https://github.com/<org>/<repo>',
  demoVideoUrl: '',                     // 空 = 只显示海报
  demoPoster: '/marketing/demo-poster.png',
}
```

- `demoVideoUrl` 空：渲染 `<div class="aspect-video">` + `demoPoster` 背景 + 居中 `Demo coming soon` 徽标。
- 非空且是 `.mp4` / `.webm`：`<video class="aspect-video w-full" controls preload="none" poster={demoPoster}>`。
- 非空且是 YouTube / Vimeo 链接：渲染海报 + 播放按钮的 facade，点击后才替换成 `<iframe>`（不在首屏加载第三方脚本）。

### 7. SEO / metadata

- `(marketing)/page.tsx` `export const metadata`：`title: 'Catseye — AI-assisted English reading in your browser'`（措辞实现阶段定稿）、`description`、`openGraph`（`images: ['/marketing/og.png']`，图后补）、`alternates.canonical`。
- 根 `layout.tsx` 加 `metadataBase`（从 `NEXT_PUBLIC_SITE_URL` 读，带默认）。现有 `title: 'ENX UI'` 改为 `Catseye`。
- `robots.ts`：允许全站抓取；`sitemap.ts`：列 `/`。
- favicon 已存在（`src/app/favicon.ico`）——可后续换成猫眼主题，不阻塞。

### 8. 明确不做（v1）

`/features` 独立页、`/pricing`、`/docs`（Nextra）、`/changelog`、FAQ 页、Privacy / Terms 页、`/compare` 或 `/vs/<competitor>` 独立对比页（v1 只做首页内嵌的一张对照表，见 Decision 3）、i18n / 语言切换、暗色切换器、testimonials（没有真实用户评价，不放假的）、邮件订阅 / newsletter。

### 9. 测试（`.ai/instructions.md` 强制要求）

**单元（Jest + RTL，`src/**/__tests__/` 或就近）**：

- `DemoVideo`：`demoVideoUrl` 空 → 渲染海报、`Demo coming soon`、**无** `<video>` / `<iframe>`；`.mp4` → 渲染 `<video>` 且 `preload="none"` + `poster`；YouTube 链接 → 首次渲染无 `<iframe>`，点击播放按钮后出现 `<iframe>`。
- `HeaderAuthLinks`：mock 鉴权 hook —— 未登录渲染 `Sign in` 且 `href="/app"`；已登录渲染 `Open App`。
- `Hero`：主 CTA 文本 = `Add to Chrome` 且 `href` = `SITE.chromeWebStoreUrl`；次 CTA 是 `#how-it-works` 锚点。
- `InstallCTA`：`edgeAddonUrl` 空 → Edge 显示 `Coming soon`（非链接）；非空 → 渲染链接。
- `FeatureSection`：渲染传入的 title / body / `img` 的 `alt`。
- `Comparison`：渲染表头含 `Catseye` + 4 个竞品列；每个 `'yes' | 'partial' | 'no'` 值渲染出对应符号且带非空 `aria-label`；渲染免责小字；Catseye 列有高亮标记（class 或 `aria`）。
- `SiteFooter`：不渲染指向未实现路由（`/docs` `/pricing` `/changelog` `/privacy`）的链接。
- **跳转改动**：更新（或新增）`useAuth` 测试断言登录成功后目标是 `/app`；`auth/callback` 同理。

**E2E（Playwright）——本 ADR 改了 `/` 的语义，必须同步改**：

- 匿名访问 `/` → 看到 Hero 的 `Add to Chrome` 和竞品对照表（表内有 `Catseye` 与至少一个竞品名），**看不到** `LoginForm`。
- 访问 `/app` 未登录 → 看到 `LoginForm`（现有 `AuthWrapper` 行为，路由换了而已）。
- 现有任何「访问 `/` 期望登录表单 / dashboard」的 spec → 改成访问 `/app`。
- 登录流程 spec：登录后落在 `/app`。

**验证**：新测试必须先失败再实现（`.ai/instructions.md` 的 vacuous-pass 检查）。

### 10. 术语（CONTEXT.md）

`CONTEXT.md` 顶部产品描述可补一句「对外品牌名 Catseye（见 adr-010）」。新增一条术语（放在合适的小节）：

> **营销区（marketing area）**：`enx-ui` 里 `(marketing)` route group 下的免登录静态页面（官网）。与「应用区」`(app)`（登录后功能）相对。营销区固定浅色、静态渲染、英文单语。
> _Avoid_: 落地页（单指首页时可用 landing page）、官网首页 ≠ 应用首页

---

## Rationale

- **A1 而非 A2 / A3**：营销页和产品共用一套设计语言、字体、shadcn 组件和部署管线；独立仓库要把这些再搭一遍，独立站生成器还会脱离 code review 和产品视觉体系。route group 的代价（两种范式并存）用一份 ADR + 一条 CONTEXT 术语就能框住。
- **B2 而非 B1**：`/` 想纯静态可缓存，就不能在里面读运行时鉴权态；而 token 存在 localStorage，Next middleware 也读不到，B1 只能靠「客户端闪一下再跳」，体验和缓存都打折。把应用入口挪到 `/app`、首页永远是营销页，正是 relingo / immersivetranslate 的模式，代价只是老用户多点一次「Open App」。
- **C1 而非 C2 / C3**：营销内容没有按请求定制的需求，静态预渲染首屏最快、最省、SEO 最好。唯一动态的是顶栏「已登录/未登录」，隔离成一个小 client island 即可。
- **D1 而非 D2 / D3**：视频制作周期不确定，用 D2 会让整个官网被一条视频卡住；D3 每次访问都加载 YouTube 的脚本和 cookie，拖首屏、有隐私顾虑、国内访问差。D1 用一个常量开关，上线后填链接即接入，`preload="none"` / facade 保证不影响首屏。
- **E = Catseye**：ADR-010 已经定了，商标 / 域名核实是那份 ADR 的 follow-up，不该拖住官网文案。
- **F / G 不做**：v1 是「精简版先上」，完整文档站和暗色切换各自都是独立的一块工作，塞进 v1 只会拖慢上线；但 token 用语义写，给后续留口子。
- **不放假 testimonials**：没有真实用户评价就不放，避免上线即失信。
- **H1（首页内嵌对照表）而非 H2 / H3**：用户明确要放；首页一张矩阵是把「学习导向 vs 翻译导向」讲清楚的最省位置，数据现成（market-research §4.2）。独立 `/compare` 页是多页工作、且更容易显得挑衅，留到 SEO 真的值得投入时再做。只取功能事实、不搬私有战略内容，既满足需求又不越 `market-research.md` 划的公开边界。

---

## Consequences

### Positive

- 访客能在不安装、不注册的前提下看懂产品并找到安装入口——上线的前置条件达成。
- 营销区静态、可 CDN 缓存，和应用区、`enx-api` 解耦，首屏快。
- 复用现有设计 token / 字体 / 组件 / 构建，增量集中在 `(marketing)/` 新目录 + `globals.css` 加几个 token + 两处跳转目标 + 一条 CONTEXT 术语。
- route group 骨架为后续 `/features`、`/pricing`、`/docs`、`/changelog` 提供了明确的落位。
- 演示视频不阻塞上线。
- 竞品对照表用一屏讲清「学习导向 vs 翻译导向」的定位差异，是首页转化叙事里最有力的一段；数据来自已有的 market-research，维护成本低。

### Negative

- `/` 语义从「应用入口」变为「营销首页」：老用户书签 / 习惯受影响，E2E 要改，需要在发布说明里提一句。
- `src/app/` 下并存「静态免鉴权」（`(marketing)`）和「客户端鉴权」（`(app)`）两种范式，后来者要读 ADR / CONTEXT 才知道边界——靠约定维持。
- v1 上线首日演示位只有截图、没有视频。
- 没有 `/docs`，安装 / 使用说明只有首页里一段——深度使用问题暂时无处承接（Revisit Trigger 里跟进）。
- 新增 `--brand` token；若之后品牌视觉大改，营销区配色要跟着调（范围可控，只在 `(marketing)`）。
- 官网文案里的 Chrome Web Store id、GitHub 仓库地址、`NEXT_PUBLIC_SITE_URL`、OG 图、海报图都是「待填」占位，上线前需要逐一落实（不是代码问题，是内容 / 资产问题）。
- **竞品对照表把竞争定位公开了**：Catseye 的差异化点、以及「哪些竞品在哪些维度更强」现在写在公开页面上。这是主动选择（对照表是常规营销手段），但要接受：竞品能看到、也能照着调整叙事；表内容随竞品迭代会过时，需要有人偶尔校对（免责小字 + 注明数据日期已缓解）。

### Mitigation

- 发布说明 + 顶栏显眼的 `Open App` 按钮，降低 `/` 改语义对老用户的影响。
- 本 ADR 的 Decision 1 目录树 + Decision 10 的 CONTEXT 术语，把两种范式的边界写清楚。
- `DemoVideo` 的空态设计成「像样的截图 + Demo coming soon」，首日不至于难看。
- `src/lib/site.ts` 把所有「待填」项集中到一个文件，上线前一次性核对。
- 竞品对照表的数据和取值范围写死在组件里 + 注释标注数据来源与日期；`Revisit Trigger` 里挂了「定期校对」。只放功能事实、措辞中立，把「被竞品针对」的风险降到最低。

---

## 内容清单（实现输入 —— 文案占位，资产待补）

> 文案为初稿，实现阶段可再打磨；**资产**（截图 / GIF / 视频 / OG 图 / logo）由用户提供或另行制作。

### 站点级

- **产品名**：Catseye
- **一句话定位（tagline / H1 备选）**：
  - "Learn English while you read the web."
  - "Read English online. Catseye underlines the words worth learning, explains any word you click, and translates whole sentences on demand."
- **主 CTA**：`Add to Chrome`（→ Chrome Web Store）
- **次 CTA**：`See how it works`（→ `#how-it-works`）

### Hero

- H1：`Learn English while you read the web`
- 副标题：`Catseye is a browser extension for AI-assisted English reading. Turn it on for any English page — new words get underlined by difficulty, click any word for its meaning, select a sentence to translate it. Everything you look up flows into your vocabulary list and review system.`
- 资产：`hero screenshot`（扩展在一篇英文文章上工作的截图，单词带彩色下划线 + 一个查词弹窗）

### 演示视频位

- 占位文案：`Demo coming soon`
- 资产：`demo-poster.png`（16:9），之后 `demo video`（30–60s：开学习模式 → 读文章 → 点词 → 划句翻译）

### 核心功能（FeatureSection ×4）

| 标题 | 说明文案 | 资产 |
| --- | --- | --- |
| `Word highlight while you read` | `Words worth reviewing get a colored underline, graded by how far along you are with each one. It's a toggle — turn it off and the page is clean, click-to-look-up still works.` | GIF / 截图：正文里分级下划线 |
| `Click any word for its meaning` | `Click a word in the text and a popup shows its definition, IPA, how many times you've looked it up, and its review status. No setup — it follows learning mode.` | 截图：查词弹窗 |
| `Select a sentence to translate it` | `Drag-select a full sentence and Catseye translates it in the side panel, keeping the original in view. Select a short phrase instead and it explains the phrase in context.` | 截图：side panel 整句翻译 |
| `Idiomatic phrasing` | `Writing to an American teammate? Paste Chinese or rough English and Catseye rewrites it the way a colleague would actually say it — with alternatives and short notes on what changed.` | 截图：rephrase 页面 |

### 工作原理（HowItWorks，3 步）

1. `Add the extension` — one click from the Chrome Web Store.
2. `Turn on learning mode` — click the Catseye icon on any English page.
3. `Just read` — new words get underlined, click to look up, select to translate. Everything you look up is saved for review.

### 竞品对照（`Comparison`）

- 引导语（表上）：`Plenty of tools translate the web. Catseye is built to help you learn from it.`
- 收束句（表下）：`Catseye is the only one that combines real webpage reading, passive mastery tracking, and exam-vocabulary progress in one place.`
- 免责小字：`Comparison based on publicly available information as of <month year>. Features change — corrections welcome.`

| Capability | Catseye | Immersive Translate | Readlang | LingQ | Language Reactor |
| --- | :---: | :---: | :---: | :---: | :---: |
| Works on the English page you're actually reading | ✅ | ✅ | ✅ | ~ (import-first) | ~ (video-first) |
| Underlines words by your level | ✅ | — | — | ~ | — |
| Click a word for its meaning, in place | ✅ | ~ | ✅ | ✅ | ✅ |
| Tracks what you've looked up over time | ✅ | — | ✅ | ✅ | ~ |
| Exam-vocabulary mastery (IELTS / TOEFL / CET) | ✅ | — | — | — | — |
| Mastery growth curve | ✅ | — | — | ~ | — |
| AI meaning-in-context (not just a dictionary entry) | ✅ | ✅ | — | — | — |
| Sentence translation on demand | ✅ | ✅ | ✅ | ✅ | ✅ |
| Chinese-native explanations | ✅ | ✅ | — | — | ~ |

> 表内取值以 `w10n-config/enx/market-research.md` §4.2 为准，随竞品迭代校对；`✅ = yes`、`~ = partial`、`— = no`。**不**把 §4.3/§4.4/§7 的战略、劣势、财务内容搬上页面。

### 安装 / 结尾 CTA

- `InstallCTA` 标题：`Start reading with Catseye`
- 按钮：`Add to Chrome`（Edge / Firefox：`Coming soon`）
- `CtaBanner`：`Free to install. Your vocabulary, building itself as you read.` + `Add to Chrome`

### 页脚

- Product：`Add to Chrome` / `Open App`
- Resources：`GitHub`
- 版权：`© 2026 Catseye`

---

## Revisit Trigger

- **`/docs` 文档站**：当「安装 / 使用」问题多到首页一段话承接不了，或需要写快捷键、站点适配、复习机制、常见站点支持列表——发独立 ADR 决定 Nextra 并入 vs 独立站。
- **`/pricing` 页**：当计费（ADR-009 / ADR-012）对外开放订阅 / 充值，需要公开定价页——对齐 `w10n-config/enx/monetization.md`。
- **演示视频就位后**：填 `SITE.demoVideoUrl`；如果用 YouTube，确认 facade 加载体验；评估要不要自托管一份（国内访问）。
- **`/changelog`**：从 git tag / release 生成，展示迭代活跃度——迭代节奏稳定后再做。
- **testimonials**：积累到有真实、可署名的用户评价后，加社会证明区。
- **竞品对照表**：(a) 每次竞品有大版本更新 / 定价或功能变化时校对一次取值；(b) 如果长尾 SEO（「catseye vs X」）值得投入，再评估 H2（独立 `/compare` 或 `/vs/<competitor>` 页）；(c) 若某竞品提出异议，以「只陈述可公开核实的事实、措辞中立」为准绳复核。
- **暗色模式**：如果用户反馈需要，或应用区先接了 `next-themes`，营销区跟上（token 已就绪）。
- **i18n**：目前明确不做；若面向非中文母语用户扩张，再单独决策（会推翻「英文单语」）。
- **部署管线固化**：`enx-ui` 目前没有专属部署 workflow / Dockerfile；官网上线会让「怎么发布 enx-ui」变成必须回答的问题——需要一个 `deploy-enx-ui` workflow 或等价方案（可能属于 `w10n-config/infra` 而非本仓库）。
- **`/` 改语义的回归**：上线后观察老用户是否大量迷路在营销首页；必要时在 `/` 顶部给已登录用户加一条「You're signed in — Open App」提示条（仍是 client island，不破坏静态）。
