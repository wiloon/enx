# ADR-026：单词卡加「报告释义问题」入口——用户**主动、逐条同意**地把该词所在原句连同两种释义快照提交给管理员，落到独立的 `word_feedback` 表与 `(app)/admin/feedback` 队列；**不自动采集**、**不自动回写 `words` 表**；隐私政策页（LAUNCH-CHECKLIST 6.2）是硬前置

| 字段 | 值 |
| --- | --- |
| **状态** | Proposed — 2026-09-16。**计划在工具正式上线部署之后再开发**，本 ADR 先把决策记录下来。本次未写任何代码。 |
| **日期** | 2026-09-16 |
| **关联 Spec** | 无独立 TASK-SPEC；Decision 即实现依据（同 adr-012 Decision 10）。 |
| **关联 ADR** | [`adr-021-enx-ui-admin-dictionary-maintenance.md`](adr-021-enx-ui-admin-dictionary-maintenance.md)（**主要依赖**：复用其建立的 `middleware.RequireAdmin` + `(app)/admin/` 子树 + `NAV_ADMIN` 条件导航；本 ADR 继承并强化其「`words` 表只能由人订正」的边界，见 Decision 8；管理页与其 `/admin/dictionary` 互链）、[`adr-024-word-context-dictionary-first-why.md`](adr-024-word-context-dictionary-first-why.md)（本 ADR 记录的「上下文释义 / `why`」快照即其产物；**本 ADR 不改其返回契约**，见 Decision 5 对 provider 的处理）、[`adr-023-sidepanel-unified-history-list-nested-sentence-words.md`](adr-023-sidepanel-unified-history-list-nested-sentence-words.md)（提交入口加在其 `WordCard` 上；原句的取法依赖其「top-level 卡读 `contextSentence`、嵌套卡读所属 `SentenceEntry.sentence`」的结构，见 Decision 2）、[`adr-006-page-word-lookup-in-sidepanel.md`](adr-006-page-word-lookup-in-sidepanel.md)（其镜像进来的卡**没有句子上下文**，决定了表单要按卡的形态降级，见 Decision 2）、[`adr-008-phrase-selection-context-translation.md`](adr-008-phrase-selection-context-translation.md)（短语卡无词典条目，`dictionary_wrong` 分类对其不可用）、[`adr-018-dictionary-lookup-single-metered-seam.md`](adr-018-dictionary-lookup-single-metered-seam.md)（提交/管理端点都**不是查词**，同 ADR-021 显式在计量范围外） |
| **关联代码** | **待实现。** 预期落点——enx-api：新薄包 `feedback/`（model + handler + 限频），`migrations/009_word_feedback.sql`，`enx-api.go` 注册 `POST /api/word-feedback`（`clerkAuth`）与 `/api/admin/feedback*`（`clerkAuth` + `RequireAdmin`）。enx-chrome：`sidepanel/SidePanel.tsx` 的 `WordCard`（入口图标 + 卡内内联表单）、`services/api.ts`、`types/index.ts`。enx-ui：`src/app/(app)/admin/feedback/page.tsx`、`src/components/app/app-nav.ts`、`src/services/api.ts`。另需新增隐私政策 / 服务条款静态页（见「关联清单」）。 |
| **关联清单** | **硬前置**：`docs/tasks/LAUNCH-CHECKLIST.md` 的 **6.2「隐私政策页 + 服务条款页」必须先落地**——本功能是 ENX 第一次持久化「用户正在阅读的内容」，性质与存生词完全不同（见 Decision 7）。无新增外部服务 / 密钥。新增两个 viper 配置项：每日提交上限、自由文本长度上限。 |

---

## Context

### 这个 ADR 是怎么来的（被否决的前身）

最初的想法是**改单词卡的释义展示**：把 AI 上下文释义合并进词典释义——命中的义项用特殊颜色高亮，未命中则把上下文释义前置到同一块里；并在「未命中」时由后台自动记录，供管理员后期丰富本地词典。

评估后**否决了合并展示**：判断「上下文义是否被词典义覆盖」靠字符串匹配不可靠（ECDICT 的 `translation` 是 `n. 秘诀，提示；小费\nvt. 倾斜` 这种多词性长串，单字重合会把高亮打到错误义项上，而**高亮错义项比不高亮更糟**——它用颜色断言了一件假事）；要做对得让模型在同一次调用里把命中的义项**逐字抄回**才能降级成一次 `indexOf`。加上 ECDICT 条目常超 40 字 / 多行（`WordCard` 已有 `dictLong` + Expand），「合并成一行」维持不住；纯颜色编码还会丢掉 `in context` 标签的双重编码。结论：**释义展示维持现状，两种释义继续分行**。

「自动记录未覆盖的上下文释义」也一并否决，理由见 Options A——它被本 ADR 的用户主动提 case 取代。

### 需求

用户在 Side Panel 读到一张单词卡时，可能对释义有三类不同性质的疑问：

1. **词典释义不对**（`words` / ECDICT 的数据问题）；
2. **上下文释义不对**（AI 判断错了）；
3. **两者对不上**，用户看不出是谁错了（这正是 ADR-024 的 `why` 想缓解、但没有完全解决的场景）。

需要给用户一个提 case 的口子，把问题连同证据交到后台，由管理员单独的页面处理。提交时必须告知用户「该词所在的句子会被记录」。

### 现状

- **释义有两个来源、两条订正路径**：词典释义来自 `words` 表 / ECDICT（管理员可通过 ADR-021 的 `/admin/dictionary` 比对两源并 sync）；上下文释义来自 `aitranslate` 的 AI 调用（订正手段是调 prompt 或换 provider）。**两者的处理动作毫无交集**。
- **`words` 是全局共享、且 ADR-021 起「只能由人订正」的缓存**：`fillFromEcdict` 只在本地无行时创建、从不更新；管理员的写操作是唯一的 `UPDATE` 来源。任何「让 AI 静默写入 `words`」的设计都是对该边界的破坏。
- **admin 基建已就位**（ADR-021）：`middleware.RequireAdmin`（`ADMIN_CLERK_USER_IDS` env allowlist）、`(app)/admin/` 子树 + `admin/layout.tsx` 门禁、`NAV_ADMIN` 条件导航、`GET /api/me` 的 `isAdmin`。加第二个 admin 页面几乎零基建成本。
- **ENX 目前不持久化任何用户阅读内容**：生词本存的是「词」，Reader（ADR-019/022）存的是用户自己粘进来的文本。`sentence` 是从用户当前所读页面正文里抓的**第三方内容**，此前只在内存 / 请求里流转，从不落库。
- **`enx-ui` 没有隐私政策 / 服务条款页**，`LAUNCH-CHECKLIST.md:98`（6.2）是已知未办项。
- **AI provider 是单一全局配置**（`sentence-translate.provider`，`aitranslate/factory.go`），不随请求变化，改它要重启 enx-api。
- **单词卡有三种形态**，能提供的证据不同：
  | 卡的来源 | 有词典释义 | 有上下文释义 | 有原句 |
  | --- | --- | --- | --- |
  | 侧边栏句子内查词（ADR-023 嵌套卡） | ✅ | ✅ | ✅（所属 `SentenceEntry.sentence`） |
  | 正文短语查询（ADR-008，top-level） | ❌（`dictionaryStatus: 'none'`） | ✅ | ✅（`contextSentence`） |
  | 正文查词浮层镜像（ADR-006，top-level） | ✅ | ❌（`contextStatus: 'none'`） | ❌ |

### 为什么值得写 ADR

- **ENX 第一次持久化用户正在阅读的第三方内容**。这是一条隐私边界，要连同「存什么、不存什么、存多久、谁能删」一起写死，不能在编码时随手决定。
- **「自动采集 vs 用户主动提交」是一个真实的岔路**，两条路的隐私性质和信噪比差一个量级，理由必须留档，否则以后很容易有人顺手把自动采集加回来。
- **直接压在 ADR-021 立的边界上**：`words` 只能由人订正。本 ADR 要明确「用户报的 case 也只是证据，不是写入源」。
- **有上线时序约束**：功能本身排在上线之后，但它的前置（隐私政策页）在上线清单里，两者的先后关系要写下来。

---

## Options Considered

### A. 信号来源：后台自动采集 vs 用户主动提 case

| 方案 | 做法 | 结论 |
| --- | --- | --- |
| A1. 后台自动采集 | `TranslateWordInContext` 里当 `why` 非空（模型判定上下文义超出词典义）时，best-effort 按 (词, 归一化义) 聚合入库，存原句证据 | **否决。** 两个硬伤：(1) **隐私**——在用户毫不知情的情况下把他正在读的内容写进管理员可见的表，而用户可能在读私人邮件、公司内网文档；(2) **信噪比**——`why` 非空只代表「模型觉得值得解释」，不代表「有问题」，队列会被大量正常的引申义淹没，管理员逐条判断的成本极高 |
| **A2.（采用）用户主动提 case** | 卡上给入口，用户点了才提交，提交前明示将要提交的内容 | 上面两个问题同时解掉：同意是**逐条显式**的；人主动点「这里不对」的信号强得多，队列短、每条都值得看。代价是覆盖率低（大部分用户不会点）——但**低召回的高质量队列 > 高召回的噪声队列**，管理员是单人（ADR-021 的前提），吞吐本来就是瓶颈 |
| A3. 两者并存 | 自动采集打底 + 用户主动提 case 加权 | **否决（至少本期）。** A1 的隐私问题不因为 A2 的存在而消失。真需要覆盖率时见 Revisit |

### B. 提交内容：只收自由文本 vs 必填分类 + 可选文本

| 方案 | 结论 |
| --- | --- |
| B1. 只有一个自由文本框 | 实现最简，但**管理员每条都要自己重新判断这是哪一类问题**。而「词典释义不对」和「上下文释义不对」的处理路径完全不同（前者去 `/admin/dictionary` 比对两源 + sync，后者是调 prompt / 换 provider，跟 `words` 表一点关系没有） |
| **B2.（采用）必填分类 + 可选自由文本** | 分类是队列可分流、可统计的唯一依据，也是「这条 case 该怎么处理」的路由键。自由文本可选、限长 |
| B3. 只有分类、不给文本框 | 省掉了滥用面，但用户想说的「它其实是 XX 意思」恰恰是最有价值的信息 |

### C. 「哪个 provider 出的这条上下文释义」怎么拿到

| 方案 | 结论 |
| --- | --- |
| C1. 给 `POST /translate/word-in-context` 的响应加 `provider` 字段，客户端回显、提交时带上 | 最准确，但要改 ADR-024 刚定下的返回契约 + 四个 provider 的返回路径，为一个运维字段付这个代价不值 |
| **C2.（采用）提交时服务端直接读 `viper.GetString("sentence-translate.provider")` 落库** | provider 是**单一全局配置**、改它要重启 enx-api，所以「查词时的 provider」与「几秒后提交时的 provider」几乎不可能不同。零契约改动。**已知失真**：跨 enx-api 重启的陈旧卡片被提交时会记成新 provider——概率极低，写进 Consequences 接受它 |
| C3. 本期不记 provider | 那就永远看不出「某个 provider 在某类词上系统性犯错」这个模式，而这恰是 `context_wrong` 类 case 唯一能导出的结论 |

### D. 页面 URL 存不存

| 方案 | 结论 |
| --- | --- |
| D1. 原样存完整 URL | **否决。** URL 比句子更容易泄密：query string 里可能有 session token、文档 ID、内网主机名 |
| **D2.（采用）存 origin + path，砍掉 query 与 fragment；且在提交前的清单里显示处理后的结果，用户可取消勾选** | 保留了「这条 case 来自哪类站点」这个对管理员有用的信息，砍掉了绝大部分泄密面，且用户看到的就是实际入库的值 |
| D3. 完全不存 URL | 管理员失去「这是不是某个特定站点的抓取问题」的线索 |

### E. 同意的呈现方式

| 方案 | 结论 |
| --- | --- |
| E1. 一句提示 +「详见隐私政策」链接 | 合规上够了，但用户并不真的知道自己交了什么 |
| **E2.（采用）提交前直接把**实际将要提交的字段**摆出来**（词 / 原句全文 / 处理后的 URL / 两种释义快照 / 分类 / 说明） | 既是更好的 UX，也是更强的知情同意。提交是低频动作，每次都展示不构成负担。隐私政策链接仍然给，作为补充而非主体 |
| E3. 首次提交时一次性同意、之后静默 | 「之后静默」等于把 A1 的问题从后台搬到前台。否决 |

### F. 表单形态：modal vs 卡内内联

| 方案 | 结论 |
| --- | --- |
| F1. modal / 独立弹层 | Side Panel 只有约 400px 宽，modal 在这个宽度里很难排版，且会盖住用户正在看的其他卡 |
| **F2.（采用）在卡片内部内联展开** | 与卡片本身的信息（那两条释义）保持在同一视野里——用户正是在对它们提意见。收起后卡片回到原样 |

### G. 入口按钮的位置

| 方案 | 结论 |
| --- | --- |
| G1. 加在标题行 | 标题行已经排满（`word` + 音标 + 播放 + 查询次数，次数还是 `ml-auto` 顶到右边的），再加会挤 |
| **G2.（采用）卡片右上角、现有 `X`（删除）旁边，同样 hover / focus 才显形** | 复用已有的交互模式与视觉语法，不给密集的卡片增加常驻元素 |

### H. 后端放在哪个包

| 方案 | 结论 |
| --- | --- |
| H1. 塞进 `aitranslate` | **否决。** `aitranslate` 目前对 repo 层零依赖（连计费都是 `TokenLedger` 窄接口注入的），这份干净度值得保住；而且 case 里有一半根本与 AI 无关（`dictionary_wrong`） |
| H2. 塞进 `dictionary` | 同理，它是查词计量 seam，不是用户反馈 |
| **H3.（采用）新建薄包 `feedback/`** | 单一职责：一张表、一个提交端点、三个 admin 端点、一个限频。与两个既有包都不耦合 |

### I. 是否做「管理员回复 / 处理结果通知用户」闭环

| 方案 | 结论 |
| --- | --- |
| I1. 做 | ENX 没有任何站内通知 / 邮件基建，这是另一个数量级的工程 |
| **I2.（采用）不做** | 提交后给「已收到」即可。见 Out of Scope 与 Revisit |

---

## Decision

1. **入口（enx-chrome，Side Panel only）**
   - `WordCard` 右上角在现有 `X`（删除）旁加一个 hover / focus 才显形的「报告问题」图标（G2），点击在**卡片内部内联展开**表单（F2），再点或提交后收起。
   - **只做 Side Panel 的单词卡，不做正文里的查词浮层**（`WordPopover`）：浮层只有词典释义、下次查词即被替换、也没有捕获句子上下文，形态不适合承载表单。

2. **表单字段与按卡形态降级（enx-chrome）**
   - 必填分类（单选）：`dictionary_wrong`（词典释义不对）/ `context_wrong`（上下文释义不对）/ `mismatch`（两者对不上）/ `other`。
   - 可选自由文本，限长（viper 配置，建议 500 字符），前端与服务端都校验。
   - **按卡的形态裁剪可选分类**（见 Context 的三表态）：短语卡（ADR-008，无词典条目）不提供 `dictionary_wrong`；正文浮层镜像卡（ADR-006，无上下文释义、无原句）只提供 `dictionary_wrong` / `other`，且提交内容里没有 `sentence`。
   - 原句取法沿用 ADR-023 的结构：top-level 卡读 `contextSentence`，嵌套卡读所属 `SentenceEntry.sentence`。

3. **提交前的知情同意（enx-chrome）**
   - 提交按钮上方直接列出**实际将要提交的字段值**（E2）：词 / 原句全文 / 处理后的页面地址 / 词典释义快照 / 上下文释义快照 / 分类 / 说明。
   - 页面地址一项**单独给一个可取消的勾选框**；勾选时提交的是 **origin + path**，query 与 fragment 在**客户端**就砍掉（D2），展示的就是砍完的结果。
   - 附隐私政策链接作为补充说明，而非同意的主体。

4. **提交端点（enx-api，新包 `feedback/`）**
   - `POST /api/word-feedback`，走 `clerkAuth`（必须登录），**不走 `dictionary.MeterLookup`**——这不是查词，同 ADR-021 显式在 ADR-018 的计量范围外。
   - 服务端校验：分类在枚举内、自由文本长度、原句与释义快照长度上限、`english` 非空。
   - 限频与去重（防刷）：每用户每日提交上限（viper 配置，建议 20）；同一 `(user_id, english, sentence, category)` 在短窗口内重复提交视为同一条，返回成功但不新增行。超限返回 `429`。
   - 成功返回 `{"success": true}`，客户端显示「已收到」。**不返回 case id、不做任何后续查询接口给普通用户**（见 Decision 9）。

5. **存储（enx-api，`migrations/009_word_feedback.sql`）**
   - 新表 `word_feedback`，沿用仓库既有约定（TEXT UUID 主键、Unix 毫秒整数时间戳）：

     | 列 | 说明 |
     | --- | --- |
     | `id` | TEXT PK，UUID |
     | `user_id` | TEXT，**本地用户身份** `users.Id`（不是 Clerk id） |
     | `english` | TEXT，被报告的词 / 短语 |
     | `category` | TEXT，四个枚举值之一 |
     | `comment` | TEXT，用户自由文本，可空 |
     | `sentence` | TEXT，原句；ADR-006 镜像卡为空 |
     | `source_url` | TEXT，origin + path；用户取消勾选则为空 |
     | `dictionary_chinese` | TEXT，**提交当时卡上显示的**词典释义快照 |
     | `context_chinese` | TEXT，提交当时的上下文释义快照 |
     | `context_why` | TEXT，提交当时的 `why` 快照（ADR-024） |
     | `ai_provider` | TEXT，服务端在**提交时**读 `sentence-translate.provider` 落库（C2） |
     | `status` | TEXT，`new` / `accepted` / `rejected` / `fixed`，默认 `new` |
     | `admin_note` | TEXT，管理员处理备注，可空 |
     | `created_at` / `updated_at` | INTEGER，Unix 毫秒 |

   - **存快照而不是实时 join**：词典释义与上下文释义在提交后都可能被改（管理员 sync、换 provider），快照才是「用户当时看到的、他有意见的那个东西」。
   - 索引：`(status, created_at)` 供队列列表用，`english` 供按词聚合看。

6. **管理页与 admin 端点（enx-ui + enx-api）**
   - 挂在 ADR-021 已建好的 `(app)/admin/` 子树下：新增 `src/app/(app)/admin/feedback/page.tsx`，`app-nav.ts` 的 `NAV_ADMIN` 加一项。门禁完全复用（前端 `admin/layout.tsx` + 服务端 `RequireAdmin`）。
   - enx-api（`clerkAuth` + `RequireAdmin`，不计量）：`GET /api/admin/feedback`（按 `status` 过滤 + 分页）、`PATCH /api/admin/feedback/:id`（改 `status` / `admin_note`）、`DELETE /api/admin/feedback/:id`（见 Decision 7 的删除路径）。
   - **每条 case 给一个直达 `/admin/dictionary?word=<english>` 的链接**——管理员从「有人报了 tips」一键跳到 ADR-021 的「`words` vs ECDICT 比对 + sync」。两个 admin 功能是**组合**关系，不是并列摆着。
   - 处理动作照 `logger.Infof` 记审计（同 ADR-021 / `GrantCredits`），本期不做结构化审计表。

7. **隐私（硬约束）**
   - **`LAUNCH-CHECKLIST.md` 6.2（隐私政策页 + 服务条款页）是本功能的硬前置**，必须在提交 UI 上线之前落地，且政策文本要明写：提交 case 时会记录用户所读页面的**该句原文**与页面地址，用途仅限管理员排查与改进本地词典。
   - **删除路径**：管理员可删单条（`DELETE`）；用户销号时按 `user_id` 级联删除其所有 `word_feedback` 行。
   - **不做**跨用户的内容再利用：这些句子只用于管理员 review，不进任何训练 / 统计导出。

8. **绝不自动回写 `words`（承接并强化 ADR-021）**
   - 用户报的 case **只是证据**，不是写入源。系统的任何路径都不得因为一条 feedback 而修改 `words` 表。
   - 管理员认可某条 case 后，走的仍是 ADR-021 既有的写操作（ECDICT sync，或未来的通用编辑端点），是一次**独立的、显式的**管理员动作。
   - 因此本期**不给** `word_feedback` 加「建议的正确释义」这类可直接 apply 的字段——那会诱导出一键回写。

9. **用户侧不做闭环；管理员侧与页面上报对齐通知**：不回执用户、不回复、用户也查不到自己提过的 case 列表（I2）。**管理员**在新写入成功时收到邮件通知——与 [adr-010](adr-010-x-tweet-page-support.md) Decision 12–13 同一套 Resend / `email/` 通道（认证邮件已废弃），本 ADR 实现时复用，不另建发送栈。术语用**释义反馈（definition feedback）**，勿与**页面上报（page report）**混称。

10. **实施顺序**（功能整体排在**工具正式上线部署之后**）
    1. enx-api：表 + `POST /api/word-feedback` + 限频去重 + 管理员通知 + 测试（纯后端，可单测，无用户可见变化）；
    2. 隐私政策 / 服务条款页（LAUNCH-CHECKLIST 6.2）——**必须在第 3 步之前**；
    3. enx-chrome：入口 + 内联表单 + 同意清单；
    4. enx-ui：`/admin/feedback` 队列页 + 三个 admin 端点。

    每步独立可验证、可回滚。第 1、4 步纯 enx-api / enx-ui，第 3 步纯 enx-chrome。

---

## Rationale

- **A2 而非 A1**：自动采集的两个硬伤——无知情的隐私采集、以及「`why` 非空 ≠ 有问题」带来的噪声——恰好都被「用户主动点」解掉。覆盖率确实低，但 ADR-021 的前提是**单人管理员**，队列吞吐才是真瓶颈；一个短而准的队列比一个长而糙的队列有用得多。
- **B2（必填分类）**：`dictionary_wrong` 与 `context_wrong` 的修复路径在系统里是**两条完全不相交的线**（`words`/ECDICT vs prompt/provider）。让用户在提交时花两秒选一下，省掉管理员每条重新判断的成本，也让「某类问题最近变多了」变成可观测的。
- **C2（服务端读全局 provider）**：provider 是重启才改的单一配置，查词与提交之间隔着秒级时间，失真概率极低；用一个已知的、写在 Consequences 里的小失真，换掉「改 ADR-024 刚定的返回契约 + 四个 provider 跟进」的成本，是划算的。
- **D2（砍 query/fragment）**：URL 的泄密面比句子更大且更隐蔽（token、文档 ID、内网主机名），而管理员真正需要的只是「哪类站点」。砍掉是低成本高收益。
- **E2（摆出实际内容）**：既然要征得同意，让用户看见实际提交的字符串，比任何措辞的警告都更接近真正的知情同意；提交是低频动作，成本可忽略。
- **存快照而非 join**：用户有意见的是**他当时看到的那两行字**。管理员 sync 过 `words` 之后再去 join，看到的就不是被投诉的对象了，case 会变得无法复现。
- **H3（新建薄包）**：`aitranslate` 对 repo 层零依赖是 ADR-014 以来刻意维持的，且 `dictionary_wrong` 类 case 跟 AI 毫无关系——放进去在概念上也是错的。
- **Decision 8（不给「建议释义」字段）**：这是对 ADR-021 边界的**主动保护**。一旦表里有一个「用户认为正确的释义」字段，「加个按钮一键 apply」就只有一步之遥，而那正好把 `words` 从「人订正的缓存」变回「可被外部输入静默污染的缓存」。宁可让管理员多打几个字。

---

## Consequences

### Positive

- 用户第一次有了向系统反馈的通道；此前释义不对只能忍着或弃用。
- 管理员拿到的是**带完整证据的、人工确认过的**问题队列（原句 + 两种释义快照 + 分类 + provider），而不是需要自己复现的模糊报告。
- 与 ADR-021 的词典维护页**组合**：case → 一键跳到该词的两源比对 → sync，是一条完整的运维闭环。
- `ai_provider` + `category` 让「某个 provider 在某类词上系统性犯错」第一次可观测。
- 隐私上是**逐条显式同意 + 所见即所交**，比自动采集干净得多，也更经得起 Web Store 审核与用户质询。
- 复用 ADR-021 的全部 admin 基建，新增成本主要在表和表单本身。

### Negative

- **覆盖率低**：绝大多数遇到问题的用户不会点。这是 A2 换隐私与信噪比付出的代价，接受。
- **ENX 从此持有用户所读的第三方内容**：即使逐条同意，也是一类新的数据资产与责任（存储、删除、政策表述）。
- **`ai_provider` 有已知失真**：若 enx-api 在用户查词与提交之间重启且换了 provider，记录的是新 provider。概率极低，不做补偿。
- **多一个需要人处理的队列**：单人管理员，队列没人看就等于没做。见 Revisit。
- **卡片交互面变大**：右上角从一个图标变两个，hover 区域更密；窄面板里内联表单展开会把下方卡片推下去。
- **隐私政策页成了功能的阻塞项**：6.2 没做完，提交 UI 就不能上线。
- **自由文本是滥用面**：限长 + 限频只能压低，不能消除；单人管理员时代可接受。

### Mitigation

- 队列无人处理的风险：管理页默认只显示 `status = new`，并在 `NAV_ADMIN` 项上显示未处理数量，让积压可见。
- 存储增长：本期不设自动清理；`status` 非 `new` 的行由管理员手动删。见 Revisit。
- 卡片拥挤：入口图标沿用 `X` 的 hover-only 显形，不引入常驻元素；表单展开时其余部分不动，收起即复原。

---

## Out of Scope（本次不做）

- **后台自动采集「上下文释义未被词典覆盖」的样本**（Options A1）。
- **管理员回复 / 处理结果通知用户 / 用户查看自己提交的 case 列表**（Options I）。
- **`word_feedback` 里存「用户建议的正确释义」，以及任何形式的一键 apply 到 `words`**（Decision 8）。
- **正文查词浮层（`WordPopover`）上的提交入口**。
- **对释义展示方式的任何改动**：in-context 与词典释义继续**分行**显示，合并高亮方案已否决（见 Context）。
- **`enx-ui` 侧（Reader 等）的反馈入口**：本期只有 enx-chrome 的 Side Panel。
- **结构化审计表**：管理员动作靠 `logger.Infof`，同 ADR-021。
- **数据保留策略 / 自动过期清理**。
- **举报以外的通用反馈**（「这个功能有 bug」之类）——本 ADR 只覆盖**针对某个词的释义**的反馈。

---

## Revisit Trigger

- **用户主动提交量太低、拿不到有用样本**：重新评估 A1/A3——但重开时必须连同「如何取得知情同意」一起解决（例如设置项里的显式 opt-in），不能退回静默采集。
- **队列量大到单人处理不过来**：考虑按 `english` 聚合展示、批量操作、或引入第二个管理员（那就同时触发 ADR-021 的角色系统 Revisit）。
- **`category` 统计显示某一类长期占绝对多数**：`context_wrong` 占多 → 去改 prompt / 换 provider（可能推翻 ADR-024 的某些细节）；`dictionary_wrong` 占多 → ECDICT 数据质量本身要处理，可能需要 ADR-021 Out of Scope 里那个「通用词条编辑」端点。
- **需要把 case 与修复结果关联**（「这条 case 是被哪次 sync 修掉的」）：那时再考虑结构化审计表。
- **法务 / 合规要求升级**（如面向欧盟用户）：保留期限、用户自助导出与删除、DPA 等都要正面回答，单独立 ADR。
- **要给 `enx-ui` 或其他客户端也加反馈入口**：提交端点的形状可能要泛化（`source` 列区分来源）。
