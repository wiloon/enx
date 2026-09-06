# ADR-016：enx-ui 应用区加统一导航骨架——`(app)` route group + 手写 App Shell（左侧边栏主导航 + 顶栏），登录门禁从页面上提到 layout，导航配置化，为「每日/每周/每月阅读统计」预留 `/stats` 分区

| 字段 | 值 |
| --- | --- |
| **状态** | Accepted — 2026-09-05。已按方案实现：`src/app/(app)/` route group + `src/app/(app)/layout.tsx`（门禁 + shell）+ `src/components/app/{app-nav.ts,AppShell,AppSidebar,AppTopbar}` + `/stats` 占位页；`AuthWrapper` 删除；`/billing` 页内孤立的「返回首页」链删除。`pnpm test` / `pnpm build` 通过，URL 未变。 |
| **日期** | 2026-09-05 |
| **关联 ADR** | [`adr-013-catseye-marketing-site.md`](adr-013-catseye-marketing-site.md)（把 `/` 定为静态营销首页、应用入口移到 `/app`，并**明确把应用区导航骨架、`(app)` route group、`/docs`、`/pricing` 留到后续 ADR**——本 ADR 补上其中的导航骨架那块）、[`adr-015-cognito-to-clerk-auth-migration.md`](adr-015-cognito-to-clerk-auth-migration.md)（客户端 Clerk 鉴权；signed-out 必须 `<RedirectToSignIn />` 到 `/sign-in` catch-all，不能内联 `<SignIn>`——本 ADR 把这个门禁从 `AuthWrapper` 搬进 `(app)/layout.tsx`，`src/__tests__/clerk-routing.test.ts` 的不变量继续成立）、[`adr-012-enx-ui-idiomatic-rephrasing.md`](adr-012-enx-ui-idiomatic-rephrasing.md)（enx-ui 页面形态：`'use client'` + shadcn 卡片 + React Query） |
| **参考** | 侧边栏 vs 顶栏、dashboard 导航模式的通行结论：<https://girardmedia.com/blog/sidebar-navigation-design-web-applications>、<https://www.alfdesigngroup.com/post/improve-your-sidebar-design-for-web-apps>、<https://artofstyleframe.com/blog/dashboard-design-patterns-web-apps/> |

---

## 已确认的决策（2026-09-05，用户确认）

1. **布局 = 左侧边栏主导航 + 顶栏**。侧边栏放主导航（Home / Word Lookup / Rephrase）、下面一组 Insights（Reading Stats）、底部一组账户类（Billing）。顶栏放当前页面标题 + 用户名 + Sign out。移动端侧边栏收成汉堡 + 抽屉。
2. **手写轻量 App Shell，不引入 shadcn 官方 `sidebar` 组件**。后者会带 `sheet` / `tooltip` / `separator` / `skeleton` / `use-mobile` 一串依赖，对当前 5 个导航项偏重。`globals.css` 里 scaffold 时已带的整套 `--sidebar-*` 语义 token 直接用上。
3. **导航文案全英文**（对齐 ADR-013 决策 3 全站英文单语、以及现有 lookup/rephrase 页）。`/billing` 页内既有的中文正文本次不动，是独立的后续清理项。
4. **登录门禁上提到 `(app)/layout.tsx`**。此前只有 `/app`（经 `AuthWrapper`）有门禁，`/lookup`、`/rephrase`、`/billing` 全靠 API 401 兜底。上提后整个 `(app)` 子树统一门禁。行为不变：`isLoading` → spinner，`!isAuthenticated` → `<RedirectToSignIn />`。
5. **导航配置化**：`src/components/app/app-nav.ts` 三个数组（`NAV_MAIN` / `NAV_INSIGHTS` / `NAV_FOOTER`）是唯一事实源，侧边栏、抽屉、顶栏标题都读它。**加一个分区 = 加一行**。
6. **本次范围 = 骨架 + 占位**。`/stats` 只放一个占位页（Daily / Weekly / Monthly 三张「Charts coming soon」卡），证明 shell 能承载未来分区。真实图表、图表库选型、`enx-api` 统计端点都留到后续 ADR（`globals.css` 已有 `--chart-1..5` token 备用）。

---

## Context

### enx-ui 应用区现状（ADR-013 落地后）

- `/` = 静态营销首页（`SiteHeader` + `src/components/site/*`），应用入口在 `/app`。
- `/app` = `AuthWrapper`：一身兼三职——登录门禁 + 一个 bespoke 页头（`Welcome, {user}` + Sign out）+ 功能卡片九宫格（Word Lookup / Idiomatic Phrasing / 订阅与积分 / Hello World）。
- `/lookup`、`/rephrase` = **一张孤立的 shadcn `Card`**，没有任何页头、没有返回入口。用户进去只能靠浏览器后退或改地址栏出来。
- `/billing` = 有一个孤零零的「返回首页」文字链，指向的还是**营销首页 `/`**（不是 `/app`），语义不一致。
- 只有 `/app` 有登录门禁，其余三页没有。

### 为什么现在做

用户反馈：进了 `/rephrase` 想回首页，页面上「没有链接或者按钮」。这是每个应用页都缺的结构问题，不是 rephrase 一页的 bug。同时站点计划加**每日 / 每周 / 每月阅读统计与图表**，应用区分区会从 3 个涨到 5+ 个，需要一套能长期承载的导航，而不是再往每页手贴一个返回链。

### 为什么值得写 ADR

- **难以反悔**：`(app)/` route group 骨架一旦定，未来所有应用页（stats、settings、docs…）都挂这上面；登录门禁的位置从「每页各自调 `AuthWrapper`」变成「layout 统一管」。
- **反直觉**：`src/app/` 下现在三种渲染/鉴权范式并存——`/` 的静态免鉴权营销、`sign-in/sign-up` 的 Clerk catch-all、`(app)/` 的 client 门禁 shell。后来者需要知道边界在哪。
- **真实取舍**：侧边栏 vs 顶栏、手写 vs shadcn `sidebar`、门禁放 layout vs middleware、未来 stats 用「一个页带 tab」vs「多路由」，都有多个合理选项。
- ADR-013 已明确把这块列为「后续 ADR」。

---

## Options Considered

### A. 导航布局

| 方案 | 说明 | 结论 |
| --- | --- | --- |
| A1.（采用）左侧边栏主导航 + 顶栏全局上下文 | 侧边栏持久列出全部分区，顶栏放标题 + 用户菜单 | dashboard/工具类应用通行做法：垂直列表扫视快、不占垂直视口、加分区只是列表变长。正好匹配未来要加的统计/图表页。 |
| A2. 仅顶部横向导航栏 | 一条顶栏放 logo + 横向 nav + 用户菜单 | 实现更轻，但分区变多、要塞统计图表页时横向空间不够，扩展性差。否决。 |
| A3. 面包屑 / 每页手贴返回链 | 每个页面自己加「← Back」 | 就是现在的困境来源，不解决结构问题。否决。 |

### B. Shell 组件来源

| 方案 | 说明 | 结论 |
| --- | --- | --- |
| B1.（采用）手写 `AppShell` / `AppSidebar` / `AppTopbar` | ~150 行，用现有 `--sidebar-*` token、`lucide-react`、`Button`/`Card` | 零新依赖，完全可控，对 5 个导航项体量合适。 |
| B2. shadcn 官方 `sidebar` 组件 | `npx shadcn add sidebar` | 功能全（可收起 / 持久化 / `SidebarProvider`），但拖进 `sheet`/`tooltip`/`separator`/`skeleton`/`use-mobile`，对当前需求过重。未来真需要再换。 |

### C. 登录门禁放哪

| 方案 | 说明 | 结论 |
| --- | --- | --- |
| C1.（采用）`(app)/layout.tsx` 客户端门禁 | `useAuth()` → spinner / `<RedirectToSignIn />` / `<AppShell>` | 与 ADR-015「客户端 Clerk 鉴权、不在 middleware 读 token」一致；一处覆盖整个子树。 |
| C2. `middleware.ts` 服务端保护 | `clerkMiddleware` 的 `auth.protect()` | ADR-015 明确没做服务端保护（token 在 localStorage，middleware 读不到会话）。不在本 ADR 翻案。 |
| C3. 维持每页各自门禁 | 现状 | `/lookup`/`/rephrase`/`/billing` 现在压根没门禁，且重复。否决。 |

### D. 未来 `/stats` 的路由形态（本次只占位，方向先记下）

| 方案 | 说明 | 倾向 |
| --- | --- | --- |
| D1. 单页 `/stats` + Daily/Weekly/Monthly tab | 一个路由，客户端切 period | 倾向：数据源同构、切换无跳转、URL 可带 `?period=weekly` |
| D2. `/stats/daily`、`/stats/weekly`、`/stats/monthly` 三路由 | 每个 period 一页 | 备选：深链更干净，但三份脚手架 |
| —— | —— | 留待接图表时的后续 ADR 定，`isNavItemActive` 已按「`/stats` 及其子路由都高亮 Reading Stats」写好，两种都兼容。 |

---

## Decision

### 1. 路由结构

```
src/app/
  layout.tsx                    # 根布局，不改
  page.tsx                      # 静态营销首页，不改
  sign-in/ sign-up/             # Clerk catch-all，不改
  (app)/                        # ← 新增 route group（括号不影响 URL）
    layout.tsx                  # ← 新增：登录门禁 + <AppShell>
    app/page.tsx                # /app —— dashboard 瘦身成「概览页」
    lookup/  rephrase/          # /lookup /rephrase —— 仅移动，内容不改
    billing/                    # /billing 等 —— 删页内「返回首页」链
    stats/page.tsx              # ← 新增：/stats 占位页
```

移动用 `git mv` 保历史，URL 全部不变（`pnpm build` 产物已确认）。

### 2. `(app)/layout.tsx`

`'use client'`。`useAuth()`（`src/hooks/useAuth.ts`）：`isLoading` → 居中 spinner；`!isAuthenticated` → `<RedirectToSignIn />`（`@clerk/nextjs`，**不内联 `<SignIn>`**，ADR-015）；否则 `<AppShell>{children}</AppShell>`。

### 3. `src/components/app/`

- **`app-nav.ts`**：`NAV_MAIN` / `NAV_INSIGHTS` / `NAV_FOOTER` 三数组（`{label, href, icon}`）+ `isNavItemActive(pathname, href)`（`href` 或其子路由都算 active）+ `navTitleForPath(pathname)`（最长匹配的 `label`，回退 `'Catseye'`）。
- **`AppSidebar.tsx`**：logo（同 `SiteHeader` 的 `bg-brand` 圆点 + 站名）+ 三组导航，`NAV_FOOTER` 推到底（`mt-auto`），组间细分隔线。active 项 `bg-sidebar-accent` + `aria-current="page"`。接 `onNavigate?` 供抽屉关闭。
- **`AppTopbar.tsx`**：移动端汉堡（`md:hidden`）+ `navTitleForPath` 标题 + 用户名 + `Sign out`（`useAuth().logout()`，已 `redirectUrl: '/'`）。sticky + `backdrop-blur`。
- **`AppShell.tsx`**：桌面 `w-64` 固定侧栏（`hidden md:block`，`sticky top-0 h-screen`）+ 右侧 `AppTopbar` + `<main>{children}</main>`；移动端侧栏变遮罩抽屉，`useState` 控开合，`usePathname` 变则关。不触发 `alert/confirm`。

### 4. `/app` 概览页

`'use client'`，`useAuth()` 取 `user` 显示 `Welcome, {username}`，下面功能卡片网格（Word Lookup / Rephrase / Reading Stats / Billing），每张 `<Link>` 过去。去掉原 `AuthWrapper` 的页头行和 Sign out（都进 topbar 了）。`AuthWrapper.tsx` 删除。`HelloWorld` 卡不再进 dashboard。

### 5. `/billing`

删页内 `<Link href="/">返回首页</Link>` 及其 `next/link` import。标题 `订阅与积分` 保留（页内中文文案是独立清理项）。

### 6. `/stats` 占位

`'use client'`，标题 `Reading Stats` + 一句「Charts coming soon」+ Daily/Weekly/Monthly 三张 `Card`。

### 7. 测试

- `src/components/app/__tests__/AppSidebar.test.tsx`：渲染出全部导航项；`/rephrase` 时只有 Rephrase `aria-current="page"`；`/stats/weekly` 时 Reading Stats 高亮；`onNavigate` 点击回调。
- `src/components/app/__tests__/AppTopbar.test.tsx`：标题取自 nav 配置；Sign out 调 `logout`；汉堡调 `onOpenSidebar`。
- `src/app/(app)/__tests__/layout.test.tsx`（承接删掉的 `AuthWrapper.test.tsx`）：signed-out → `redirect-to-sign-in` 且无内联 `<SignIn>`；`isLoading` → Loading；signed-in → shell + children。
- `src/app/(app)/stats/__tests__/page.test.tsx`：Daily/Weekly/Monthly 都在。
- `src/__tests__/clerk-routing.test.ts` 不变量（`<SignIn>` 只在 catch-all 里）继续成立。

---

## Consequences

- `/app` 的语义从「dashboard 全家桶（门禁 + 页头 + 卡片）」收敛为「概览页」，门禁与页头 chrome 上移到 `(app)/layout.tsx` + `AppShell`。
- `src/components/AuthWrapper.tsx` 及其测试删除。
- `/lookup`、`/rephrase`、`/billing`、`/stats` 首次获得客户端登录门禁（此前无）。
- `src/app/` 下三范式并存的边界写进本 ADR：静态营销（`/`）／Clerk catch-all（`sign-in`、`sign-up`）／client 门禁 shell（`(app)/`）。
- 未来加应用页 = 在 `src/app/(app)/` 下建目录 + 往 `app-nav.ts` 加一行。
- 遗留清理项（不阻塞本 ADR）：`/billing`、`/billing/success`、`/billing/cancel` 页内中文文案与 ADR-013 决策 3 的全站英文不一致；`HelloWorld.tsx` 已无引用。
- 后续 ADR：`/stats` 的真实实现——`enx-api` 统计端点、图表库选型、单页 tab vs 多路由（见 Options D）、深浅色主题切换器（ADR-013 决策 G 仍挂起）。
