---
status: proposed
date: 2026-11-16
related: adr-010 / adr-011（站点适配器、contentVolatility、SPA 重建）、adr-039（本站总是启用）、adr-046（角标）、adr-072（平台选择器）、adr-081 Decision 4–5（书标识、「从上次的位置继续」提示）；issue #907；tomeshelf 仓库 ADR-0001、ADR-0005、ADR-0006（DOM 契约）、ADR-0010（分页）
---

# ADR-088：支持 tomeshelf 电子书阅读器

tomeshelf 是用户自托管的 EPUB 阅读器（独立仓库 wiloon/tomeshelf），把书的正文直接渲染进页面主文档，就是为了让 ENX 能用（tomeshelf ADR-0001）。它承诺了一份 DOM 契约（tomeshelf `docs/dom-contract.md`）：

- `<meta name="generator" content="tomeshelf <version>">`：这是 tomeshelf 的阅读页；
- `<meta name="tomeshelf:book" content="<book id>">`：同一本书的每个文档相同；
- `<meta name="tomeshelf:restores-position" content="true">`：tomeshelf 自己恢复阅读位置；
- 正文在唯一的 `<article id="tomeshelf-content">` 里，没有 iframe 和 shadow root；
- tomeshelf 是单页应用：换到下一个文档时不刷新页面，改地址并整个替换 `#tomeshelf-content` 的内容；
- 分页布局下正文区是横向滚动容器，`element.scrollIntoView()` 会翻到对应的页（tomeshelf ADR-0010）。

今天 ENX 不认识 tomeshelf，把它当作普通静态网站，用默认适配器。在 homelab 上实测（2026-11-15）：

1. 第一个文档能正常点击查词。
2. 翻到下一个文档后，工具栏图标上的角标消失，新文档里点击不再查词。开着「本站总是启用」也一样。
3. 原因：地址一变，Chrome 对这个标签页发 `tabs.onUpdated` 的 `loading`，后台按 adr-046 Decision 4 清掉角标（`background.ts`），等新页面重新报告；但页面没有重新加载，内容脚本还是原来那个，默认适配器是 `static`，不监听页内跳转，所以既不重新处理新文档，也不再报告状态。「本站总是启用」只在页面加载时跑一次（adr-039），同样不会被页内跳转触发。

## Decision

1. **新增 tomeshelf 站点适配器，按页面上的 generator 信号识别，不按域名。** 每个自托管实例的域名都不同，地址规则无法匹配。识别条件：页面上有 `<meta name="generator">`，其 `content` 以 `tomeshelf ` 开头（契约规定版本号部分是自由文本，只能匹配前缀）。今天的 `SiteAdapter.matches` 只看地址，要让适配器解析能看到页面 DOM；这是适配器解析本身的扩展，按 generator 识别的适配器排在按域名识别的之后、默认适配器之前。不放进 adr-072 的 `PLATFORM_RULES`：平台规则只决定文章选择器，而 tomeshelf 还需要 `contentVolatility`、书标识和关闭提示，这些都是适配器的职责。
2. **文章是 `#tomeshelf-content`，`contentVolatility` 是 `spa`。** 页内跳转后按 adr-011 Decision 6 重新识别文章、重新处理正文，并像其他 SPA 站点一样重新报告学习模式状态，角标随之恢复。`readySelector` 用 `#tomeshelf-content`，等它非空且安静后再处理；`minTextLength` 为 1（插图页、很短的文档也要能用）；`wholePageOnMiss` 不开，契约保证文章节点存在。
3. **角标恢复不依赖时序。** 后台在 `loading` 时清掉角标，内容脚本在重建完成后重新报告；如果清角标晚于重新报告到达，角标会再次消失。实现必须保证页内跳转后最终显示的是重建后的状态（例如重建在 `loading` 之后才报告，或后台对页内跳转不清角标），并用 E2E 测试锁定：页内跳转后角标仍是开启状态，新文档能点击查词。
4. **书标识来自 `tomeshelf:book`，不来自地址。** adr-081 Decision 4 的 `bookKey` 今天只拿 `href`；tomeshelf 的书 id 在契约里只出现在 meta 标签上（契约明确说 URL 路径不属于契约），所以 `bookKey` 要能读页面。书标识是页面的 origin 加上 `tomeshelf:book` 的值，例如 `https://tomeshelf.wiloon.lab` + `9f2c…`，一本书的所有文档共用一个阅读位置和钉住的句子；不同实例上的同一本书是不同的书。meta 缺失时退回规范化后的页面地址（今天的行为）。
5. **页面声明 `tomeshelf:restores-position` 时，不显示「从上次的位置继续」提示（adr-081 Decision 5）。** 阅读器自己会把书打开在上次的位置，两边都跳会互相打架。阅读锚点照常记录，钉住句子和侧边栏照常工作，侧边栏里的跳转仍可用（跳转用 `scrollIntoView`，分页布局下 tomeshelf 会翻到对应的页）。判断看当前页面上的 meta，页内跳转后重新判断。
6. **不做的事**：不调用 tomeshelf 的接口，不读它的阅读位置，也不向它发事件。把 ENX 查词时的句子作为 tomeshelf 的阅读位置（tomeshelf ADR-0005 Consequences、ADR-0006 Consequences 提到的 DOM 事件）留到以后，另立 ADR。

## Considered Options

- **按域名白名单**：让用户在设置里填自己的 tomeshelf 域名。否决：多一步配置，而 tomeshelf 的契约本来就是为了让扩展不靠域名识别它。
- **只加一条 adr-072 平台规则**：改动最小，第一个文档能查词。否决：解决不了换文档后失效，这正是用户遇到的问题。
- **对所有静态站点都监听页内跳转**：一次修好所有单页应用。否决：会改变所有静态站点的行为，范围远超这个问题；其他单页应用遇到了再按站点加适配器。

## Consequences

- tomeshelf 在分页布局下，同一文档内翻页只是正文区横向滚动，地址不变，ENX 不需要做任何事；只有跨文档才触发重建。
- 适配器解析开始依赖 DOM 后，在 `document_start` 或 `<head>` 还没解析完时调用会认不出 tomeshelf。调用点必须在 DOM 就绪之后（内容脚本在 `document_end` 注入，此时 `<head>` 已解析完；学习模式也是之后才开启）。
- tomeshelf 改动契约里的 meta 名称或文章 id 是对扩展的破坏性变更（tomeshelf ADR-0006），ENX 这边的单元测试和 E2E 用契约里的写法做夹具。

## Revisit Triggers

- tomeshelf 增加 ENX 句子事件（上面第 6 条）。
- tomeshelf 放弃滚动布局或改变正文的滚动容器，影响 `scrollIntoView` 跳转。
