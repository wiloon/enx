# ADR-043：`words.english` 改为不区分大小写的唯一列，与 ECDICT 一致——迁移时清空 `words` 与 `user_dicts`，直撇号与弯撇号统一

| 字段 | 值 |
| --- | --- |
| **状态** | Accepted — 2026-10-01（维护者确认：与 ECDICT 一致、唯一索引；homelab 与生产都默认清空受影响的表；撇号统一；这是难以撤回的表结构改动） |
| **日期** | 2026-10-01 |
| **关联** | [`adr-018-dictionary-lookup-single-metered-seam.md`](adr-018-dictionary-lookup-single-metered-seam.md)（查词入口 `dictionary.Service.Resolve`）、[`adr-030-dictionary-provider-chain-and-fallback-sources.md`](adr-030-dictionary-provider-chain-and-fallback-sources.md)（G2：`words` 只放 ECDICT 命中与人工订正，其他数据源各自建表）、[`adr-040-latency-and-service-metrics-prometheus-grafana.md`](adr-040-latency-and-service-metrics-prometheus-grafana.md)、PR #83（删掉 ECDICT 查询链里多余的 `LOWER(word)` 一步） |

---

## Context

`words` 是查词结果的缓存：ECDICT 命中后回填，管理员可以订正（ADR-021）。两边对大小写的规则不一样：

| | ECDICT `stardict.word` | `words.english`（改之前） |
| --- | --- | --- |
| 声明 | `VARCHAR(64) COLLATE NOCASE NOT NULL UNIQUE` | `TEXT NOT NULL UNIQUE`（区分大小写） |
| 含义 | 一个词不分大小写只有一行；`word = ?` 本身就不区分大小写 | `US` 与 `us`、`Apple` 与 `apple` 可以是两行 |
| 查询 | 一步 | 先精确匹配，没命中再 `LOWER(english) = LOWER(?)`（靠一个表达式索引） |

区分大小写的初衷是「专有名词与普通词含义不同」（如 US / us）。但：

1. **`words` 只缓存 ECDICT**（ADR-030 G2），而 ECDICT 对一个词只有一行、给不出两套释义。`words` 里大小写不同的两行，实际上来自同一条 ECDICT 词条。
2. **复习进度被拆散**。`user_dicts` 按 `words.id` 记复习次数和「已掌握」。句首的 `Apple` 和句中的 `apple` 如果是两行，就是两个词：次数分开算，标了「已掌握」只对其中一行有效。
3. **查询要两步**，paragraph-init 的批量查询还得在内存里做「精确优先、否则取 id 最小」。

撇号是同一类问题：网页文字里 `don't` 和 `don’t` 都常见，SQLite 的 `NOCASE` 只处理大小写，两种撇号仍然会是两行。原来的代码只在 `'s` 结尾的地方同时考虑了两种撇号。

ECDICT 作为英→中数据源的地位不变：ADR-030 实测过它已是能拿到的最全版本（340 万条）；它缺的专名、新词、短语由 Wiktionary（独立的表）和 AI 兜底补，不靠换掉 ECDICT。

## Options Considered

### A. 保持区分大小写

| Pros | Cons |
| --- | --- |
| 理论上能为 US / us 存两套释义 | 数据源 ECDICT 本来就给不出两套；复习进度按大小写拆散；查询两步 |

### B.（采用）与 ECDICT 一致：不区分大小写、唯一

| Pros | Cons |
| --- | --- |
| 一个词一行，复习进度不再拆散；一条走索引的查询；规则和数据源一致，回填时不会出现「ECDICT 一行、`words` 两行」 | 失去「同词不同大小写不同释义」的可能（今天的数据源也不提供）；改列的排序规则要重建表 |

以后真要区分 US / us 这类，正确的做法是**一条词条下多个义项**，而不是拆成两行。

### 迁移：合并重复行 vs 清空

合并（按大小写分组、保留一行、把复习记录合并过去）能保住数据，但要写一段只跑一次的合并逻辑。维护者决定：**homelab 与生产都直接清空受影响的表**——生产尚无其他用户，homelab 只有作者的测试数据。

## Decision

1. **`words.english` 声明为 `TEXT COLLATE NOCASE NOT NULL`，唯一索引 `idx_words_english`**（索引继承列的排序规则，所以唯一性也不分大小写）。`sqlitex.Word` 与 `repo.Word` 两个模型的标签一致。
2. **规范形式**：存储和查询前，弯撇号 `’` 统一成直撇号 `'`（`repo.CanonicalEnglish`）。`Word.SetEnglish` / `Word.Save` 和 `repo` 里所有按 `english` 读写的函数都经过它。返回给扩展的 key（`Word.Raw`，页面上的原样）**不变**——扩展用它在页面上找回这个词。
3. **查询只剩一步**：`english = ?`（单个词）与 `english IN (…)`（paragraph-init 批量），都走 `idx_words_english`。删掉 `LOWER(english)` 回退、表达式索引 `idx_words_english_lower`，以及 paragraph-init 的「精确优先、否则取 id 最小」。
4. **迁移**（`sqlitex.migrateWordsEnglishNoCase`，启动时在 AutoMigrate 之前执行，homelab 与生产相同）：若 `words.english` 还不是 `COLLATE NOCASE`，在一个事务里 **清空 `user_dicts`**（唯一引用 `words.id` 的表）并 **删掉 `words`**，随后 AutoMigrate 按新模型重建。其他表一律不动。新库、已迁移的库都不会被触碰（幂等）。参考 SQL 见 `migrations/008_words_english_nocase.sql`。AutoMigrate 自己改不了列的排序规则，实测它会把旧表改坏，所以必须先显式迁移。
5. **只碰应用自己的库**。ECDICT 是独立的只读文件（`mode=ro`），迁移、清空、修复一律不涉及它；本 ADR 顺带把这条规则写进每次会话都会加载的 `AGENTS.md`。
6. 旧的 `repairWordsTableDDLIfNeeded`（修复 P2P 时代带注释的 `words` 建表语句）删除：那种表也区分大小写，会被第 4 条直接重建。它保护的问题（AutoMigrate 中断导致后面的计费表没建出来）由测试 `TestInitHandlesCommentedP2PWordsTable` 继续守住。

## Consequences

- 部署后第一次启动，homelab 与生产的 `words`、`user_dicts` 被清空：查过的词会在下次查询时从 ECDICT 重新回填，**复习次数和「已掌握」标记归零**。日志里有一条 warn 记录清掉的行数。
- 查词与 paragraph-init 少一步查询、少一段内存匹配逻辑。
- 不能再为同一个词的不同大小写存不同释义（数据源本来也不提供）。
- 撇号以外的 Unicode 变体（如全角字母）不做处理；英文学习场景下没有实际需求，出现再说。

## 验证

1. `utils/sqlitex`：新库的 `english` 是 `COLLATE NOCASE`、`Apple` 之后插 `apple` 被唯一索引拒绝、`english = 'APPLE'` 找到 `Apple`；旧结构的库启动后 `words`、`user_dicts` 被清空且其他表（`users`）不动、`idx_words_english_lower` 消失、第二次启动不再清空；P2P 时代带注释的旧表被重建且后面的计费表都建出来。
2. `repo`：任意大小写和两种撇号都查到同一行（单个、批量、管理员）；批量查询的执行计划走 `idx_words_english`。
3. `enx`：`SetEnglish("don’t")` 得到 `English = "don't"`、`Raw` 保持 `don’t`；`Word.Save` 存直撇号；paragraph-init 里 `US` / `us` / `Us` 都对应同一行。
4. 部署后：enx-api 启动日志有一条 `ADR-043: rebuilding words ...` 的 warn；之后查词、标记「已掌握」正常，看板上查词来源先是 `ecdict` 多（缓存刚被清空），随后 `local` 回升。
