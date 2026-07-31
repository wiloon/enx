# TASK-SPEC: enx-ui 雅思词库掌握度看板

| 字段 | 值 |
| --- | --- |
| **状态** | Draft — 2026-07-30（待 Review；词库数据源未定前不可开始 §7 步骤 2 及之后的实施） |
| **类型** | SDD Task Spec（Spec 驱动实现；实现前以本文为准，实现后同步更新状态与验收清单） |
| **目标** | 让登录用户在 `enx-ui` 查看自己在"雅思核心词"词库上的掌握进度：总览统计（总词数/已掌握/未掌握/重点复习/未接触）、词表明细（按状态筛选、按查询次数或字母排序、分页）、掌握率历史趋势曲线 |
| **非目标** | 不做 Web 端标记/编辑入口（标记仍只在 `enx-chrome` 完成，本次是纯只读看板）；不做雅思之外的其它词库（CET4/6、托福等），但 schema 按通用框架设计以便后续复用；不改变现有 `POST /api/mark` 行为和 `enx-chrome` 侧代码；不做词库内容的后台管理界面（新增/编辑词库由一次性导入脚本完成，不做 CRUD UI）；不做"阅读障碍"独立状态（维持现有二态） |
| **触发原因** | 产品需求：内置雅思词库，判断用户对雅思备考词汇的掌握程度和进度 |
| **关联背景** | [`ADR-003: 雅思词库掌握度追踪的数据模型设计`](../architecture/adr-003-ielts-wordlist-mastery-model.md)；本 Spec 是该决策的落地实施计划 |

---

## 0. 前置阻塞项（实施前必须解决）

雅思词库的具体数据来源尚未确定——用哪个词表版本、词量多大、字段是否包含词性/难度分级。**在此确认之前，不要开始 §7 步骤 2（数据库迁移）及之后的任何步骤**，因为表结构里 `word_lists`/`word_list_memberships` 的导入脚本设计依赖词库源数据的具体格式（CSV？纯文本词表？是否自带音标/释义？）。§7 步骤 1（Spike：确认 ECDICT 数据源是否已含考试标签）可以在词库数据源确认前先做。

---

## 1. 背景与动机

详见 [ADR-003](../architecture/adr-003-ielts-wordlist-mastery-model.md) 的 Context/Decision。简述：`user_dicts` 表已经具备逐词的查询次数（`query_count`）和掌握标记（`already_acquainted`），但项目里完全没有"词库"概念，也没有任何 Web 端看板。ADR-003 决定新增通用的 `word_lists`/`word_list_memberships` 表建模词库归属，新增 `user_dict_events` 事件表支撑历史趋势，掌握状态维持现有二态不变，Web 端只做只读展示。

---

## 2. 现状调查（本 Spec 编写时已确认的事实）

### 2.1 `user_dicts` 现状：已有查询次数和二态掌握标记，但无词库归属、无历史

`enx-api/repo/ecp.go:26-38` 的 `UserDict` struct 对应 `user_dicts` 表：

```go
type UserDict struct {
    UserId            string `gorm:"column:user_id;primaryKey"`
    WordId            string `gorm:"column:word_id;primaryKey"`
    QueryCount        int    `gorm:"column:query_count;default:0"`
    AlreadyAcquainted int    `gorm:"column:already_acquainted;default:0"`
    CreatedAt         int64  `gorm:"column:created_at"`
    UpdatedAt         int64  `gorm:"column:updated_at"`
}
```

`UpsertUserDict`（同文件 L77-102）是覆盖式写入：每次查词或点 Mark Known 都直接更新这一行，不保留历史。写入入口：

- 查词时的 `query_count` 自增：`enx-api/translate/service.go:40` 附近、`enx-api/enx/ecp.go:104/135`。
- 标记切换：`POST /api/mark`（`enx-api.go:179/196`）→ `MarkWord` handler（`enx-api.go:269-313`）→ `enx.UserDict.Mark()`（`enx-api/enx/user-dict.go:40-65`）。

该表还通过 `enx-sync` 的 `UpsertUserDict` gRPC（`enx-sync/internal/repository/word_repository.go:433-448`、`enx-sync/proto/data_service.proto`）做跨设备同步，本次改造**不涉及** `enx-sync` 侧代码。

### 2.2 `words`/ECDICT 现状：无词库/考试标签字段

`enx-api/repo/ecp.go:9-24` 的 `Word` struct（对应 `words` 表）字段是 `Id/English/LoadCount/Chinese/Pronunciation/...`，没有任何标签列。`enx-api/ecdict/ecdict.go:25-31` 的 `stardict` struct（对应只读挂载的 ECDICT SQLite）只取了 `Word/Sw/Phonetic/Translation/Exchange` 五个字段。[ADR-0001](../adr/0001-integrate-ecdict-dictionary.md) Context 提到 ECDICT 原始数据集"包含……考试标签（四六级等）"，但当前项目从未导入或暴露这个字段——**本次雅思词库归属判断不依赖 ECDICT 的 tag 列**，而是走 ADR-003 决定的独立 `word_list_memberships` 表，二者是两条不同的数据路径，互不依赖（如果雅思词表数据源本身就是"从 ECDICT tag 列筛出 ielts 标签的词"，那是 §3.2 导入脚本内部的实现细节，不改变 `stardict` struct 或 ECDICT 查询逻辑）。

### 2.3 `enx-api/handlers` 现状：无任何列表/聚合类 endpoint

`enx-api/handlers` 目录当前只有 `version.go`。现有和 `user_dicts` 相关的 HTTP 路由（`enx-api.go:176-198`）都是单词粒度的读写（`/word/:word`、`/mark`），**没有任何批量列表或聚合统计接口**，本次新增的 `/api/word-lists/*` 系列是全新的一组 endpoint，不是在现有 handler 上加分支。

### 2.4 `enx-ui` 现状：无仪表盘页面，API 层是简单的 fetch 封装

`enx-ui/src/app` 下现有路由只有 `lookup`（查词）、`auth/callback`、`forgot-password`、`reset-password`、`verify-email`，没有任何数据看板类页面。`enx-ui/src/services/api.ts` 是一个 `ApiService` class，`makeRequest<T>` 统一处理 `Authorization: Bearer <token>` header 和错误包装成 `ApiResponse<T>`（`success/data/error`），现有方法 `getMe()`/`lookupWord()`/`deleteWord()` 都是直接调用 `makeRequest`，本次新增的看板数据方法应该沿用同一个 `ApiService` 类和 `ApiResponse<T>` 包装模式，不要新建另一套请求封装。`enx-ui/src/types/index.ts` 里的 `WordData`（`Key/English/Pronunciation/Chinese/LoadCount/AlreadyAcquainted/WordType`）是现有查词结果的类型，本次词表明细的返回结构和它字段重叠但语义不同（`WordData` 是单词查询结果，本次是"某用户在某词库里的进度条目"），应该新增独立类型，不要复用/扩展 `WordData`。

页面鉴权目前通过 `AuthWrapper.tsx`（`enx-ui/src/components/`）包裹，新增的看板页面路由需要复用这个组件保护，不要重新实现鉴权判断。

---

## 3. 目标设计

### 3.1 数据库改动（新增迁移文件 `enx-api/migrations/008_word_lists.sql`）

```sql
CREATE TABLE IF NOT EXISTS word_lists (
    id         TEXT PRIMARY KEY,   -- UUID
    slug       TEXT NOT NULL UNIQUE, -- 如 'ielts'
    name       TEXT NOT NULL,        -- 如 '雅思核心词'
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS word_list_memberships (
    word_list_id TEXT NOT NULL,
    word_id      TEXT NOT NULL,
    created_at   INTEGER NOT NULL,
    PRIMARY KEY (word_list_id, word_id)
);
CREATE INDEX IF NOT EXISTS idx_word_list_memberships_word_id
    ON word_list_memberships(word_id);

CREATE TABLE IF NOT EXISTS user_dict_events (
    id                 TEXT PRIMARY KEY,  -- UUID
    user_id            TEXT NOT NULL,
    word_id            TEXT NOT NULL,
    event_type         TEXT NOT NULL,     -- 'mark_changed' | 'query_milestone'
    query_count        INTEGER NOT NULL,
    already_acquainted INTEGER NOT NULL,
    created_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_dict_events_user_created
    ON user_dict_events(user_id, created_at);
```

对应 GORM struct 新增到 `enx-api/repo/ecp.go`（或独立文件 `enx-api/repo/wordlist.go`，实施时二选一，倾向独立文件避免 `ecp.go` 进一步膨胀），并加入 `sqlitex.go:136` 的 `AutoMigrate(...)` 列表。

### 3.2 词库数据导入（一次性脚本，非常驻服务）

新增 `enx-api/cmd/import-wordlist/main.go`（参照现有 `enx-api/cmd` 下其它一次性工具的结构），读取 §0 确认的雅思词表源文件，对每个词：

1. 按 `GetWordByEnglish`（`enx-api/repo/ecp.go:41-62`）现有的精确匹配→忽略大小写匹配逻辑，在 `words` 表里查找对应 `word_id`。
2. **找到**：写入一条 `word_list_memberships(word_list_id=<ielts的id>, word_id)`。
3. **找不到**（`words` 表里没有这个词，比如词库里有生僻词或变体拼写而 ECDICT/本地词库没收录）：**跳过并记录日志**（打印到 stdout，导入结束后汇总"跳过 N 个词，清单见 xxx"）。**不在导入脚本里自动写入 `words` 表**——这是一个需要 Review 时明确的开放问题：如果跳过比例过高（比如 >5%），说明词库源数据和当前 `words` 表覆盖度不匹配，应该回头检查数据源或 ECDICT 覆盖率，而不是让导入脚本静默创建可能缺音标/释义的残缺词条。

脚本需要幂等（重复运行不产生重复 `word_list_memberships` 行，用 `INSERT OR IGNORE` 或先查后插）。

### 3.3 事件写入：`UpsertUserDict` 改造

`enx-api/repo/ecp.go:77-102` 的 `UpsertUserDict` 在写入/更新 `user_dicts` 后，按 ADR-003 Decision 追加事件：

- 若本次更新前后 `already_acquainted` 发生变化（对比 `existing.AlreadyAcquainted` 与传入值）：插入一条 `user_dict_events(event_type='mark_changed', ...)`。
- 若 `query_count` 跨越 5 的倍数（如 `existing.QueryCount / 5 != queryCount / 5`）：插入一条 `event_type='query_milestone'`。
- 两个条件都不满足（比如只是 query_count 从 3 涨到 4）：**不写事件**，只更新 `user_dicts`，维持现有行为。

步进阈值（当前定为 5）作为具名常量，不要硬编码成魔法数字散落在函数体内，方便后续按实际数据量调整。

### 3.4 新增 API（`enx-api/handlers/wordlist.go`，新文件）

| 方法 & 路径 | 说明 |
| --- | --- |
| `GET /api/word-lists/:slug/progress` | 返回 `{total, mastered, unmastered, need_review, untouched}`。`need_review` = `already_acquainted=0 AND query_count >= N`（N 沿用 §3.3 的步进阈值或独立可调参数，实施时决定是否复用同一常量）；`untouched` = 词库里存在但当前用户 `user_dicts` 无对应行的词数 |
| `GET /api/word-lists/:slug/words?status=mastered\|unmastered\|need_review\|untouched\|all&sort=query_count\|english&order=asc\|desc&page=&page_size=` | 分页词表明细，每行含 `english/chinese/pronunciation/query_count/already_acquainted` |
| `GET /api/word-lists/:slug/trend?weeks=8` | 从 `user_dict_events` 按周聚合出掌握率序列（每周取该用户当周末尾的 `mastered/total` 快照），返回 `[{week_start, mastered, total}]` |

三个 endpoint 都挂在现有 `authGroup`/`apiGroup`（`enx-api.go:169-198`）下，复用现有鉴权中间件，不新增鉴权逻辑。`:slug` 目前只会传 `ielts`，但路由设计成通用参数，为未来其它词库预留。

### 3.5 `enx-ui` 新增页面

| 文件 | 说明 |
| --- | --- |
| `enx-ui/src/app/wordlists/ielts/page.tsx`（新增） | 看板页面，用 `AuthWrapper` 包裹；顶部总览统计卡片 + 词表明细表格 + 趋势图 |
| `enx-ui/src/app/wordlists/ielts/ProgressSummary.tsx`（新增） | 展示 `/progress` 返回的四个数字（已掌握/未掌握/重点复习/未接触），仿照 `enx-ui/src/app/lookup/WordResultCard.tsx` 的卡片风格 |
| `enx-ui/src/app/wordlists/ielts/WordListTable.tsx`（新增） | 词表明细，状态筛选 tab + 排序下拉 + 分页控件，调用 `/words` endpoint |
| `enx-ui/src/app/wordlists/ielts/TrendChart.tsx`（新增） | 掌握率趋势曲线，调用 `/trend` endpoint；图表库沿用项目现有依赖（若 `enx-ui` 尚未引入任何图表库，实施时先确认技术选型，不要在本 Spec 里预设具体库） |
| `enx-ui/src/services/api.ts` | 新增 `getWordListProgress(slug)`/`getWordListWords(slug, params)`/`getWordListTrend(slug, weeks)` 三个方法，复用现有 `makeRequest<T>` |
| `enx-ui/src/types/index.ts` | 新增 `WordListProgress`/`WordListEntry`/`WordListTrendPoint` 类型（不复用 `WordData`，见 §2.4） |

---

## 4. 验收标准

### 4.1 数据层

- [ ] 迁移执行后 `word_lists` 存在一条 `slug='ielts'` 记录；`word_list_memberships` 行数与 §3.2 导入脚本的"成功匹配"计数一致
- [ ] 导入脚本重复运行两次，`word_list_memberships` 行数不变（幂等性）
- [ ] 手工触发一次 `already_acquainted` 翻转（走现有 `/api/mark`），`user_dict_events` 新增恰好一条 `event_type='mark_changed'` 记录，且不影响 `user_dicts` 现有行为（现有 `/api/mark` 相关测试保持通过）
- [ ] 连续查询同一词 5 次，`user_dict_events` 新增恰好一条 `event_type='query_milestone'`（不是 5 条）

### 4.2 API

- [ ] `GET /api/word-lists/ielts/progress`：新建测试用户，标记 3 个词为已掌握、5 个词查询过但未标记、其余未接触，断言返回的四个数字与预期精确匹配
- [ ] `GET /api/word-lists/ielts/words?status=need_review`：断言只返回 `already_acquainted=0 AND query_count>=5` 的词，不多不少
- [ ] 分页参数越界（`page` 超出总页数）返回空列表而非报错
- [ ] `GET /api/word-lists/ielts/trend?weeks=8`：断言返回序列长度为 8，且每个点的 `mastered<=total`
- [ ] 未登录请求以上三个 endpoint 均返回 401（复用现有鉴权中间件的既有行为）

### 4.3 Web 端

- [ ] 看板页面加载后，总览统计卡片数字与直接查 `/progress` 接口返回值一致
- [ ] 词表明细表格：切换状态筛选 tab，列表内容随之变化；切换排序，顺序随之变化；翻页正确
- [ ] 趋势图能正常渲染 8 周数据，无控制台报错
- [ ] 未登录用户访问 `/wordlists/ielts` 被 `AuthWrapper` 拦截，跳转到登录页（与现有受保护页面行为一致）

---

## 5. 风险与约束

| 风险 | 缓解 |
| --- | --- |
| 雅思词库数据源未定，是当前最大的阻塞项 | §0/§7 已明确列为前置步骤，实施顺序上排在所有数据库改动之前 |
| 导入脚本"找不到词"的处理策略（跳过 vs 补录）可能有争议 | §3.2 明确当前决定是"跳过并记录"，作为 Review 时的讨论点显式列出，不是隐藏假设 |
| `user_dict_events` 即便限制了写入频率，长期仍会增长 | 索引已设计为 `(user_id, created_at)`；若实测增长过快，按 ADR-003 Revisit Trigger 重新评估保留策略，本次不做归档机制 |
| 大词库（雅思核心词量级通常几千词）下 `/progress` 聚合查询可能慢 | `word_list_memberships` 已加 `word_id` 索引；实施时需要用接近真实词量的数据做一次性能验证（而非假设"应该没问题"），若超过可接受阈值（如 500ms）需要加缓存或调整查询方式 |
| `enx-ui` 可能尚未引入图表库，`TrendChart` 的技术选型未定 | §3.5 已标注为实施时决定，不在本 Spec 里预设，避免绑定一个可能不合适的依赖 |

---

## 6. 相关文件索引

| 文件 | 说明 |
| --- | --- |
| `enx-api/migrations/008_word_lists.sql`（新增） | `word_lists`/`word_list_memberships`/`user_dict_events` 建表 |
| `enx-api/repo/wordlist.go`（新增，或并入 `ecp.go`） | 新表对应的 GORM struct 与查询函数 |
| `enx-api/repo/ecp.go` | `UpsertUserDict` 改造，追加事件写入（§3.3） |
| `enx-api/cmd/import-wordlist/main.go`（新增） | 一次性词库导入脚本 |
| `enx-api/handlers/wordlist.go`（新增） | `/api/word-lists/*` 三个只读 endpoint |
| `enx-api/enx-api.go` | 新增路由注册（`authGroup`/`apiGroup` 下） |
| `enx-api/utils/sqlitex/sqlitex.go` | `AutoMigrate` 列表加入新 struct |
| `enx-ui/src/app/wordlists/ielts/`（新增目录） | 看板页面及子组件 |
| `enx-ui/src/services/api.ts` | 新增三个看板数据请求方法 |
| `enx-ui/src/types/index.ts` | 新增看板相关类型 |
| `docs/architecture/adr-003-ielts-wordlist-mastery-model.md` | 关联决策记录 |

---

## 7. 实施顺序（建议）

```text
0. [ ] 阻塞项：确认雅思词库数据源（词表版本、格式、词量），未确认不进入步骤 2
1. [ ] Spike：核对 ECDICT 数据源本身是否含考试标签列（ADR-0001 提到但当前未导入），
       确认本次导入是否可以/需要复用该字段，还是完全依赖独立的雅思词表源文件
2. [ ] 数据库迁移：新增 008_word_lists.sql，本地跑一次迁移确认建表成功
3. [ ] repo 层：新增 word_lists/word_list_memberships/user_dict_events 对应 struct 和查询函数；
       改造 UpsertUserDict 追加事件写入（§3.3），补单测覆盖"翻转写事件/步进写事件/普通更新不写事件"三种分支
4. [ ] 导入脚本：cmd/import-wordlist，先在开发库跑一次，人工核对"跳过词清单"是否在可接受范围
5. [ ] API：新增 handlers/wordlist.go 三个 endpoint + 路由注册，补集成测试（§4.2）
6. [ ] enx-ui：ProgressSummary → WordListTable → TrendChart 依次实现，
       每步接入真实 API 后手工验证一次，不要三个组件都写完才第一次联调
7. [ ] 端到端手工验证：用真实测试账号标记若干词，刷新看板确认数字符合预期
8. [ ] 勾选 §4 全部验收项，文首状态更新为 Done — YYYY-MM-DD；ADR-003 状态同步改为 Accepted
```

---

## 8. SDD 工作方式（给 Agent / 开发者）

1. **实现前**：以本文 Spec 与 [ADR-003](../architecture/adr-003-ielts-wordlist-mastery-model.md) 为唯一需求来源；§0 前置阻塞项未解决前不开始步骤 2 及之后的工作。
2. **实现中**：严格按 §7 分步提交，每步跑一次相关测试；数据库/后端改动（步骤 2-5）与前端改动（步骤 6）分开提交，便于 review。
3. **实现后**：勾选 §4 验收清单；将文首**状态**更新为 `Done — YYYY-MM-DD`；同步把 ADR-003 状态从 `Proposed` 改为 `Accepted`。

---

## 9. 后续扩展（Out of Scope，供未来 Spec 引用）

- 其它词库（CET4/6、托福等）复用本次的 `word_lists`/`word_list_memberships` 框架，只需新增导入脚本运行一次，不需要新的 Spec 重新设计表结构
- Web 端标记/批量操作入口（当前明确是纯只读看板）
- "阅读障碍"独立于"未掌握"的第三态（当前维持二态，见 ADR-003 Revisit Trigger）
- 基于遗忘曲线的复习提醒/间隔重复（spaced repetition），依赖本次 `user_dict_events` 建立的事件基础，但本次不实现调度逻辑
- 词库内容的后台管理界面（当前词库更新方式是重新跑一次导入脚本）
