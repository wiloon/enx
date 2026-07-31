# ADR-003: 雅思词库掌握度追踪的数据模型设计

| 字段 | 值 |
| --- | --- |
| **状态** | Proposed — 2026-07-30（待 Review） |
| **日期** | 2026-07-30 |
| **关联 Spec** | [`docs/tasks/TASK-SPEC-enx-ielts-wordlist-dashboard.md`](../tasks/TASK-SPEC-enx-ielts-wordlist-dashboard.md) |
| **修订关系** | 扩展 [ADR-0001](../adr/0001-integrate-ecdict-dictionary.md) 引入的 ECDICT 数据基础；首次引入"词库（word list）"这一独立概念 |

---

## Context

**产品需求**：enx web 端（`enx-ui`）需要内置雅思词库，让用户能查看自己对雅思词库的掌握进度——总览统计（掌握了多少、还有多少未掌握）、词表明细（某个词查询过几次、是否已标记为无障碍阅读）。标记动作本身发生在 `enx-chrome` 插件阅读时，本 ADR 只覆盖数据模型，Web 端展示细节见配套 Task Spec。

**现状（写本 ADR 时已确认的事实）**：

1. `enx-api/repo/ecp.go:26-38` 已有 `user_dicts` 表（`UserDict{UserId, WordId, QueryCount, AlreadyAcquainted}`，联合主键 `user_id+word_id`），逐词记录每个用户的查询次数和"是否已掌握"（`already_acquainted` 为 0/1 二态）。标记路径：`enx-chrome` 的 Mark Known 按钮 → `POST /api/mark`（`enx-api.go:179/196`）→ `enx.UserDict.Mark()`（`enx-api/enx/user-dict.go:40-65`，直接对 `already_acquainted` 取反）→ `repo.UpsertUserDict` 覆盖式写入。该表还通过 `enx-sync`（`enx-sync/internal/repository/word_repository.go`、`proto/data_service.proto` 里的 `UpsertUserDict` RPC）做跨设备同步。
2. `words` 表（`enx-api/repo/ecp.go:9-24`）和 ECDICT 导入逻辑（`enx-api/ecdict/ecdict.go:25-31` 的 `stardict` struct）都**没有词库/考试标签字段**。ADR-0001 的 Context 提到 ECDICT 原始数据集"包含……考试标签（四六级等）"，但当前实现只取了 `word/sw/phonetic/translation/exchange`，标签列从未被导入或暴露。
3. `enx-api/handlers` 目前只有 `version.go`，没有任何暴露 `user_dicts` 聚合/列表数据的 HTTP endpoint；`enx-ui` 目前只有查词页（`src/app/lookup/`）和鉴权页，没有任何看板类页面。
4. `UpsertUserDict`（`enx-api/repo/ecp.go:77-102`）是覆盖式更新（`INSERT ... ON CONFLICT UPDATE` 语义），**不保留历史**——拿不到"某个时间点的掌握率"，只有"当前状态"。

**约束**（来自需求澄清阶段与用户确认的决策）：

- 词库范围要设计成可扩展的通用框架，雅思是第一个词库，后续可能加 CET4/6、托福，不希望每加一个词库就改一次表结构。
- 掌握状态维持现有二态（`already_acquainted` 0/1），不新增"阅读障碍"作为独立的第三态。
- 需要支持备考进度的历史趋势展示（如每周掌握率变化曲线）。
- Web 端本次只做只读看板，不做标记/编辑入口；标记仍然只在 `enx-chrome` 发生。

---

## Options Considered

### 词库建模

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| **A. `words` 表加 `is_ielts` 布尔列** | 每新增一个词库加一列 | 改动最小 | 不支持一词多词库（一个词可能同时是雅思核心词和四级词）；每加一个词库都要改表结构和迁移脚本，不满足"通用框架"约束 |
| **B. `word_lists` + `word_list_memberships` 多对多（推荐）** | 新增两张表：`word_lists`（词库定义）、`word_list_memberships`（word_id × word_list_id 关联） | 天然支持一词多词库；加新词库只需插数据，不改表结构；可以对每个词库单独统计进度 | 多一次 JOIN；需要一次性导入脚本把词库数据关联到 `words.id` |
| **C. 词库数据完全放应用层（静态 JSON/配置文件，不落库）** | 部署时打包一份雅思词表 JSON，运行时在内存里判断某词是否属于该词库 | 不用改数据库 | 无法用 SQL 高效联表统计"某用户在某词库的掌握进度"（需要把全量 `user_dicts` 拉到应用层再和 JSON 做交集，词库上千词、用户上千时性能和实现复杂度都不划算）；无法支撑未来"per-word-list 独立进度"这类查询需求 |

### 历史趋势

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| **D. 只保留当前状态（现状）** | 不改 `user_dicts` 的覆盖式写入 | 零改动 | 做不了趋势图，不满足"需要历史趋势"的确认结论 |
| **E. 新增事件流水表 `user_dict_events`（推荐）** | 状态变化时追加写入一条事件记录，`user_dicts` 保留作为当前状态的物化结果，两表并存 | 可以按时间聚合出趋势；`user_dicts` 的读路径不受影响（现有查询逻辑不用改） | 事件表会随使用量持续增长，需要限制写入频率（见 Decision） |

---

## Decision

**采用方案 B（通用词库多对多模型）+ 方案 E（事件流水表)，掌握状态维持二态不变。**

1. **新增两张表**（落地为迁移脚本，具体 DDL 见 Task Spec §3.1）：
   - `word_lists(id, slug, name, created_at)` —— 词库定义，`slug` 如 `ielts`，"雅思核心词"是第一条记录。
   - `word_list_memberships(word_list_id, word_id, created_at)`，联合主键 `(word_list_id, word_id)` —— 词库成员关系。是否属于某词库、属于哪些词库，都通过这张表的 JOIN 查询。
   - `words`/`user_dicts` 表结构**不变**，不加任何词库相关列。

2. **掌握状态不新增字段**：`already_acquainted` 维持 0/1。"未掌握"里"从没读到过"和"读到过但卡壳"两种含义不做数据层区分；应用层用 `already_acquainted = 0 AND query_count >= N`（N 为可调参数，不写进 schema）近似识别"重点复习词"，弥补二态模型的信息损失。这是本次和用户确认过的明确取舍，不是遗漏。

3. **新增 `user_dict_events` 追加写入表**：`(id, user_id, word_id, event_type, query_count, already_acquainted, created_at)`。**不是每次查询都写一条**——只在以下两种情况追加事件，避免高频词把表撑爆：
   - `already_acquainted` 发生翻转（`event_type = mark_changed`）；
   - `query_count` 跨越步进阈值（如每达到 5 的倍数，`event_type = query_milestone`）。
   `user_dicts` 继续作为当前状态的物化表，供现有读路径（`GetUserWordQueryCount` 等）直接使用，不受影响；趋势图从 `user_dict_events` 单独聚合。

4. **Web 端只读**：新增的聚合/列表 API 都是 `GET`，不新增任何写入端点；标记相关的 `POST /api/mark` 行为、`enx-chrome` 侧代码完全不动。

---

## Rationale

1. **多对多建模是"通用框架"约束的直接推论**：一个词完全可能同时是雅思核心词和四级词，布尔列方案在这种场景下要么冗余要么表达不了，多对多是唯一能同时满足"支持一词多词库"和"加词库不改表结构"的方案。
2. **二态状态模型是用户主动确认的权衡，不是技术限制**：三态模型技术上更精确，但用户判断当前阶段"未掌握 + 高查询次数"已经能近似表达"卡壳词"，用二态 + 应用层规则的组合成本更低，且不需要迁移现有 `user_dicts` 数据。
3. **事件表按状态跳变/步进写入，而非每次查询都写**：`load_count`/`query_count` 在现有实现里几乎每次查词都会自增（`translate/service.go`），如果趋势表照抄这个写入频率，高频用户的事件表会远超 `user_dicts` 本身的量级；按跳变/步进写入把事件量收窄到"有意义的状态变化"，同时仍能支撑"按周聚合掌握率"这类趋势查询（趋势图不需要逐次查询的粒度）。
4. **不动现有 `user_dicts` 读写路径**：`GetUserWordQueryCount`/`UpsertUserDict`/`Mark()` 等现有函数签名和行为不变，新增能力都是旁路（新表 + 新 JOIN 查询），把改动面限制在"新增"而不是"修改现有生产路径"，降低回归风险。

---

## Consequences

### Positive

- 未来加 CET4/6、托福等词库时，只需要一次性导入脚本插入 `word_lists`/`word_list_memberships` 数据，不需要再次评估表结构。
- 现有标记流程（`enx-chrome` → `/api/mark` → `user_dicts`）完全不受影响，本次改造对现有生产路径是纯增量。
- 有据可查的历史趋势，为后续"备考进度曲线"之类的产品能力打基础。

### Negative

- 需要一份雅思词库的具体数据（词表来源、版本、词数），这是**产品侧待确认的输入**，不属于本 ADR 的技术决策范围（见 Task Spec §0，属于实施阻塞项）。
- `word_list_memberships` 里的 `word_id` 要求词库里的词已经存在于 `words` 表；词库里如果有 `words` 表当前查不到的生僻词，需要在导入脚本里决定"跳过并记录"还是"顺带写入 `words` 表"（见 Task Spec §3.2，需要 Review 时明确）。
- `user_dict_events` 即便限制了写入频率，仍会随使用量持续增长，需要在实施时给出索引策略（至少 `(user_id, created_at)`），必要时考虑保留窗口（如只保留最近 N 个月，供未来 Revisit）。
- 词库量级较大（雅思核心词量级通常在几千词），`word_list_memberships` JOIN `user_dicts` 做全量统计时需要在 `word_list_memberships.word_list_id` 和 `user_dicts.user_id` 上有合适索引，否则统计接口在词库变大后可能变慢。

### Mitigation

- 词库数据来源作为 Task Spec 的显式前置步骤（§0），未确认前不进入 schema 落地之后的步骤，避免"数据没到位但表已经建错"的返工。
- 导入脚本对"`words` 表里找不到的词"采取的策略（跳过 vs 补录）在 Task Spec 里作为需要 Review 确认的开放问题列出，不擅自决定。

---

## Revisit Trigger

- 若后续产品需求明确要把"阅读障碍"做成独立于"未掌握"的状态（当前二态决策的前提发生变化），需要重新评估 `already_acquainted` 是否要从 `int 0/1` 升级为枚举字段，并设计现有数据的迁移路径。
- 若 `user_dict_events` 的实际增长速度超出预期（例如单用户表增长到百万行量级），需要重新评估"状态跳变 + 步进写入"的频率策略，或引入定期归档/保留窗口。
- 若产品决定 Web 端也要支持标记/批量操作（当前决策是"纯只读看板"），需要重新评估鉴权模型和 `/api/mark` 之外是否需要新的写入端点，且需要确认 Web 端写入是否也要触发 `enx-sync` 同步路径。

---

## Open Question（非本 ADR 决策范围，实施前需产品侧给出）

雅思词库的具体数据来源尚未确定——用哪个词表版本、词量多大。这直接决定 `word_lists` 里"雅思"这条记录要导入哪些词，是 Task Spec 实施顺序里的第一个前置步骤（Step 0），在此之前不应该开始数据导入相关的实施工作。
