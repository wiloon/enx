# ADR-003: 雅思/CET4/CET6/托福词库标记的数据模型设计

| 字段 | 值 |
| --- | --- |
| **状态** | Proposed — 2026-07-31（待 Review） |
| **日期** | 2026-07-30，2026-07-31 两次修订（① 放弃多对多建模，改为在 `words` 表加布尔列，明确不回填缺失词；② 加入托福列，并新增"生产查询路径在缓存未命中时顺带打标"这条写入路径） |
| **关联 Spec** | [`docs/tasks/TASK-SPEC-enx-ielts-wordlist-dashboard.md`](../tasks/TASK-SPEC-enx-ielts-wordlist-dashboard.md) |
| **修订关系** | 扩展 [ADR-0001](../adr/0001-integrate-ecdict-dictionary.md) 引入的 ECDICT 数据基础；本 ADR 初版提出的 `word_lists`/`word_list_memberships` 多对多表已在第一次修订中放弃 |

---

## Context

**产品需求**：enx web 端（`enx-ui`）需要内置雅思词库，让用户查看自己对雅思词库的掌握进度；数据层同时标注 CET4/CET6/托福范围，供未来复用。

**现状（已确认的事实）**：

1. `enx-api/repo/ecp.go:9-24` 的 `words` 表是**懒加载的查询缓存**——只有用户实际查过的词才会出现在这张表里，不是完整词典的镜像。
2. **`words` 表有两条会新增行的写入路径**，这是本次修订新确认的关键事实：
   - **批量标记脚本**（`cmd/tag-wordlists`，本 ADR 第一次修订的方案）——只处理表里已经存在的历史行。
   - **生产查询路径的缓存未命中分支**——`translate/helpers.go:27-54` 的 `fillFromEcdict()`：当 `words` 表查不到某个词、但 ECDICT（`dictionary.Lookup` → `ecdict.Query`，`enx-api/ecdict/ecdict.go:92-128`）查到了，就会调用 `word.Save()`（`enx-api/enx/ecp.go:145-157`）把这个词**新插入** `words` 表。这条路径每天都在发生（只要有用户查到本地缓存里没有的新词），如果只做批量脚本，每次有新词插入都会带着四个考试标记列的默认值 `0`，需要人工再跑一次批量脚本才能补上——这在产品运行过程中是持续的数据滞后，不是一次性问题。
3. ECDICT 原始数据集自带 `tag` 列（空格分隔多标签，含 `ielts`/`cet4`/`cet6`/`toefl`/`gk`/`ky`/`gre` 等），但当前 `enx-api/ecdict/ecdict.go:25-31` 的 `stardict` struct 和 `enx-api/enx/enx.go:3-8` 的 `Dictionary` struct 都没有携带这个字段——`ecdict.Query()` 返回结果里目前完全拿不到 tag 信息，无论是批量脚本还是生产路径都需要先把这个字段打通。
4. `words` 表的唯一索引 `idx_english`（`migrations/007_repair_words_ddl_comments.sql`）区分大小写，同一单词可能存在大小写不同的多条行，标记逻辑必须逐行处理（沿用第一次修订的结论，不变）。
5. `user_dicts` 表已有逐词查询次数和掌握标记，通过 `word_id`（UUID）关联，本次不受影响。

---

## Decision（累积决策，含两次修订）

**在 `words` 表加四个布尔列（`is_ielts`/`is_cet4`/`is_cet6`/`is_toefl`），并且有两条独立但共享同一套"tag 字符串 → 布尔值"解析逻辑的写入路径：**

### 1. 表结构（第一次修订确定，本次加一列）

```sql
ALTER TABLE words ADD COLUMN is_ielts BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE words ADD COLUMN is_cet4  BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE words ADD COLUMN is_cet6  BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE words ADD COLUMN is_toefl BOOLEAN NOT NULL DEFAULT 0;
```

不新建表，`words.id`（现有 UUID）仍是唯一标识符。

### 2. 共享的 tag 解析逻辑（新增，`enx-api/ecdict` 包）

`ecdict.go` 的 `stardict` struct 加 `Tag string \`gorm:"column:tag"\`` 字段；`enx.Dictionary`（`enx-api/enx/enx.go`）加 `Tag string` 字段，`Query()` 把 ECDICT 行的 `tag` 原样透传出去。新增一个纯函数（如 `ecdict.ParseExamTags(tag string) (ielts, cet4, cet6, toefl bool)`），把空格分隔的 tag 字符串解析成四个布尔值——**这是唯一一处知道"tag 字符串里的哪个词对应哪个布尔列"的地方**，两条写入路径都调用它，不各自维护一份解析逻辑。

### 3. 写入路径 A：生产查询路径顺带打标（新增，本次修订核心）

`translate/helpers.go` 的 `fillFromEcdict()` 在 `epc != nil`（ECDICT 命中）时，除了现有的 `English/Chinese/Pronunciation` 赋值，额外调用 `ecdict.ParseExamTags(epc.Tag)` 得到四个布尔值，赋给 `word.IsIelts/IsCet4/IsCet6/IsToefl`（`enx.Word` 加对应字段）；`Word.Save()`（`enx-api/enx/ecp.go:145-157`）在构造 `repo.Word{}` 时把这四个字段一并写入新行。**从这条改造生效的时刻起，任何新插入 `words` 表的行都会带着正确的考试标记，不需要等下一次批量脚本运行。**

### 4. 写入路径 B：批量回填脚本（第一次修订确定，本次简化实现方式）

`cmd/tag-wordlists` 仍然需要，用来修复"生产路径改造上线之前就已经存在"的历史行（那些行是在没有 tag 逻辑时插入的，天然是 `0`）。**实现方式因为路径 A 的引入而简化**：不再需要脚本自己定义一份独立的 stardict 查询（第一次修订曾经这样设计），可以直接对 `words` 表每一行调用现有的 `ecdict.Query()`（现在已经带 `Tag` 字段）取回 tag，再用同一个 `ecdict.ParseExamTags()` 解析——和路径 A 复用完全相同的函数，只是触发方式是"批量扫描现有行"而不是"单词缓存未命中时触发"。**仍然只 `UPDATE` 已存在的行，不 `INSERT` 新词**，这个约束不变（见 Consequences）。

同一单词的多条大小写不同的行，两条路径都按各自场景自然处理：路径 A 是"新插入的这一行"，只影响这一行；路径 B 逐行扫描 `words` 表，天然会覆盖到所有大小写变体的历史行。

---

## Rationale

1. **路径 A 是本次修订的关键新增**：如果只有批量脚本（路径 B），"数据准确"这件事会退化成一个需要人工定期重跑的运维任务——每有一个新词首次被查询插入，标记列就会短暂（直到下次运维手动跑脚本）是错的 `0`。让生产路径顺带打标，使得数据从写入的那一刻起就是准确的，不依赖后续人工操作。
2. **两条路径共享同一个解析函数，而不是各自实现**：tag 字符串到布尔列的映射规则（比如"tag 里出现 `ielts` 这个词就是 `is_ielts=1`"）只应该有一处定义；如果路径 A 和路径 B 各自写一份解析逻辑，未来加新考试类型时容易漏改一处，或者两处判断标准悄悄产生分歧。
3. **批量脚本仍然必要，不能被路径 A 完全取代**：路径 A 只覆盖"改造上线之后新插入的行"，改造上线之前已经存在于 `words` 表里的历史行（很可能是大多数数据）不会被路径 A 追溯性更新，必须靠路径 B 一次性回填。
4. **不回填缺失词的约束在路径 A 里同样成立**：路径 A 本来就只在"ECDICT 有、`words` 表没有"时触发插入，这个插入动作是现有生产逻辑（懒加载缓存），本 ADR 没有改变"是否插入"这个决策，只是给"本来就要发生的插入"顺带补上四个字段，没有扩大"什么情况下会有新词进入 `words` 表"这个既有行为的范围。

---

## Consequences

### Positive

- 数据从写入时刻起就是准确的，不再依赖批量脚本作为唯一的数据来源，减少"看板数字滞后于实际标记"的运维负担。
- 两条路径共享同一个解析函数，加新考试类型（比如未来加托福之后还想加 GRE）只需要改 `ParseExamTags` 一处。
- 批量脚本因为能复用 `ecdict.Query()` 而不需要维护一份独立的 tag 查询逻辑，实现更简单。

### Negative

- **改动了生产查询路径**（`fillFromEcdict`/`Word.Save`/`ecdict.Query`），这是第一次修订原本刻意避免的（当时决定"标记逻辑不碰生产路径，只用批量脚本"）。本次修订主动接受这个代价，因为"数据持续滞后"被认为是更大的问题；改动面集中在"多读一个字段、多算四个布尔值、多写四个列"，不改变现有查询结果的语义（`English/Chinese/Pronunciation` 完全不变），回归风险可控。
- ECDICT 挂载的具体数据文件如果本身没有 `tag` 列或该列为空，`ParseExamTags` 会对空字符串返回全 `false`，这是优雅降级（不报错、不阻塞查词功能）——**已用 homelab 实际数据文件验证 `tag` 列确实有值**（见 Open Question），这一条风险已排除，不再是待验证项。
- 批量脚本（路径 B）仍然是运维性质的一次性工具，需要人工在路径 A 上线后手动跑一次，覆盖历史行；这一步骤如果被忘记，历史行会一直是 `0`，直到用户偶然重新触发同一个词的查询（但缓存命中的词不会重新走 `fillFromEcdict`，所以历史行实际上**永远不会**被路径 A 间接修复，必须依赖路径 B）。

### Mitigation

- ECDICT 数据文件的 `tag` 列内容已在 Review 阶段核实（Task Spec §0），避免了在假数据前提下完成开发的风险。
- 批量脚本作为路径 A 上线后的**必需**后续步骤写入 Task Spec 验收标准，不是可选项。

---

## Revisit Trigger

- 若 ECDICT 挂载的数据文件确认不含可用的 `tag` 数据，需要重新评估标记数据的来源（退回到某个独立词表文件，而不是依赖 ECDICT 的 tag 列），路径 A 的"顺带打标"设计需要相应调整数据源。
- 若产品后续需要"雅思词库全量覆盖率"而不是"已查询词中的掌握率"，需要重新评估是否要在路径 A 之外再引入"预热"逻辑（启动时或定期主动查询官方词表里所有词，逐一插入 `words` 表），这会让 `words` 表从"纯懒加载缓存"演变为"部分主动预加载"，是比本次更大的改动。
- 若 `words` 表大小写重复行的问题后续被排期修复，需要确认修复方案（合并重复行）时是否会影响路径 A/B 已经写入的四个布尔列（预期不会，因为布尔列在合并后取"任一行为真则为真"即可，但需要在那个修复任务里显式验证）。
- 若未来还要加更多考试类型（GRE、专四专八等），评估届时"每加一个类型加一列"是否仍然划算，或需要切回多对多建模（ADR-003 第一次修订放弃的方案）。

---

## Open Question（已解决，2026-07-31）

批量脚本（路径 B）依赖的 ECDICT 数据文件已从 homelab k8s（`enx` namespace，`enx-api` Pod 挂载的 `enx-ecdict-data` PVC）复制到本地核实：`tag` 列确实存在，格式与 §3.2/Task Spec §3.2 的解析假设一致（空格分隔小写 token），`ielts`/`cet4`/`cet6`/`toefl` 四个 token 精确命中量级分别为 5040/3849/5407/6974（ECDICT 全库口径，不是 `words` 表口径）。详见 Task Spec §0。本地开发副本存放于 `enx-api/.local-data/ecdict/stardict.db`（已 gitignore），`enx-api/.env` 的 `ECDICT_DB_PATH` 已指向该路径。
