---
status: accepted
date: 2026-10-03
revised: 2026-11-12
related: adr-046（角标状态）、adr-027（Home 的 OnboardingChecklist，本 ADR 与它共用步骤模型）、adr-019 / adr-020（网页 → 扩展通道与登录回跳，本 ADR 加一个消息类型）、adr-039（站点自动启用）、adr-044（服务端偏好，存 `onboardingCompleted`）、adr-048（免费用户试用 AI 积分）
---

# ADR-047：首次使用引导放在 enx-ui 的 `/welcome`，扩展安装后自动打开；步骤按真实状态勾选，可跳过

> **2026-10-19 修订**（为内测准备，参考沉浸式翻译的引导）：引导收敛为「固定图标 + 在示例文章上亲手启用一次、点一个词」，之后放手让用户自己用。
> - 示例文章嵌在 `/welcome` 页内，**不自动启用学习模式**，由用户自己点工具栏图标 →「Read with Catglish」；扩展在 `<html>` 上写 `data-enx-learning` 让页面知道已启用（Decision 2 第 3 步、Decision 4a）。
> - 删去侧边栏整句翻译小项和角标图例 `BadgeLegend`：留给用户自己探索 / 帮助文档。
> - 完成页给一组推荐的英文站点（Decision 3）。
> - 不让用户选母语：第一版只服务「中文母语者学英语」，由 Chrome Web Store 介绍页说明「目前只支持英文 → 中文」。
> - 商店链接在扩展上架前用占位（Decision 2 第 0 步）。

> **2026-11-02 修订（#624）**：推荐站点加 Standard Ebooks、去掉 BBC News 和 Wikipedia（Decision 3）；Home 清单改为纯文本步骤 + 一个 `/welcome` 按钮，并用 `onboarding.ts` 里的 Home 专用标题（Decision 6）。

adr-046 去掉了正文里的「Article processed • Click words for translation」，学习模式的状态只靠扩展图标角标表达。这要求用户在第一次使用时**把图标固定到工具栏**（否则角标看不见、也找不到启用入口）。此外新用户还得完成登录，并**亲手**启用一次学习模式、点一次词——在真实网站上每次都要点图标启用，这是用户必须学会的唯一习惯。

现状：adr-027 在 Home 上给零阅读的用户显示三步清单（安装扩展 → 打开英文页启用 → 读完第一篇），但这只覆盖「先到网站」的用户，且第 2、3 步无法自动勾选；从 Chrome Web Store 直接安装的用户，`runtime.onInstalled` 只初始化了 storage，什么页面都不打开。

## 2026-11-05 修订（#641，owner 确认）

- 普通网页注册 / 登录的默认落点仍为 `/app`，在那里按本 ADR Decision 1a 的账号状态判断：未完成、未跳过引导且没有查词记录的新用户立即转到 `/welcome`，不先展示 Home 引导卡。完成或跳过的用户、已有查词记录的老用户保留 Home；`/billing` 等明确指定的回跳目标和扩展的 `/extension/connected` 不变。
- Welcome 检测扩展时显示转圈与「Checking extension…」，检测完成前不猜测安装结果。未安装时解释用途并提供「Add to Chrome」；已安装时安装这一步在步骤列表里显示为已完成（「Catglish extension installed」，与其他已完成步骤同样的勾和弱化文字，不另做卡片，也没有「Next: finish setup」，见 2026-11-12 修订），安装完成只代表安装这一步完成，后续固定图标、亲手启用和查词保持不变。
- 扩展已通过 Chrome Web Store 审核，以 Unlisted 发布，正式条目 ID 为 `combdcldlodkikjfhjbdbogjlfmnbjkf`。安装链接使用 `https://chromewebstore.google.com/detail/catglish-learn-english-as/combdcldlodkikjfhjbdbogjlfmnbjkf`；站点常量提供正式 ID 和链接作为默认值，运行时环境仍可覆盖。安装链接为空时也使用正式链接，替代上线前的占位。保留原有安装后复用 Welcome 标签页的行为。

## 2026-11-13 修订（#873，Check setup：常驻入口与完成后的状态检查；owner 提出）

- 问题：完成或跳过引导的用户，扩展坏了、丢了，或想再看一遍引导时，回不到 `/welcome`：Home 的引导清单在第一次查词后就消失，只剩 `/help/install`、`/help/get-started` 里藏得很深的链接。即使回到 `/welcome`，完成过引导的用户也只看到完成页，看不到扩展装没装、固定没固定。
- app 侧边栏底部（`NAV_FOOTER`，挨着 Help）加常驻入口「Check setup」→ `/welcome`；`/help` 顶部也放同一个链接。
- 已完成（含跳过）的已登录用户打开 `/welcome` 时，在「You're all set」上方显示一个简短的状态列表，用步骤列表同样的图标：扩展已安装（`enx:status`）、图标已固定（`isOnToolbar`）、已登录（这里总是勾上）。全部正常时就是一排勾；没装或没固定时，那一行作为当前步骤展开安装或固定的说明。完成页其余内容不变。
- 用户在引导中跳过固定图标时，完成页的固定行显示跳过图标并默认收起；点击标题可展开或收起说明，不再显示 Skip。已固定仍显示勾，未固定且未跳过仍作为当前步骤展开；未安装的安装行始终展开。
- 完成页的安装状态只认实时 `enx:status` 响应，不把可能残留的 `data-enx-extension` 标记当作安装证明；页面可见时持续检测，以便禁用或重新启用扩展后无需刷新即可更新。未完成引导的检测行为保持不变。
- 修订记录（#873）：完成后的故障排查须使用实时响应，避免残留标记误报已安装。
- 「已登录」一行同时代表扩展的登录：扩展用 Clerk 的 `syncHost` 从网站同步登录（cookie 共享，`background.ts`、`Popup.tsx`），网站已登录则扩展拿到同一个会话，不单独检测。扩展偶尔误报「Session Expired」是同步时序问题，不是两套登录。

## 2026-11-13 修订（#872，未登录页面太空、Skip setup 不像能点；owner 在生产环境走引导后提出）

- 问题：未登录时页面是单栏（#846 修订），只有一个窄列表，右边三分之二空着，也没有任何品牌标识；页面只说了「要做什么」，没说「做完能得到什么」。「Skip setup」是黑色、悬停才出下划线的链接按钮，看起来像小标题。未登录时点 Skip 去 `/app`，被带去登录，登录后新用户又被 #641 修订转回 `/welcome`，绕了一圈。
- `/welcome` 左上角在所有状态下显示一个小的 Catglish logo 和名字，不是链接，也不加导航菜单：引导页不该邀请用户离开。
- 未登录（以及确定登录状态前的加载中）改为与登录后相同的两栏，右栏是一张**静态示意图** `public/onboarding/word-lookup.svg`：一篇英文文章，点中的一个词弹出 Catglish 的释义卡（单词、音标、中文释义、✓ Know It），下面一行灰字「Click any word while you read — see its meaning in context.」。图不能点、没有链接，所以不和「Continue」抢注意力，同时回答了「为什么要登录」。#846 修订不在未登录时放可互动示例文章的理由仍然成立；登录后的步骤页和完成页右栏仍是示例文章；登录已确认但偏好或统计仍在加载时，沿用单栏加载态，不显示右栏（#872 澄清：区分两种加载态，保留 #846 等账号历史确定后才显示文章的规则）。
  - 选示意图而不是真实截图：截图缩到右栏宽度后释义小字看不清，带着浏览器和网站的杂乱元素，弹窗一改版就过时；示意图与固定图标那一步的 `pin-icon.svg` 同一风格（扁平、浅灰底、品牌色点缀）。也不用手绘风（与站点界面不搭）和动图 / 视频（抢注意力，首页已有演示视频）。
  - 释义卡底部的外部词典链接只画一个书本图标、不写「Youdao」：外部词典将来可能更换，示意图不和某个具体词典绑定。
- 「Skip setup」改为灰色小字、常驻下划线；它要能找到，但不该被鼓励，所以不用品牌色、不做实心按钮。
  - 已登录：行为不变（写 `onboardingCompleted`，去 `/app`），后面跟一句灰字「You can finish it later from your dashboard.」。
  - 未登录或登录状态尚未确定：去产品首页 `/`，不写任何东西，让用户先看看产品再决定是否登录；不再去 `/app`，避免上面的绕圈（#872 澄清：登录状态未知时按未登录处理）。
- 修订记录（#872）：澄清登录状态未知时的 Skip 去向，以及已登录但账号数据未加载完时的右栏，避免两种加载态被混淆。
- 不做：列表垂直居中（当前步骤展开、收起时内容会跳）、列表套卡片或底色（有了右栏不需要）、步骤计数（#862 已定）。

## 2026-11-12 修订（#868，登录步骤只留一个 Continue；owner 在生产环境走引导后提出）

- 问题：登录步骤并排两个按钮，品牌色的是「Sign in」、描边的是「Sign up」。带 `?src=install` 进来的几乎都是新用户，主按钮却是登录；两个按钮只差一个词，用户得先想「我算登录还是注册」。步骤标题「Sign in」和按钮文字重复，也没说登录对用户有什么用。
- 生产 Clerk 实例只开了 Google 和 GitHub 登录。OAuth 下 Clerk 的 `<SignIn>` 遇到不存在的账号会自动转为注册（transfer），所以对用户来说登录和注册没有区别，二选一是没有意义的选择。owner 在生产环境用管理员删除测试用户后，用同一邮箱重新走过这条路。
- `/welcome` 上这一步的标题改为「Create your free account」，当前时标题下加一行灰字「Free to start. Your saved words follow you to any device.」，不写积分数字（数字以 adr-048 为准，会变）。
- 两个按钮合成一个品牌色按钮「Continue」，指向 `/sign-in?redirect_url=…`，回跳规则不变（Decision 2 第 2 步）。老用户（重装扩展、换电脑）点同一个按钮直接登录，不再单独放 Sign in 入口。`/welcome` 上去掉 Sign up；`/sign-up` 页面和其他地方的链接保留。
- 按钮文字用中性的「Continue」，不写「Continue with Google or GitHub」：以后可能加 Apple 等登录方式，按钮不该随之改字。
- 新用户经 `/sign-in` 建号这一点要实测；`@clerk/nextjs` 7.x 默认不这样做时，给 `<SignIn>` 加 `withSignUp`，`src=extension` 的 `forceRedirectUrl`（adr-020）不变。新用户照常拿到 adr-048 的试用积分。同一邮箱已经领过试用的拿不到（adr-062），这是预期；管理员删除测试用户时勾选「Allow the trial again」（adr-062 第 4 条，`resetTrial=true`）可让该邮箱重新领取。
- 以后若开启邮箱密码登录，登录和注册在 Clerk 里会重新分开，届时重新评估这一步是否仍只要一个按钮。

## 2026-11-12 修订（#865，完成态的去向；owner 在生产环境走完引导后提出）

- 问题：完成态最后的「Go to your dashboard」是黑色 `text-sm font-medium`，只在悬停时出现下划线。它和小标题「Something to read」字号、颜色相同，看上去像又一个小标题；上面的推荐站点链接都是品牌色，对比之下它更不像能点的东西。前面每一步的下一个动作都是品牌色按钮，到完成态断了。
- 「Go to your dashboard」改为品牌色按钮（`Button variant="brand"`），文字后带一个向右的箭头图标（`ArrowRight`），仍放在推荐站点之后、作为这一页的收尾动作。它是完成态里唯一留在站内的跳转，所以用主按钮。
- 「You're all set」前加品牌色的勾（`CircleCheck`），与步骤列表里「已完成」的勾呼应，表示引导结束。图标仅作装饰（`aria-hidden`），标题文字不变。
- 推荐站点链接在站点名后加一个小的右上箭头（`ArrowUpRight`，装饰），并给读屏加「(opens in a new tab)」（`sr-only`），把「去外部站点、开新标签页」和「站内按钮」区分开。站点名仍是品牌色文字链接，不改成按钮或卡片（6 个按钮会淹没主按钮）。
- 不做：把 dashboard 按钮挪到推荐站点之前（这一页先引导用户去读真实文章，dashboard 是之后的去处）。
- 新用户引导页（`/welcome`）只面向桌面浏览器：引导发生在刚装好 Chrome 扩展之后，这是桌面产品。今后的修订不再为窄屏设计，也不加窄屏的测试和截图；已有的响应式样式和窄屏用例保留，不专门去删。

## 2026-11-12 修订（#862，当前步骤标记；owner 用新账号在生产环境走引导后提出）

- 问题：当前步骤与后面的步骤用同一个灰色空心圆，只差标题颜色深浅。安装、固定、登录当前时有展开的说明和按钮，本身够醒目；启用、点词没有展开内容，当前时只是一行字，看不出该做哪一步。
- 当前步骤（第一个未完成的）的图标改为品牌色的带点圆（`CircleDot`），标题加 `font-medium`，所在行加 `aria-current="step"`；已完成仍是品牌色的勾，跳过仍是 `CircleSlash`，之后的步骤仍是灰色空心圆。品牌色表示「做完的和正在做的」，灰色表示「还没轮到」。列表里任何时候只有一个 `aria-current`。
- 启用、点词当前时也展开说明，与其他步骤同为「标题 + 说明」：
  - 启用：`/welcome` 上的标题缩短为「Turn on Catglish」，说明为「Click the Catglish icon in your toolbar, then *Read with Catglish*.」，带一个指向工具栏的右上箭头。
  - 点词：标题不变，说明指向示例文章：双栏布局时文章在右，写「on the right →」；窄屏文章在下方，写「below ↓」。按切换双栏的同一断点用 CSS 选，不用 JS。
  - Home 清单的标题不变（Decision 6 的 Home 专用标题）。
- 不做：当前行的底色或卡片（会和右边的示例文章抢注意力，启用的两行标题配色块偏重）；左侧品牌色竖线（以上三项做完仍不够时再考虑）；「Step N of M」计数（勾已经表达了进度）。
- 这条修订把 #846 修订里去掉的 `aria-current` 加回来，但对象不同：#846 去掉的是已删除的「Next: finish setup」按钮上的高亮，这里是步骤列表里当前步骤所在的行。

## 2026-11-12 修订（#852，owner 在真实 Chrome 中重装扩展后提出）

- 固定图标排到登录之前，`/welcome` 的步骤顺序改为：安装 → 固定图标 → 登录 → 启用 → 点词（Decision 2）。
- 原因：从 Chrome Web Store 安装的扩展常被 Chrome 自动固定到工具栏（owner 取消固定、卸载后重装仍被固定，触发条件 Chrome 未公开）。这类用户落地时安装和固定都已勾上，旧顺序下两个勾中间夹着未完成的登录；新顺序下已完成的步骤连在顶部，要做的从下面开始。
- 没被自动固定的用户，当前步骤先是固定图标、再是登录。可以接受：工具栏图标是后面启用、查词的入口，固定步骤仍可跳过，固定检测（`enx:status`）不依赖网站登录。
- 当前步骤仍是第一个未完成的步骤；Home 清单不显示固定和登录，不受影响。上面 #846 修订里「已安装时（当前步骤）是登录」改为「已安装时是第一个未完成的步骤」。

## 2026-11-12 修订（#846，owner 在真实 Chrome 中试用后提出）

- 已安装在 `/welcome` 的步骤列表里显示为一个已完成的步骤（勾 + 弱化标题，无底色、无边框），不再单独放「Catglish extension installed」卡片；去掉「Next: finish setup」按钮及其聚焦 / `aria-current` 高亮：登录步骤本来就在按钮正下方并展开着。
- `/welcome` 上安装步骤始终在列表里：已安装为已完成，未安装为当前步骤。Home 清单不变，仍只在未安装时显示安装。
- 未登录的 `/welcome` 显示全部步骤（安装、登录、固定图标、启用、点词），让用户看到还剩多少。只有当前步骤（第一个未完成的）展开说明和按钮：已安装时是登录，未安装时是安装；之后的步骤灰显，只有标题，没有按钮。
- 示例文章只在登录之后出现（步骤页和完成页）；未登录时、以及登录状态和账号历史还没确定（加载中）时都不显示，页面为单栏，避免文章与唯一要做的「登录」争注意力，也避免对未登录用户闪一下。`/reader/sample` 不变：仍免登录、仍自动启用。
- 未登录时标题与登录后一样，都是「Welcome to Catglish」，不再重复「sign in to get started」。

## 用户从哪里进来

三种情况，`/welcome` 一个页面全部支持，靠真实状态区分（Decision 2）：

- **A. 先到网站**：catglish.com → 进入 `/welcome` → 页面经 `enx:status` 探测到扩展未安装 → 引导从「安装扩展」开始 → Chrome Web Store → 安装 → 回到 `/welcome` 继续。
- **B. 先到商店**：Chrome Web Store（搜索、推荐、视频链接）→ 安装 → 扩展打开 `/welcome` → 探测到已安装 → 引导从「登录」开始。此时用户多半还没有账号。
- **C. 重装 / 换电脑**：已有账号，`onInstalled` 的 reason 依然是 `install`。

A、B 的区别只是「进来时扩展装没装」，页面能直接探测到，不需要靠 URL 参数或来源判断。

## Considered Options

- **引导页做成扩展自带页面（`chrome-extension://…/welcome.html`）**：能直接调 `chrome.action.getUserSettings()`，不依赖网络。但登录本来就在网站上完成（adr-015 `syncHost`、adr-020），试读文章最可靠的是 enx-ui 的 Reader 页面（adr-019），两者都在网站；扩展页还要再打包一套 UI 与文案。否决。
- **只在 popup 里引导**：popup 失焦即销毁（adr-001），放不下多步流程，也演示不了角标变化。否决。
- **固定顺序的向导（下一步/下一步）**：C 类用户已经登录、可能已固定图标，却被迫重走。否决；改为**按真实状态勾选的清单**，已完成的步骤一进来就是勾上的。
- **引导里自动启用示例文章的学习模式**（`/reader/sample` 现在的做法，经 `enx:enable-reader`）：用户能直接点词，但从没点过图标，换到真实网站就不知道怎么开。否决（2026-10-19）；引导里由用户自己点。
- **示例文章在新标签页打开 `/reader/sample?guide=1`**：步骤说明和文章分在两个标签页，用户要来回切；检测启用要跨页面。否决；文章嵌进 `/welcome`，左（上）步骤、右（下）文章，与沉浸式翻译第 3 步同形。
- **在引导里选母语 / 演示侧边栏整句翻译 / 角标图例**：母语第一版只有中文；侧边栏和角标对「开始用起来」不是必需，多一步就多一分流失（Mozilla 对安装后页面的建议：只放开始使用必需的东西）。否决。
- **让用户在引导里给某个站点开「总是启用」**：`chrome.permissions.request` 只能在扩展自己页面的用户手势里调用，网页调不了。不放进引导。

## Decision

1. **入口**：`runtime.onInstalled` 且 `reason === 'install'` 时，background 打开 `${uiOrigin}/welcome?src=install`（`uiOrigin` 取 `targets.ts` 当前 target 的 enx-ui 地址）。Chrome Web Store 安装完成后会触发这个事件，这是从商店进来的用户唯一的落地点。`update` 不打开。**A 路径防重复开页**：用户从 `/welcome` 去商店安装时，`/welcome` 标签页还开着；background 先用 `chrome.tabs.query({ url: '${uiOrigin}/welcome*' })` 找它（构建出的 manifest 对 enx-ui origin 有 host 权限，可以按 URL 查），找到就切回那个标签页并聚焦窗口，不另开新页；找不到才新开。`/welcome` 也允许用户直接访问（官网、Home 清单都链过去），且**不登录也能打开**（放在 `(app)` 布局之外，或该布局对它放行）。
1a. **老用户不看引导**：扩展卸载时本地存储全部清除，重装 / 换电脑后扩展无法知道「这是老用户」，所以判断放在 `/welcome` 上、按账号做：
   - **已完成标记**：adr-044 的服务端偏好加一个布尔键 `onboardingCompleted`（与 `aiWordFallbackNoticeAck` 同类，用户不可在设置里编辑）。引导到达完成态、或用户点「Skip setup」时写入 true。
   - **既有用户不需要迁移**：`onboardingCompleted` 为真，**或**累计查词数 > 0，都视为老用户。
   - **已登录、经安装进入 `/welcome?src=install`**（同一浏览器重装时网站登录态还在）：老用户直接跳到 `/app`，带一句「Catglish extension connected」，不显示步骤。
   - **未登录进入 `/welcome`**（换电脑）：页面标题为「Welcome to Catglish」，列出全部步骤，第一个未完成的为当前步骤：已安装时第 0 步为已完成，第一个未完成的步骤（未固定时是固定图标，已固定时是登录，见 2026-11-12 #852 修订）为当前步骤并展开；未安装时（直接访问 `/welcome`，A 路径）第 0 步为当前步骤并展开安装说明，登录随后续步骤一起灰显。当前步骤之后的步骤只有标题、没有按钮；不显示示例文章，页面为单栏（2026-11-12 修订，#846）。这一屏对新老用户都成立，老用户本来也必须重新登录扩展；登录回跳后按上一条判断，老用户直接去 `/app`。
   - 因此老用户最多看到一次本来就需要的登录页，看不到任何引导步骤。
   - 判断不了的情况（例如用户换电脑后不登录、直接关掉）就让引导出现一次：这种情况概率低，代价只是多看一页。**每一步都显示「Skip setup」**，已登录时点了即写入 `onboardingCompleted` 并去 `/app`；未登录时去产品首页 `/`（2026-11-13 修订，#872）。
2. **步骤**（全部按真实状态显示勾选，不按顺序锁定；文案全英文）：
   0. **安装扩展**（`/welcome` 上始终在列表里：未安装时为当前步骤，已安装时显示为已完成的「Catglish extension installed」；Home 清单只在未安装时出现。2026-11-12 修订，#846）：「Add to Chrome」按钮在新标签页打开 Chrome Web Store。链接取现有的运行时配置 `ENX_EXTENSION_WEB_STORE_URL`；扩展上架前它为空，按钮显示为不可点的「Coming soon to the Chrome Web Store」（与 `OnboardingChecklist` 现有的空链接处理一致），上架后填上配置即可，不改代码。页面可见时每 2 秒发一次 `enx:status`，探测到安装后自动勾上（同时扩展会把用户切回这个标签页，见 Decision 1）。非 Chromium 浏览器给出「Catglish needs Chrome」说明。安装操作由商店页面完成；**2026-11-05 修订（#559，owner 确认）**：Enhanced protection 用户可能遇到额外警告，因此公开帮助中心 `/help` 提供商店搜索安装、ZIP 手动安装与首次使用手册，正文先上线并预留截图位置，不加视频。商店搜索说明按上线时 Public 发布编写，保留正式条目直达链接。`/welcome` 的安装步骤在商店按钮下解释该警告，并提供新标签页打开的 ZIP 安装帮助链接；检测到已安装后随安装步骤的说明一起隐藏（步骤本身变为已完成）。警告文案与商店安装手册共用一处定义，经 #560 实测确认警告消失后移除。帮助页从官网与 App 的 Help 菜单进入，免登录；安装后的状态判断与实际操作仍在 `/welcome`。产品名和仓库地址使用站点配置，离线包名示例从仓库名派生，并兼容旧发布使用产品名的附件。产品演示视频已在官网首页。
   1. **固定图标**（可跳过；2026-11-12 修订，#852：排在登录之前）：一张示意图，展示「点拼图图标 → 点 Catglish 旁的图钉」（静态图片，用本地构建的扩展截取，放在 enx-ui 的 `public/` 下；第一版先用手绘示意图 `public/onboarding/pin-icon.svg`，截图后替换）。页面在这一步可见、且未跳过时每 2 秒经 `enx:status` 查询 `isOnToolbar`，固定后自动勾上；进来时已固定（包括被 Chrome 自动固定的用户）则直接是勾上的。点「Skip」直接进入下一步；跳过的人之后由 adr-046 Decision 6 的固定提示最多再提醒两次，本 ADR 不另做计数。
   2. **登录**：已登录则勾上；未登录时标题为「Create your free account」，只给一个「Continue」按钮去 `/sign-in`（2026-11-12 修订，#868：原为 Sign in / Sign up 两个按钮），登录回跳回到 `/welcome`（用 Clerk 的 `redirect_url`，保留 `?src=install`；不用 adr-020 的 `src=extension`，它会把用户送到 `/extension/connected`）。
   3. **在示例文章上试一次**：`/welcome` 页内直接渲染示例文章（与 `/reader/sample` 同一份 `SAMPLE_ARTICLE`，容器同为 `#enx-reader-article`），**不调用 `requestReaderMode()`**。两个小项：
      - **启用**：提示「Click the Catglish icon in your toolbar, then *Read with Catglish*」（2026-11-12 修订，#862：标题改为「Turn on Catglish」，这句移到当前步骤展开的说明里；点词同样展开一句指向文章的说明）。扩展启用学习模式后在 `<html>` 上写 `data-enx-learning="on"`（Decision 4a），页面观察到即勾上，提示换成下一项。
      - **点一个词**：提示「Click any word in the article」。累计查词数 > 0 即勾上（现有 stats 接口 `/api/stats/overview` 的 `vocab.total`，即词表条目数，与 Home 同一信号；用户删过词时会少算。页面可见时每几秒重查一次，直到勾上）。
      - 用户未登录扩展时点「Read with Catglish」会得到扩展自己的登录提示；登录（第 2 步）本来就在前面，不另做处理。
3. **完成**：第 3 步两项都勾上后写入 `onboardingCompleted`，显示「You're all set」，然后放手。固定图标没做也没跳过不影响完成；完成态一旦出现就保持，之后关掉学习模式也不回到步骤列表：
   - 一句话：在任意英文文章页点 Catglish 图标 →「Read with Catglish」即可。
   - **推荐站点**：一组可以马上去读的英文站点链接（新标签页打开）。清单写在 enx-ui 一个常量里，按需增删；入选条件是**免登录、无付费墙、正文结构普通、实测学习模式可用**。初始候选：InfoQ（infoq.com）、Anthropic News（anthropic.com/news）、BBC News、The Guardian、AP News、NPR、Wikipedia（扩展有专门适配器）。实现时逐个在真实 Chrome 里验证，不能用的移出清单。
     - **2026-11-02 修订（#624）**：加入 Standard Ebooks（standardebooks.org，免费公版经典书），去掉 BBC News 和 Wikipedia。Standard Ebooks 同样要过上面的入选条件，并且要在书的在线阅读页（如某一章）上实测，不只看首页；首页只是书目时，链接指向真正读书的页面。
   - **去 Home**：最后一个品牌色按钮「Go to your dashboard →」，去 `/app`（2026-11-12 修订，#865：原为黑色文字链接）。
   - 不介绍侧边栏、角标、「Always enable on this site」：这些留给用户自己发现，或写进日后的帮助文档。
   - 之后用户**主动**打开 `/welcome`（不带 `src=install`）时直接显示完成态，示例文章仍可在页内试用。完成态上方显示扩展安装、固定、登录的状态（2026-11-13 修订，#873），入口是 app 侧边栏的「Check setup」。
4. **新的网页 → 扩展消息 `enx:status`**：返回 `{ ok, version, isOnToolbar }`。与 `enx:ping` 一样只认 `ENX_UI_ORIGINS` 来源，只读，不改任何状态。登录状态由网页自己的 Clerk 得出，不经扩展。`enx:ping` 保留不动（Home、`/reader` 在用）。
4a. **学习模式状态标记 `data-enx-learning`**：与 adr-019 的 `data-enx-extension` 版本戳同一机制、同一限制（只在 enx-ui 页面上写）：content script 在本页学习模式启用成功后写 `<html data-enx-learning="on">`，关闭（`enxStop`）时移除。只是给 enx-ui 页面看的只读信号，不参与扩展内部逻辑。
5. **自动启用由页面决定，不由 URL 决定**：enx-ui 上的学习模式自动启用一直是页面主动发 `enx:enable-reader`（adr-019）。`/reader` 提交后与 `/reader/sample` 保持自动启用；`/welcome` 不发。Reader 适配器（`siteAdapters.ts` 的 `pageSupport`）现在只放行 `/reader` 与 `/reader/*`，需加上 `/welcome`。
6. **与 Home 清单的关系**：adr-027 的 `OnboardingChecklist` 与 `/welcome` 共用一个步骤模型（`onboardingSteps({ installed, signedIn, isOnToolbar, pinSkipped, learningEnabled, hasLookedUp })` 纯函数，放 `src/lib/onboarding.ts`）。Home 清单是同一套步骤的精简版（零阅读用户在 Home 上看到，点任一步跳 `/welcome`；省掉登录和固定图标：Home 在登录之后，固定状态只有 `/welcome` 会去问扩展。每个界面显示哪些步骤也由 `onboarding.ts` 决定）；它现在第 3 步链接的是 `/reader` 粘贴页，改为指向 `/welcome`。文案只写一份。
   - **2026-11-02 修订（#624）**：Home 清单的步骤不再各自是链接。步骤标题是纯文本，整张卡只有一个按钮「Start with a sample article」→ `/welcome`（adr-027 Decision 2 的注记）。Home 的步骤标题与 `/welcome` 不同：「Click the Catglish icon in your toolbar…」「Click any word in the article」在 Home 上没有对应的工具栏操作和文章，Home 改用不依赖页面的说法（如「Turn on Catglish for the article」「Click any word you don't know」）。两套标题都放在 `onboarding.ts`，按 view 选用，组件里不写文案；「文案只写一份」指每个界面的每句话只在 `onboarding.ts` 出现一次。`/welcome` 的标题不变。
7. **不做的事**：不选母语；不演示侧边栏整句翻译；不做角标图例；不做产品导览式的页面遮罩高亮；不收集引导漏斗指标（需要时按 adr-040 再加）；不做 `setUninstallURL` 的卸载反馈页；不在引导里设置词汇水平或高亮偏好；不放视频（官网首页已有）。
8. **示例文章是 enx-ui 内置的固定公开文章**（2026-10-13 修订）：
   - 正文是写在 enx-ui 代码里的一篇英文短文（`src/lib/sampleArticle.ts`，约 200 词，大众话题，几个中等难度的词，并自然带上撇号词、连字符词、句首大写词和多个段落，方便同时当测试素材）。全站只有这一篇。
   - 两处渲染：独立页 `/reader/sample`（自动启用，给 `/reader` 的「Try a sample」和 `task dev:verify` 用），以及 `/welcome` 页内（不自动启用，Decision 2 第 3 步；只在登录后的步骤页和完成页出现，2026-11-12 修订，#846）。两处结构都与 `/reader` 的阅读态相同（`#enx-reader-article`）。
   - **`/reader/sample` 不登录也能看**：两处页面都放在 `(app)` 布局之外，`/reader/sample` 未登录直接显示正文；`/welcome` 页本身免登录，但未登录时不渲染文章（2026-11-12 修订，#846）。查词仍要登录扩展，那是扩展自己的提示。
   - **不写后端**：不创建 Reader 文档，所以不受 adr-022 的 7 天删除影响，也不占「My Documents」的名额。
   - 否决的替代：让用户把 N 篇 Reader 文档标为永久保留——那是另一个面向用户的功能（配额、存储、UI），而且内容存在数据库里、各环境不同，做不到「固定、跟代码一起版本化」。

## 实现要点（给实现者 / AFK agent）

- enx-chrome：
  - `background.ts` 的 `onInstalled` 在 `install` 时打开或切回 `/welcome?src=install`（Decision 1）；`onMessageExternal` 加 `enx:status`（`getUserSettings()` 取 `isOnToolbar`）。把「找已有 `/welcome` 标签页还是新开」写成纯函数放 `src/lib/`，background 只做接线。
  - content script：学习模式启用 / 关闭时写 / 删 `data-enx-learning`，与 `extensionPresence.ts` 同处，只在 `isEnxUiHost` 上生效。
  - `siteAdapters.ts`：Reader 适配器的 `pageSupport` 放行 `/welcome`。
  - 单测：`install` 且没有 `/welcome` 标签页时新开、已有时切回不新开，`update` 不打开；`enx:status` 只响应 `ENX_UI_ORIGINS`、返回 `isOnToolbar`；`data-enx-learning` 启用后出现、关闭后消失、非 enx-ui 页面不写；`/welcome` 被 Reader 适配器判为支持。
- enx-api：`preferences` 注册表加 `onboardingCompleted`（布尔，默认 false，不可在设置页编辑）；单测覆盖默认值与写入。
- enx-ui：
  - 公开路由 `/welcome`（未登录必须能看到登录步骤）；`src/lib/enxExtension.ts` 加 `extensionStatus()`；`src/lib/onboarding.ts` 放 `onboardingSteps` 纯函数，`OnboardingChecklist` 改用它并链到 `/welcome`；推荐站点常量；固定图标示意图放 `public/`。
  - 单测：`onboardingSteps` 各状态组合；`/welcome` 不发 `enx:enable-reader`；`data-enx-learning` 出现后第 3 步「启用」勾上；已登录 + 已固定 + 已查词时直接显示完成态；固定步骤可跳过；`extensionStatus` 超时返回未安装；老用户经 `src=install` 进入跳 `/app`；商店链接为空时安装按钮不可点。
- e2e（adr-037 / enx-ui e2e）：已登录用户打开 `/welcome` 看到登录步骤已勾；未登录打开 `/welcome` 看到登录入口和全部步骤、没有示例文章（2026-11-12 修订，#846）；已登录打开 `/welcome` 看到示例文章；未登录打开 `/reader/sample` 直接看到文章正文，不跳登录页。
- **人工验证项**：真实 Chrome 中全新安装扩展 → 自动打开 `/welcome` → 固定图标后第 1 步自动勾上（或 Chrome 已自动固定、进来即勾上）→ 登录回跳回 `/welcome` → 点图标「Read with Catglish」，角标 `…` → `✓`、第 3 步「启用」勾上 → 点词出释义 → 完成页出现推荐站点；推荐站点逐个可用。

## Consequences

- 从商店直接安装的用户第一次有了明确的下一步，不再落在一个什么都没发生的浏览器里。
- 用户在引导里亲手点过一次图标，换到真实网站上知道怎么开学习模式。
- 引导依赖网络和 enx-ui；enx-ui 不可达时安装后打开的是错误页。可接受：没有 enx-api/enx-ui，扩展本来也用不了。
- 侧边栏整句翻译、角标含义、站点「总是启用」没有在引导里教，靠用户自己发现；若内测反馈说找不到，再加帮助文档或完成页提示。
- 推荐站点会改版、加付费墙；清单要偶尔复查，失效就移除。
- 扩展上架前，从网站进来的新用户卡在第 0 步（没有安装链接）；内测期间由邀请消息另给安装方式。
