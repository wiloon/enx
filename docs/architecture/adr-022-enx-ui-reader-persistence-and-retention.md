# ADR-022：enx-ui Reader 粘贴文本落库——推翻 ADR-019 决策 1（一次性不持久化），改为存进 enx-api 数据库、向用户承诺保留 7 天后自动删除、单用户最多保留 50 篇（超出淘汰最旧）、单次输入上限 2 万字符，并新增「我的文档」列表可回看 / 重开 / 删除

| 字段 | 值 |
| --- | --- |
| **状态** | Accepted — 2026-09-15。已实现：enx-api `reader` 包（`CreateDocument`/`ListDocuments`/`GetDocument`/`UpdateDocument`/`DeleteDocument`/`PurgeExpired`，31 个测试）+ 5 个 `/api/reader/documents` 路由（含 Addendum 1 的 `PUT` 原地编辑、Addendum 2 的 `preview` 字段）+ `runReaderDocumentCleanup` 定时清理协程；enx-ui reader 页支持新建 / 原地编辑（`documentId` 跟踪 + 「New」按钮区分「另起一篇」和「继续编辑」）、`textarea` 2 万字符上限、`/reader/history` 列表页（按最后编辑时间排序、每行显示内容预览 + 时间、回看 / 重开 / 删除）、阅读态顶栏常驻「My Documents」入口，105 个前端测试全绿，`next build` 通过。 |
| **日期** | 2026-09-15 |
| **关联 ADR** | [`adr-019-enx-ui-paste-text-reader-web-to-extension-enable.md`](adr-019-enx-ui-paste-text-reader-web-to-extension-enable.md)（本 ADR 是它 Revisit Trigger 里明确预留的「要持久化 / 多篇文档：Option E2」——推翻其 Decision 1「一次性，不持久化」和 Consequences 里记的隐私论证「粘贴的文本只存在于当前标签页的内存里」；reader 页本身的渲染 / 查词 / 扩展通知机制不变，仍照 ADR-019 走）、[`adr-018-dictionary-lookup-single-metered-seam.md`](adr-018-dictionary-lookup-single-metered-seam.md)（查词配额——本 ADR 明确「存文档」不占用它的配额口径，两者是不同的计量维度）、[`adr-015-cognito-to-clerk-auth-migration.md`](adr-015-cognito-to-clerk-auth-migration.md)（文档归属用户靠 Clerk 会话识别，复用现有登录态） |

---

## 已确认的决策（2026-09-15，用户确认）

1. **落库，采用 ADR-019 当初推迟的 Option E2**：新增「我的文档」列表，用户可以看到最近粘贴过的文章、点击重新打开继续阅读 / 查词，而不是每次都要重新复制粘贴。
2. **保留期限 7 天，这是对用户的产品承诺**，不是内部实现细节——意味着 7 天后要**真的删除**，不能只是「查不到但盘上还在」。
3. **单次粘贴文本长度上限 2 万字符**（约 3,000–4,000 英文单词，量级参考 DeepL / Google 翻译单次请求上限），服务端强校验。
4. **单用户最多保留 50 篇文档，超出时淘汰最旧的一篇**——跟 7 天 TTL 是两道独立的限制，不是二选一：TTL 保证「多久」（哪怕只存过一篇也保证 7 天后必删），数量上限保证「多少」（不管存多频繁，占用有天花板）。
5. **（2026-09-15 追加）已保存的文档支持原地编辑**：新增 `PUT /api/reader/documents/:id`。见下方 Addendum。

---

## Addendum（2026-09-15）：已保存文档支持原地编辑

### 触发原因

上线后走查发现一个交互问题：reader 页的「Edit text」按钮回到输入态、改完文字再点「Read」，无论这段文字是不是从「我的文档」打开的已保存文档，点击后总会**新建**一条记录——`POST` 是这个页面唯一的写路径，原文档原样留在列表里，形成一条几乎重复的记录。这跟「Edit」这个按钮名字暗示的「修改当前文档」直接矛盾，用户会以为在改原文档，实际上留了两条。

### Option F：这种「打开已保存文档 → 编辑 → 再提交」该怎么处理

| 方案 | 说明 | 结论 |
| --- | --- | --- |
| **F1.（采用）支持真正的原地编辑**：新增 `PUT /api/reader/documents/:id`，编辑已保存文档再提交时更新同一条记录，不新建 | 用户明确选择这个方向。代价：后端多一个端点 + 前端要跟踪「当前文章对应哪个文档 ID」；`reader` 包不再是纯 create-only，本 ADR 的「不可变」立场（Decision 1 隐含、Out of Scope 未明确写但设计上如此）被推翻，需要显式记录 |
| F2. 维持不可变，只改按钮文案（比如把「Edit text」改成「新建 / 重新粘贴」，文案说明会存成新文档） | 后端不用动，改动最小 | **否决**（用户选择）：不解决「编辑同一篇文章要反复迭代」时列表被灌满近似重复记录的问题，只是不再误导 |

### Decision（补充）

1. **`reader.UpdateDocument(ctx, userID, id, content, now)`**：校验 `content` 非空且 ≤ 20,000 字符（与 `CreateDocument` 同一套校验）；按 `id + user_id + expires_at > now` 定位文档，找不到（不存在 / 不属于该用户 / 已过期）返回 `gorm.ErrRecordNotFound`；替换 `content`，**7 天保留期从这次编辑的时间重新计算**（`expires_at = now + 7d`）——编辑是一次新的活跃行为，没理由不延长它的生命周期。**不占用** `MaxDocumentsPerUser` 淘汰逻辑：这不是新建行。
2. **`PUT /api/reader/documents/:id`** 挂在跟其它三个端点一样的 `apiGroup`（Clerk auth）下，404 语义跟 `GetDocument` 一致。
3. **`ListDocuments` 排序改成按「最后编辑时间」倒序**（新增 `updated_at` 列，`CreateDocument` 时等于 `created_at`，`UpdateDocument` 时刷新）——编辑一篇旧文档会让它重新跳到列表顶端，符合「最近动过的排前面」的直觉。**踩坑记录**：`sqlitex.ReaderDocument` 这个字段特意命名成 `LastEditedAt`（映射到 `updated_at` 列）而不是 `UpdatedAt`——gorm 对结构体字段名字面是 `UpdatedAt` 的字段有约定式的自动行为：每次 `Save`/`Update` 都会**无条件**拿 gorm 自己算的当前时间去覆盖调用方设置的值，不管调用方传的 `now` 是多少。这个仓库到处靠显式传 `now time.Time` 做可测试的确定性时间控制，撞上这个约定会在测试里产生诡异的、貌似正确实则被悄悄替换成真实墙钟时间的值——已经在 `TestListDocumentsOrdersEditedDocumentToTheTop` 这个用例上踩过一次，改字段名后解决。
4. **enx-ui reader 页**：`documentId` 状态跟着「当前文章对应哪篇已保存文档」走——首次提交（`documentId` 为空）走 `POST` 建新文档并记下返回的 id；再次提交（`documentId` 有值，无论是刚创建的还是从「我的文档」打开的）走 `PUT` 更新同一篇。新增一个跟「Edit text」并列的**「New」按钮**，清空 `documentId` 和草稿，才是真正「另起一篇」的入口——这直接解决了用户反馈的第二个问题「要粘贴全新文本得先点 Edit，容易被当成编辑当前文档」：现在 Edit 名副其实地编辑当前文档，New 才是新起一篇。
5. **阅读态顶部常驻「My Documents」入口**（另一个用户反馈：阅读态下要切菜单才能回列表）：跟「Edit text」「New」并列放在阅读态顶栏，不需要先回输入态再点。

### Consequences（补充）

| 风险 | 缓解 |
| --- | --- |
| **编辑会重置 7 天 TTL，理论上可以靠「定期编辑一下」把文档永久留着**，削弱本 ADR 版权论证依赖的「内容不会长期存在」前提 | 参照 ADR-018 决策 8 同样的推理：这需要用户手动、逐篇、反复操作，摩擦本身就是防线，不是一个值得现在就防的真实滥用信号；真出现再回来加限制（比如编辑次数上限） |
| **`reader` 包从「create-only 不可变」变成可变**，任何以后读这份 ADR 的人看到 Decision 1 的免责论证（「一次性」「不可变」）会跟这个 Addendum 矛盾 | 本 Addendum 就是显式记录这次推翻的原因和时间，不悄悄改 |

---

## Addendum 2（2026-09-15）：「我的文档」列表加内容预览

### 触发原因

Decision 2 当时把预览写成可选项（「不必每条都带全文，可用首行 / 前 N 字符做预览」），第一版实现图省事只展示了日期，用户走查反馈：列表里一排全是时间戳，看不出哪篇是哪篇，得逐条点开才知道内容，体验不好。

### Decision（补充）

- `DocumentSummary` 新增 `Preview string`：取 `content`，`strings.Fields` + `strings.Join(" ")` 把所有空白（含段落间的换行）折叠成单行，再按 rune 截到 100 个字符，超出加 `…`。`previewMaxLength = 100` 是个经验值，够看清一行内容，不需要用户名字段之外单独存一份「标题」。
- `GET /api/reader/documents` 的每条返回里加 `preview` 字段；`ListDocuments`/`GetDocument` 的过滤和排序逻辑不变。
- enx-ui 「我的文档」列表每一行改成两行展示：预览文字（`truncate` 单行省略号兜底超宽情况）在上，最后编辑时间在下；预览为空（理论上不会，`content` 非空是 `CreateDocument` 的前置校验，但仍处理这个边界）时显示「Untitled」。

### Consequences（补充）

- 预览是从 `ListDocuments` 已经查出来的整行 `content` 现算的，不是数据库层面的 `SUBSTR`——`reader_documents` 单表最多 50 篇 × 2 万字符，一次查询顶多 1MB，对 SQLite 而言可忽略，没必要为了省这点数据量在 SQL 里做截断。

---

## Context

### ADR-019 当时明确否决了持久化

ADR-019 Decision 1（Option E1）：「一次性，不持久化。提交后纯客户端渲染，不落库、不加 enx-api 端点、URL 不带正文。刷新 / 离开即丢。『我的文档』式回看留作后续。」并在 Revisit Trigger 里写明：「要持久化 / 多篇文档：Option E2，加 enx-api 端点 + 表 + UI。」——本 ADR 就是这个「后续」。

reader 页今天（`enx-ui/src/app/(app)/reader/page.tsx`）纯客户端 state：`draft` → 提交 → `article` state → 渲染进 `<article id="enx-reader-article">`，全程不碰网络，刷新即丢。

### 为什么值得写 ADR（三个判据都成立）

- **难以反悔**：一旦开始把用户粘贴的文本内容存进数据库，就有了一个必须兑现的保留 / 删除承诺；且用户粘贴的可能是受版权保护的整篇文章，哪怕只存 7 天，也比「内存里转瞬即逝、从不落盘」多了一层持久化存储的合规面。这个决定要收回去（比如真做不到按时删除）代价不低。
- **反直觉**：任何读过 ADR-019 的人会看到「决策 1：一次性，不持久化」，如果不写 ADR 记录这次推翻，后来者看到代码里多出一张表、一组端点会困惑「这不是明确决定不做的吗？」。
- **真实取舍**：7 天保留期到底怎么强制执行（惰性过滤 vs 真删除 vs 两者都要）、schema 怎么设计、2 万字符上限校验放在前端还是后端、要不要防刷（单用户狂刷创建）——每个都有多个合理选项。

---

## Options Considered

### A. 7 天保留期怎么强制执行

| 方案 | 说明 | 结论 |
| --- | --- | --- |
| **A1.（采用）惰性过滤 + 真删除双保险**：读路径（list / get）按 `expires_at` 过滤已过期文档；同时进程内起一个定时 goroutine（如每小时一次）执行 `DELETE FROM reader_documents WHERE expires_at < now`，物理清掉过期行 | 仓库里唯一的现有先例（`sessions` 表的 `ExpiresAt`，见 `middleware/session.go`）**只做惰性过滤，从不真删**——但那是「会话失效」这种纯内部状态，没人承诺过要删除会话数据。这次「保存 7 天」是**对用户的明确承诺**，字面意思就是「7 天后不再存在」，只隐藏不删除不满足这个承诺。真删除 goroutine 复用 `enx-api.go` 已有的 `go func(){...}()` 启动模式（目前只跑了一个优雅关闭的 goroutine），是这个仓库**第一个**真正的后台清理任务 |
| A2. 只惰性过滤，不真删除 | 跟 `sessions` 的先例一致，改动最小 | **否决**：不满足「7 天后删除」的字面承诺，数据仍留在磁盘上 |
| A3. 只做真删除（定时 goroutine），不加惰性过滤 | 省一个 `WHERE expires_at > now` 条件 | **否决**：如果清理 goroutine 挂掉或在重启窗口内没跑，list 接口会把已经超过 7 天的文档展示出来。双保险成本很低（一行 WHERE），没理由不加 |

### B. Schema 放哪

| 方案 | 说明 | 结论 |
| --- | --- | --- |
| **B1.（采用）新表 `reader_documents`**：`id`、`user_id`、`content TEXT`、`created_at`、`expires_at`，走 `utils/sqlitex` 现有的 `gorm.AutoMigrate` 模式（照抄 `Word` / `UserDict` 的写法，加进 `AutoMigrate(...)` 调用列表） | 跟现有 `Word`、`UserDict`、`Session` 同一套 ORM / 建表方式，不引入新工具链 | `expires_at` 在写入时直接算好（`created_at + 7d`），不是查询时动态算——列表 / 详情接口的过滤条件和清理 goroutine 的删除条件共用同一列，逻辑简单 |
| B2. 复用 `sessions` 表加字段 | 省一张表 | **否决**：语义不搭，`sessions` 是登录会话，不是用户内容 |

### C. 2 万字符上限校验放哪

| 方案 | 说明 | 结论 |
| --- | --- | --- |
| **C1.（采用）服务端强校验**：`POST /api/reader/documents` 创建时校验 `len(content) > 20000` → 拒绝（400），前端 `textarea` 同步加 `maxLength` + 字数提示，纯 UX 辅助 | 长度限制是防滥用 / 控制存储和渲染成本的**安全边界**，不能只放前端 | |
| C2. 只在前端限制 | 改动更少 | **否决**：绕过前端直接打 API 可以提交任意长度 |

### D. 除了 TTL，要不要再加一个单用户可存文档数上限

| 方案 | 说明 | 结论 |
| --- | --- | --- |
| **D1.（采用）单用户最多保存 50 篇，写入时淘汰最旧**：`POST` 创建前查当前用户未过期文档数，若 ≥ 50，先删掉 `created_at` 最早的一篇，再插入新的 | TTL 和数量上限管的是两件不同的事：TTL 保证「多久」（7 天后必删，哪怕用户只存过一篇也生效），数量上限保证「多少」（不管存多频繁，单用户占用有天花板）。50 篇 × 2 万字符 ≈ 1MB，存储量级可忽略，但能挡住脚本式刷量；判断逻辑复用已有的 `POST` 写路径，不需要额外的定时任务或配额表 |
| D2. 只有 TTL，不加数量上限（本 ADR 最初的方案） | 改动最小 | **否决**：TTL 窗口（7 天）内如果没有创建速率限制，短时间内狂刷创建不受控——虽然单篇成本不高，但完全没有上限终归是个口子 |
| D3. 只有数量上限，不要 TTL——「存够 N 篇后淘汰最旧」当唯一的保留机制 | 免维护一个定时清理 goroutine | **否决**：数量上限只在「超过 N 篇」时才触发淘汰，一个不活跃用户存 1 篇文档、之后再也不存，这篇文档**永远不会被淘汰**——不满足「7 天后自动删除」的承诺，也削弱版权论证（论证前提就是「内容不会长期存在」）。两个机制不能互相替代 |

### E. 「我的文档」列表 UI

| 方案 | 说明 | 结论 |
| --- | --- | --- |
| **E1.（采用）新增列表页**，点击某篇文档后**复用 ADR-019 既有的 reader 阅读态渲染路径**（把存的 `content` 当成 `draft` 提交进去，走一样的分段渲染 + 扩展通知），不新造第二套渲染逻辑 | 渲染 / 查词逻辑只有一份，符合 ADR-019「reader 页零查词代码、全部复用 enx-chrome」的既有原则 | 具体路由名（如 `/reader/history`）、组件结构留给实现阶段；本 ADR 只定行为契约：列表按 `created_at` 倒序、展示未过期文档、可删除 |

---

## Decision

1. **enx-api**：新表 `reader_documents`（`id`、`user_id`、`content`、`created_at`、`expires_at = created_at + 7d`），走 `sqlitex.AutoMigrate` 现有模式。
2. **enx-api**：新端点（挂在既有 Clerk 会话中间件之后，只认当前登录用户自己的文档）：
   - `POST /api/reader/documents`：创建，校验 `content` 非空且 ≤ 20,000 字符，超限返回 400；创建前查当前用户未过期文档数，若 ≥ 50，先删除 `created_at` 最早的一篇（淘汰最旧），再插入新文档。
   - `GET /api/reader/documents`：列出当前用户未过期（`expires_at > now`）的文档，按 `created_at` 倒序，返回列表用的轻量字段（不必每条都带全文，可用首行 / 前 N 字符做预览）。
   - `GET /api/reader/documents/:id`：取单篇全文，校验属于当前用户且未过期，否则 404。
   - `DELETE /api/reader/documents/:id`：用户手动删除。
3. **enx-api**：新增一个定时清理 goroutine（复用 `enx-api.go` 里已有的 `go func(){...}()` 启动模式），周期性（如每小时）执行 `DELETE FROM reader_documents WHERE expires_at < now`，是本仓库第一个真正的后台清理任务。
4. **enx-ui**：reader 页提交时，除了 ADR-019 既有的本地渲染 + 扩展通知（不变），额外调 `POST /api/reader/documents` 落库；`textarea` 加 `maxLength={20000}` + 字数提示。新增文档列表页，调 `GET` 列表 / 单篇 / `DELETE`，点击某篇后复用现有 reader 渲染路径打开。
5. **不做**：阅读进度 / 书签、文档分享或公开链接、更细粒度的按天创建速率限流（见 Revisit Trigger）、富文本 / HTML 结构保留（ADR-019 已定，维持不变）。

---

## Consequences

### Positive

- 用户可以回看 / 重开最近 7 天内粘贴过的文章，不用每次重新复制粘贴，为将来「跨端继续阅读」打基础。
- 渲染 / 查词逻辑复用 ADR-019 既有路径，没有第二份实现。

### Negative / 风险

| 风险 | 缓解 |
| --- | --- |
| **推翻了 ADR-019 记录的隐私立场**（「粘贴的文本只存在于当前标签页的内存里，不进 URL、不进后端、不落库」）——现在文本进了数据库，哪怕只保留 7 天 | 本 ADR 显式记录这次推翻；需要在产品文案（reader 页 / 隐私政策）里明确告知「粘贴的文本会保留 7 天用于回看，之后自动删除」，不能悄悄改变承诺 |
| **版权 / 合规面变大**：用户可能粘贴受版权保护的整篇文章，存进自己账号下的数据库 7 天 | 保留期短（7 天）、只有文档所有者能读取（按 `user_id` 过滤）、到期真删除；这属于用户自己的学习素材存储，类比 Pocket / Instapaper 等阅读工具的常见做法 |
| **本仓库第一个真正的后台清理 goroutine**——如果它没跑起来或挂掉，过期文档不会被真删（惰性过滤能兜住「用户看不到」，但盘上数据还在，不满足承诺） | 需要日志 / 监控确认清理任务在跑；见 Revisit Trigger |
| **2 万字符上限是经验值**（参考 DeepL / Google 翻译单次上限量级），没有基于真实用户粘贴长度的数据 | 见 Revisit Trigger，上线后观察实际粘贴长度分布再调整 |
| **50 篇上限触发淘汰时会悄悄删掉用户还想看的旧文档** | 上限设得比正常用量宽松（7 天内正常阅读节奏很难攒到 50 篇），产品文案在文档列表里说明「最多保留最近 50 篇」，淘汰前不额外提示（跟「保留 7 天」一样是既定规则，不是异常） |

### Revisit Trigger

- **用户反馈 2 万字符经常不够用**（比如想粘整章小说）：重新评估上限；同时要重新看 reader 页的长文渲染 / 分页体验（ADR-019 的 `READER_ADAPTER.minTextLength: 1` 当时没考虑过长文本）。
- **50 篇总量上限挡不住的滥用**（比如短时间内高频刷创建、每次都把刚存的最旧一篇挤掉）：需要在总量上限之外再加按天的创建速率限流，直接照抄 ADR-018 `billing/quota.CheckAndIncrementLookup` 的原子 upsert 模式。
- **50 篇上限被证明偏离真实用量**（正常用户经常触发淘汰，或者远远用不到）：根据实际数据调整这个数字。
- **需要「记住读到哪」而不只是重新打开全文**：现在的 `reader_documents` 表没有阅读进度字段，需要新设计。
- **清理 goroutine 被证明不可靠**（过期文档没被真删）：换成 homelab 层面的定时 CronJob，而不是进程内 ticker。

---

## Out of Scope（本次不做）

- 阅读进度 / 书签。
- 长文分页 / 渲染性能优化。
- 按天的创建速率限流（Option D 只做总量上限，不做按天限流，见 Revisit Trigger）。
- 文档分享 / 公开链接。
- 富文本 / HTML 结构保留（ADR-019 已定，维持不变）。
