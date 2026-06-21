# TASK-SPEC: enx-chrome 支持 claude.com Blog 页面单词高亮

| 字段 | 值 |
| --- | --- |
| **状态** | In Progress — 2026-07-16（代码改动 + 自动化测试已完成，等待 §4.3 手工浏览器验证后转 Done） |
| **类型** | SDD Task Spec（Spec 驱动实现；实现前以本文为准，实现后同步更新状态与验收清单） |
| **目标** | 1) 让 `enx-chrome` content script 在 `claude.com/blog/*` 文章页面生效，实现单词高亮与点击查词；2) 顺带把 `getArticleNode`/`extractWords`/`renderWithHighlights`/`getColorCode` 的**三处重复实现**合并为单一来源，消除 selector 列表漏改风险；3) 修复正文提取阶段把 `<script>`/`<style>` 内文本误当单词候选的已知风险 |
| **非目标** | 不支持 `claude.com` 除 `/blog/*` 外的其他路径（尤其是 App/Chat 界面）；不新增针对真实线上站点的 e2e 测试；不改变现有高亮渲染算法/颜色计算的**行为**本身（合并时以 `content.ts` 现有生产实现为准，只做来源去重，不做算法重设计）；不处理仓库内其他测试文件（如 `flexContainerFix.test.ts`）在测试体内重新模拟逻辑而非引用源码的同类问题（范围更大，列入 §9 后续扩展） |
| **触发原因** | 用户希望在阅读 `claude.com/blog` 英文技术文章（示例：`https://claude.com/blog/getting-started-with-loops`）时使用 ENX 的单词查询/高亮功能；Review 时进一步要求：(a) 顺手同步两处 selector 差异，(b) 评估重复实现是否有必要、能否技术上解决，(c) 修复已记录的 script/style 文本泄漏风险 |

---

## 1. 背景与动机

`enx-chrome` 通过 `manifest.json` 的 `content_scripts[0].matches`（及对应 `host_permissions`）白名单控制 content script 生效的站点。目前已支持 InfoQ、NYTimes、Google Developers Blog、Microsoft Research、Reuters、`www.anthropic.com`、`anthropic.skilljar.com` 等域名。Anthropic 的产品/博客内容已迁移或新增至 `claude.com`，因此需要把 `claude.com/blog/*` 纳入白名单，并确认现有的文章正文提取策略（`getArticleNode()`）能正确定位该页面的文章正文 DOM 节点。

在调研过程中发现，承载这套逻辑的代码存在**三处几乎重复但已经互相漂移**的实现，其中一处还导致**单元测试测的是测试文件自己的复制品、而非生产代码**。这是比"少一个 selector"更值得一起解决的问题，故本次一并处理。

---

## 2. 现状调查

### 2.1 站点白名单（`enx-chrome/manifest.json`）

`content_scripts[0].matches` 与 `host_permissions` 当前均为**整域名/整路径**粒度（如 `https://www.anthropic.com/*`），未包含 `claude.com`。

### 2.2 正文处理逻辑存在三处重复实现

`grep -rn "class ContentWordProcessor\|class WordProcessor" enx-chrome/src` 命中三处：

| 位置 | 角色 | 状态 |
| --- | --- | --- |
| `src/content/content.ts` → `ContentWordProcessor`（约 L16-L330） | **生产实际运行代码**（content script 入口，未 `export`） | 功能最全、且包含后续踩坑修复（见下） |
| `src/lib/wordProcessor.ts` → `WordProcessor`（全文件） | `export` 但**在 `src` 内无任何文件 import 它**（`grep -rn "from '.*wordProcessor'" src` 无结果） | **死代码**，且已与 `content.ts` 行为分叉 |
| `src/content/__tests__/wordHighlighting.test.ts` → `ContentWordProcessor`（约 L14-L134） | 测试文件内手工复制的第三份 class | 测试的是**这份复制品**，不是 `content.ts` 的真实实现——若有人只改 `content.ts` 不同步改这里，测试仍然全绿但线上行为已经不同 |

三处之间已经出现真实分叉，例如：

- `content.ts` 的 `getArticleNode()` 比 `wordProcessor.ts` 多几条站点专用 selector（Skilljar `#lesson-main-content` / `.sjwc-lesson-content-item`、MS Research `.single-post__container`）。
- `content.ts` 的 `getColorCode()` 多一个判断分支 `wordData.LoadCount === 0` 时返回白色（不高亮"数据库里查不到"的词），`wordProcessor.ts` 没有这个分支。
- `content.ts` 的 `renderWithHighlights()` 是基于 `TreeWalker` 遍历文本节点、用 DocumentFragment 替换的 **DOM 树版本**；`wordProcessor.ts` 的同名方法是**对整段 HTML 字符串做正则 replace** 的旧版本，更容易破坏嵌套标签（`flexContainerFix.test.ts`、`whitespacePreservation.test.ts` 这两个既有测试文件本质就是在为 DOM 树版本已修复、但字符串正则版本仍会踩的坑做回归防护）。

### 2.3 重复是否有技术上的必要性

**结论：没有必要，可以合并。**

`content.ts` 文件头注释写着"Sentry initialization is skipped to avoid import issues in content script context"、内联 class 处也写"inline to avoid import issues"——这是 2025-07 首次提交 `enx-chrome` 时就有的假设。但项目构建链路（`vite.config.ts`）用的是 `@crxjs/vite-plugin`，其核心能力之一就是把 content script / background service worker 当普通 Vite/Rollup 入口打包，静态 `import` 会被正常内联进产物，不存在"content script 不能 import 普通模块"的限制。可验证证据：

- `src/background/background.ts` 同样是 manifest 声明的 content-script 类入口（`service_worker`），已经 `import { config, getApiBaseUrl } from '@/config/env'`，引入的是**带运行时代码的普通函数**，不是 type-only import，构建/运行均正常。
- `wordProcessor.ts` 本身也 `import { WordData } from '@/types'`。

因此当年"避免 import 问题"的假设大概率已过时（或从未真正验证过），三份复制品是历史遗留，不是当前工具链的硬约束。

### 2.4 实测 `https://claude.com/blog/getting-started-with-loops` 页面结构

拉取线上页面源码（Webflow 生成）确认：

- **无 `<article>` 标签**，`main` 节点为 `<main id="main" class="page_main">`（粒度太粗，会带入页头/侧栏/相关文章列表）。因此现有 selector 列表**全部不命中**，会落入"最大文本容器"兜底逻辑，存在命中错误容器的风险，不够可靠。
- 正文实际容器 class 为 `blog_post_content_wrap`。该 class 在页面中出现**两次**。

> **⚠️ 2026-07-16 手测后更正**：上面这条最初的结论是错的，纠正见 §2.4.1。当初判断"第一个是正文、第二个是 CTA"，是用字符串位置粗略截取两次 class 出现之间的文本来估算长度（把中间不相关的其他区块也算了进去），没有用真正配对的标签边界去核对。手工浏览器验证时发现点词查词在文章中段突然失效，重新精确解析后发现结论反了。

#### 2.4.1 精确复核结果（配对标签边界，非字符串粗略截取）

- **第一个** `.blog_post_content_wrap`：只有 **767 字符**，是文章开头那一小段引言，止于"...start with the simplest solution and use these patterns selectively."。
- **第二个** `.blog_post_content_wrap`：实际有 **17339 字符**，是真正的文章主体（含 "Triggered by" 那段及后续全部内容），只是前面多了一个 "Get Claude Code"（Desktop/VS Code/JetBrains 下载入口）CTA 小组件。
- `document.querySelector(selector)` 只返回 DOM 顺序里**第一个**匹配，所以原实现选中的是那个 767 字符的引言块，后面 17000+ 字符的正文完全没被处理——这正是手测时"点词查词在某一句之后失效"的根因（详见 §4.4.1）。
- 正文内部分文字块进一步包裹在 `class="u-rich-text-blog u-margin-trim w-richtext"` 的 `div` 中（同一篇文章可能出现多次），但外层 `.blog_post_content_wrap`（取正确的那个）已完整覆盖，无需单独处理。

### 2.5 已知风险：`extractWords` 会把 `<script>`/`<style>` 文本当单词候选

`processArticleContent()`（`content.ts`）中：`const textContent = articleNode.textContent || ''`，直接用于 `extractWords()`。`textContent` **不会**排除 `<script>`/`<style>` 标签内的文本——TreeWalker 过滤逻辑只存在于后续 `renderWithHighlights()` 渲染阶段（用于跳过高亮），不影响 `extractWords` 阶段已经把脚本/样式内容当英文单词处理。`.blog_post_content_wrap` 容器尾部恰好包含一段 Swiper 轮播初始化 `<script>`，会被一并计入。此问题对所有现有站点通用，不是 claude.com 独有，本次一并修复。

---

## 3. 目标设计

### 3.1 `enx-chrome/manifest.json`

在 `content_scripts[0].matches` 与 `host_permissions` 中新增：

```
"https://claude.com/blog/*"
```

**不要**使用 `"https://claude.com/*"`——`claude.com` 同时承载 Claude App/Chat 等产品页面，注入 content script 会误伤主产品交互体验，必须限定到 `/blog/*` 路径前缀。

### 3.2 合并三处重复实现为单一来源

- 以 `content.ts` 现有 `ContentWordProcessor` 的 **DOM 树版本**为基准（`getArticleNode` / `extractWords` / `renderWithHighlights` / `getColorCode` / `findTextNodes` 全部逻辑），因为它已经包含 flex 容器修复、空白保留修复等经过验证的行为，字符串正则版本没有。
- 把这份实现迁移到 `src/lib/wordProcessor.ts`，作为唯一 `export class WordProcessor`（覆盖掉当前更旧、更脆弱的字符串正则版本）。
- `content.ts` 删除内联 `class ContentWordProcessor`，改为 `import { WordProcessor } from '@/lib/wordProcessor'`，调用点同步改名（`ContentWordProcessor.xxx` → `WordProcessor.xxx`）。
- `src/content/__tests__/wordHighlighting.test.ts` 删除内联复制的 `class ContentWordProcessor`，改为 `import { WordProcessor } from '@/lib/wordProcessor'`。合并后这份测试才是在测**真实生产代码**，而不是自己的复制品。
- 副作用：`getArticleNode()` 的 selector 列表天然只剩一份，不存在"两处同步"的问题——用户提的第 1 点（同步 selector 差异）通过合并直接解决，无需再手动维护两份列表。
- **孤儿方法处理（已与用户确认）**：`wordProcessor.ts` 现有的 `processIntoChunks` / `isValidWord` / `removeHighlights` 三个方法在 `content.ts` 中没有对应实现，仓库内也无任何调用（属于死代码）。合并时**直接删除**，不带入新文件；后续若真的需要，可从 git 历史找回。
- **调试日志清理（已与用户确认）**：`content.ts` 现有实现里混有明显一次性调试遗留的高噪声日志，例如 `renderWithHighlights` 内专门检查文本是否包含 `'Claude'`/`'creator'`/`'Boris'` 的调试块（约 L165-L170、L213-L233）、`getArticleNode` 里逐个 selector 打印"Trying selector..."的调试输出。迁移到共享模块时**顺手清理**，只保留必要的流程日志（如"找到 N 个待处理文本节点"“应用高亮完成”），不保留这类一次性调试代码。属于日志层面的清理，不改变 §3 非目标里约束的"高亮渲染算法/颜色计算行为"。

### 3.3 新增 claude.com selector

在合并后的**唯一** selector 列表中新增一行（保留原有全部站点专用 selector，包括 Skilljar / MS Research 那几条）：

```
'.blog_post_content_wrap', // Claude blog (Webflow)
```

放置顺序建议靠前（与 `.post-content` 相邻即可），确保优先于"最大文本容器"兜底命中。

**回归测试（已与用户确认）**：目前 §4.3 的 claude.com/blog 验收只有"本地手测线上真实页面"，没有自动化覆盖——以后若 selector 列表被误改（例如合并/重构时手滑删掉一行），CI 不会报错，只能靠人肉发现。为此新增一个轻量单测：在 `wordHighlighting.test.ts`（或新建 `getArticleNode.test.ts`）里构造一段模拟 `.blog_post_content_wrap` 结构的 fixture HTML，断言 `WordProcessor.getArticleNode()` 命中正确的正文容器。

**3.3.1 补充修复（手测中发现，见 §2.4.1 / §4.4.2）**：`.blog_post_content_wrap` 在 claude.com/blog 页面上匹配到两个元素，`document.querySelector` 只取 DOM 里第一个（767 字符的引言），导致后面 17000+ 字符的真正正文完全没被处理。第一版修复是把匹配策略从"每个 selector 只取第一个 `document.querySelector` 匹配"改成"取该 selector 所有匹配里文本最长的一个"。

**3.3.2 进一步修复（用户第二轮手测反馈，见 §4.4.3）**：用户手测发现"最长的一个"仍然不够——两个 `.blog_post_content_wrap` 都是有效的文章内容（一个是短引言"Getting started with loops"，一个是正文主体），只取最长的那个会让引言部分永远查不了词。改为 `getArticleNodes()`（复数，返回 `Element[]`）：对于命中的 selector，**该 selector 匹配到的所有元素**（各自仍需单独超过 100 字符阈值，且排除嵌套在另一个匹配内部的元素以避免同一段文本被处理两次）都会被返回并逐个应用取词高亮。`content.ts` 的 `processArticleContent()` 相应改为对每个返回的节点分别提词、分别渲染高亮、分别绑定点击事件；词典（`wordCache`）在所有节点间共享，避免重复请求后端。

### 3.4 修复 `extractWords` 的 script/style 文本泄漏

在 `processArticleContent()` 取正文文本用于 `extractWords()` 之前，不直接读 `articleNode.textContent`，而是先克隆该节点、移除克隆体内的 `<script>`/`<style>`/`<noscript>` 元素，再取克隆体的 `textContent`：

```ts
const cleanArticleText = (articleNode: Element): string => {
  const clone = articleNode.cloneNode(true) as Element
  clone.querySelectorAll('script, style, noscript').forEach(el => el.remove())
  return clone.textContent || ''
}
```

- 只处理 `extractWords` 取词阶段，不影响 `renderWithHighlights` 阶段（其 TreeWalker 过滤已正确排除这些标签）。
- 不动 DOM 上真实的 `articleNode`（用 clone，避免影响后续 `articleNode.innerHTML` 读取原始 HTML 做高亮渲染的逻辑）。
- 该函数放入合并后的 `src/lib/wordProcessor.ts`（作为 `WordProcessor` 的静态方法或独立导出函数均可），只维护一份。

---

## 4. 验收标准

### 4.1 重复实现合并

- [x] `grep -rn "class ContentWordProcessor" enx-chrome/src` 结果为空（`content.ts` 与 `wordHighlighting.test.ts` 均已改为 import）
- [x] `src/lib/wordProcessor.ts` 是 `getArticleNode`/`extractWords`/`renderWithHighlights`/`getColorCode` 的唯一实现来源，且行为与合并前的 `content.ts`（生产版本）一致，包括 `getColorCode` 的 `LoadCount === 0` 分支
- [x] 合并后的 selector 列表包含原 `content.ts` 全部站点专用 selector（Skilljar、MS Research 等不丢失）+ 新增的 `.blog_post_content_wrap`
- [x] 现有全部单测（`pnpm test`，含 `flexContainerFix` / `whitespacePreservation` / `htmlRendering` / `realWorldCase` / `codeBlockExclusion` / `wordHighlighting`）保持通过，行为不回归 —— 68/68 通过；`wordHighlighting.test.ts` 里两条依赖旧 mock 实现细节的用例已重写为基于真实 `WordProcessor` 输出的行为断言（见下方「实施笔记」）
- [x] `processIntoChunks` / `isValidWord` / `removeHighlights` 已从合并后的文件中删除（确认无调用后删除，不带入新文件）
- [x] `content.ts` 中一次性调试遗留日志（如检查 `'Claude'`/`'creator'`/`'Boris'` 的调试块、逐 selector "Trying selector..." 打印）已清理，仅保留必要流程日志

### 4.2 script/style 泄漏修复

- [x] 新增单测：articleNode 内嵌 `<script>`，断言 `cleanArticleText`/`extractWords` 提取结果不包含脚本内的 token（`wordHighlighting.test.ts` → `cleanArticleText` describe block）
- [x] `renderWithHighlights` 阶段行为不变（script/style 内容本来就不会被高亮，此项只是回归确认）

### 4.3 claude.com/blog 支持

- [x] 新增单测：模拟 `.blog_post_content_wrap` 结构的 fixture HTML，覆盖"取最长匹配"（历史版本）、"排除嵌套匹配"、"无 selector 命中时退回最大文本容器兜底"三种情况（`getArticleNode.test.ts`，不依赖真实线上页面）
- [x] `manifest.json` 的 `host_permissions` 与 `content_scripts[0].matches` 均包含 `https://claude.com/blog/*`
- [ ] 本地加载 unpacked extension，登录后访问 `https://claude.com/blog/getting-started-with-loops`，点击扩展图标启用 ENX：
  - [ ] 控制台可见 `✅ Using article node with selector: .blog_post_content_wrap`
  - [ ] **两段内容都**能点词查词：开头引言（"Getting started with loops"）**和**正文主体（"Turn-based loops" / "Triggered by" 及之后）（§4.4.3 修复项，需重新手测确认）
  - [ ] 点击高亮单词弹出查词 popup，行为与其他站点一致（发音/释义/Mark Known）
- [ ] 访问 `claude.com` 非 `/blog` 路径（如 Claude App/Chat 界面），控制台**无** `ENX Content script loaded` 日志，即 content script 未注入

> 上面四项手工浏览器验证需要真实登录态和真实 Chrome，需要你本地跑一遍（步骤见 §7 第 4 步）。前两轮手测已经发现并帮助定位了 §4.4.2、§4.4.3 的问题，修复后需要**重新跑一遍**这四项确认。其余全部验收项已通过 `pnpm test` + `pnpm build` 自动验证。

### 4.4 实施/手测中发现并修复的问题

#### 4.4.1 `renderWithHighlights` 标签计数正则误报（既有 bug，合并时发现）

合并后用真实 DOM 跑 `renderWithHighlights` 的新测试意外触发了 `console.error('⚠️ Tag mismatch! HTML structure may be broken')`。排查后确认：这是 `content.ts` 里**本来就有**的一处误报——标签计数用的正则 `/<u[^>]*class="enx-word"/g` 只匹配字面量 `class="enx-word"`（要求紧跟一个闭引号），但实际生成的 class 永远是 `class="enx-word enx-<word>"`（多了一个空格 + 单词后缀），导致这个正则**永远数不出真实的 opening `<u>` 标签数**（恒为 0），只要页面上有一个词被高亮就会误报"标签不匹配"。这个 bug 在合并前就存在于 `content.ts`，只是旧测试全用 mock、从未真正跑过这段代码，所以一直没被测试捕捉到。

- [x] **已修复**：`src/lib/wordProcessor.ts` 里正则改为 `/<u[^>]*class="enx-word[^"]*"/g`，正确匹配带单词后缀的 class。`pnpm test`（68/68）确认误报消失，`pnpm build` 正常。
- 这是纯诊断逻辑的修正，不影响实际高亮渲染行为（`renderWithHighlights` 返回值不变），风险和影响面都很小，故未额外走一轮用户确认就直接修了。

#### 4.4.2 `getArticleNode()` 只取 selector 第一个匹配，导致 claude.com 文章被截断（第一轮手测发现，已被 §4.4.3 取代）

用户第一轮手测反馈：claude.com 该文章点词查词只在"...start with the simplest solution and use these patterns selectively."之前有效，之后（"Triggered by: A user prompt."起）全部失效。

排查后定位为 §2.4.1 描述的问题：`.blog_post_content_wrap` 在该页面匹配到两个元素（767 字符的引言 + 17339 字符的真正正文），`getArticleNode()` 原实现用 `document.querySelector` 只取第一个（引言），导致真正的正文完全没被处理。也顺带纠正了 §2.4 里最初"第一个是正文、第二个是 CTA"的错误结论（当时用字符串位置粗略估算长度，没有用配对标签边界精确核对）。

- [x] **已修复（第一版）**：`getArticleNode()` 改为对每个 selector 用 `document.querySelectorAll` 取所有匹配，选文本最长的一个（仍要求超过 100 字符阈值）。通用健壮性修复，不针对 claude.com 特判。
- 这一版修复解决了"正文主体能查词"的问题，但用户第二轮手测发现引言部分（"Getting started with loops"）又查不了词了——两个匹配都是有效正文，只取"最长的一个"本身就是错的策略。完整修复见 §4.4.3。

#### 4.4.3 只处理"最长匹配"仍不够：改为处理 selector 命中的**全部**元素（第二轮手测反馈，用户主动提出）

用户手测确认 §4.4.2 修复后"Turn-based loops"部分可以查词了，但同时反馈开头"Getting started with loops"那一段（即短引言，767 字符那个 `.blog_post_content_wrap`）没有被处理，并明确要求：对于 selector 匹配到的**所有**文本都启用查词，而不是只挑一个。

- [x] **已修复**：`WordProcessor.getArticleNode()` → `getArticleNodes()`（复数，返回 `Element[]`）。策略从"选最长匹配"改为"该 selector 命中的所有匹配都返回"（每个仍需单独超过 100 字符阈值；排除嵌套在另一匹配内部的元素，避免同一段文本被处理两次）。
- [x] `content.ts` 的 `processArticleContent()` 同步改为对 `Element[]` 操作：合并所有节点的文本一起提词（`wordCache` 在节点间共享，避免同一批词重复请求后端），拿到词典后再对每个节点分别 `renderWithHighlights` / 修 flex 容器 / 绑定点击事件；"处理完成"提示条只加在第一个节点上，避免同一页面出现多条提示。
- [x] `getArticleNode.test.ts` 重写为 `getArticleNodes` 的行为测试：断言两个有效匹配都被返回、嵌套匹配被排除、无 selector 命中时正确回退到最大文本容器兜底。`pnpm test`（70/70）与 `pnpm build` 均通过。
- [ ] **待你重新手测确认**：见 §4.3。

---

## 5. 风险与约束

| 风险 | 缓解 |
| --- | --- |
| 合并两版 `renderWithHighlights` 时如果误用 `wordProcessor.ts` 的旧字符串正则版本覆盖 `content.ts` 的 DOM 树版本，会导致 flex 容器/空白保留等已修复 bug 复现 | 明确以 `content.ts`（生产实际使用）实现为迁移基准；合并后先跑全量既有单测，全绿才继续下一步 |
| `getColorCode` 两版逻辑有一处差异（`LoadCount === 0` 分支） | 合并时以 `content.ts` 版本为准；在 §4.1 验收项中显式核对该分支保留 |
| `extractWords` 排除 `script`/`style` 后，理论上可能影响极少数站点已提取的词数（边界情况） | 只按标签名精确排除 `script`/`style`/`noscript` 本身内的文本节点，不改变其余 DOM 结构判断；用新增单测覆盖回归 |
| Webflow 页面模板变化可能改变 `blog_post_content_wrap` class 命名 | 兜底逻辑（最大文本容器）仍在，selector 失效时功能降级而非报错；未来失效需更新 selector |
| `claude.com` 同时服务 App/Marketing，误配 matches 会影响主产品体验 | 严格限定 `matches`/`host_permissions` 为 `https://claude.com/blog/*`，不使用整域名通配 |
| 合并 + 新 selector + script/style 修复三件事一起改，出问题时不易定位是哪一步引入 | 建议按 §7 顺序分步提交/验证：先合并去重（跑既有测试）→ 再修 script/style 泄漏（跑新测试）→ 最后加 claude.com 支持（手测线上页面） |

---

## 6. 相关文件索引

| 文件 | 说明 |
| --- | --- |
| `enx-chrome/manifest.json` | 新增 `https://claude.com/blog/*` 到 `matches` 与 `host_permissions` |
| `enx-chrome/src/lib/wordProcessor.ts` | 合并后的唯一 `WordProcessor` 实现来源；新增 `.blog_post_content_wrap` selector；新增 script/style 清洗逻辑（`cleanArticleText`）；`getArticleNode()` → `getArticleNodes()`，返回该 selector 命中的全部有效匹配（`Element[]`），排除嵌套匹配 |
| `enx-chrome/src/content/content.ts` | 删除内联 `ContentWordProcessor`，改为 import `WordProcessor`；`processArticleContent()` 改为对 `getArticleNodes()` 返回的每个节点分别提词高亮、绑定点击事件，`wordCache` 在节点间共享 |
| `enx-chrome/src/content/__tests__/wordHighlighting.test.ts` | 删除内联复制的 class，改为 import `WordProcessor`；新增 script/style 泄漏回归测试（`cleanArticleText` describe block） |
| `enx-chrome/src/content/__tests__/getArticleNode.test.ts` | 新文件；`getArticleNodes()` 行为测试：多匹配全返回、嵌套匹配排除、无命中时的兜底 |
| `enx-chrome/src/background/background.ts` | 佐证材料：已在 content-script 类入口中使用普通运行时 import，证明合并方案技术可行 |
| `enx-chrome/e2e/content-highlighting.spec.ts` | 现有高亮 e2e，基于本地 `test-page.html`，本次不改 |

---

## 7. 实施顺序（推荐）

```text
1. [x] 合并三处重复实现 → src/lib/wordProcessor.ts 为唯一来源
   - content.ts 与 wordHighlighting.test.ts 均改为 import
   - 删除孤儿方法 processIntoChunks / isValidWord / removeHighlights
   - 清理一次性调试日志（Claude/creator/Boris 检查块、逐 selector 打印等）
   - 跑 pnpm test，确认既有测试全绿（尤其 flexContainerFix / whitespacePreservation）
2. [x] 修复 extractWords 的 script/style 泄漏 + 新增回归测试
   - 跑 pnpm test，确认新测试通过且未破坏第 1 步成果
3. [x] manifest.json 新增 claude.com/blog matches；selector 列表新增 .blog_post_content_wrap
   - 新增 getArticleNode() 命中 .blog_post_content_wrap 的 fixture 单测
4. [ ] 本地 unpacked 加载，手测 claude.com/blog 真实页面（§4.3）——需要真实 Chrome + 登录态，需你本人执行
5. [ ] 勾选 §4 全部验收项，文首状态更新为 Done — YYYY-MM-DD
```

### 实施笔记

- `pnpm test`：11 个测试套件、70 个用例全部通过；`pnpm build`（`tsc -p tsconfig.app.json && vite build`）成功，`dist/manifest.json` 与打包后的 `content.ts` 产物均已核对包含 `claude.com/blog` 与 `.blog_post_content_wrap`。
- `wordHighlighting.test.ts` 的 `renderWithHighlights` 描述块里有两条用例（"should handle basic highlighting setup"、"should handle empty word dictionary"）原本是针对**测试文件自己那份 mock 实现**写的——手动 mock `document.createElement`/`document.createTreeWalker`，断言的是一句写死的 `console.log` 文本。这两条用例本身就是 §2.2 里说的"测试测复制品"问题的一部分，切到真实 `WordProcessor` 后原样保留会直接挂。已重写为对真实 DOM 输出做行为断言（例如 `result` 里包含 `class="enx-word enx-hello"`），不再依赖内部实现细节。
- 详见 §4.4：手工浏览器验证过程中先后发现并修复了三个问题——一个 `content.ts` 里本来就有、此前从未被测试跑到的标签计数误报 bug（§4.4.1），以及两轮 `getArticleNode(s)` 选取策略的迭代（§4.4.2 → §4.4.3：从"只取第一个匹配"到"只取最长匹配"再到"取全部有效匹配"）。这条经验本身也印证了 spec §4.3 里强调的：selector 命中逻辑光靠读源码调研容易出错，真实页面手测是必需的一步，不能只靠自动化测试和静态调研替代。

---

## 8. SDD 工作方式（给 Agent / 开发者）

1. **实现前**：以本文 Spec 为唯一需求来源；若线上页面结构已变化（Webflow class 名不同），先更新 §2.4 再改代码。
2. **实现中**：严格按 §7 分步提交，每步跑一次测试，避免"合并 + 新功能 + bug 修复"混在一次提交里导致出问题不好定位。
3. **实现后**：勾选 §4 验收清单；将文首**状态**更新为 `Done — YYYY-MM-DD`。

---

## 9. 后续扩展（Out of Scope，供未来 Spec 引用）

- 视需要支持 `claude.com` 的其他内容路径（如 `/news`、`/research`，若存在）
- 仓库内多个测试文件（如 `flexContainerFix.test.ts`、`htmlRendering.test.ts`）在测试体内重新模拟 `content.ts` 的逻辑，而不是引用真实源码，属于与本次 §2.2 同类但**范围更大**的技术债（"测试测的是复制品"）。建议另立 Spec 评估：是否值得把 `content.ts` 里可测的纯逻辑部分（flex 修复、HTML 渲染等）也一并拆到 `src/lib/` 并让所有测试统一 import 真实源码。
