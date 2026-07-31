# TASK-SPEC: enx-ui 雅思词库掌握度看板

| 字段 | 值 |
| --- | --- |
| **状态** | Draft — 2026-07-31（待 Review；ECDICT tag 数据源未验证前不可开始 §7 步骤 2 及之后的实施） |
| **类型** | SDD Task Spec（Spec 驱动实现；实现前以本文为准，实现后同步更新状态与验收清单） |
| **目标** | 让登录用户在 `enx-ui` 查看自己在雅思词库范围内、已查询过的词的掌握进度：总览统计（已掌握/未掌握/重点复习）、词表明细、掌握率历史趋势曲线。数据层给 `words` 表打上 `is_ielts`/`is_cet4`/`is_cet6`/`is_toefl` 四个标记，通过两条路径维护：生产查询路径在缓存未命中新插入词时顺带打标（持续生效），批量脚本回填改造上线前已存在的历史行（一次性）。本次看板 UI 只做雅思视图 |
| **非目标** | 不做 Web 端标记/编辑入口；不做 CET4/CET6/托福的看板 UI（数据层已打标，UI 复用留给未来 Spec）；不改变现有 `POST /api/mark` 行为；不做词库内容的后台管理界面；不做"阅读障碍"独立状态；不回填 `words` 表里"生产路径改造之前、ECDICT 里也没有"的词（批量脚本只处理已存在的行，见 ADR-003）；不修复 `words` 表既存的大小写重复行问题 |
| **触发原因** | 产品需求：内置雅思词库，判断用户对雅思备考词汇的掌握程度和进度 |
| **关联背景** | [`ADR-003: 雅思/CET4/CET6/托福词库标记的数据模型设计`](../architecture/adr-003-ielts-wordlist-mastery-model.md)（2026-07-31 第二次修订：加托福列，新增"生产查询路径顺带打标"这条写入路径）；本 Spec 是该决策的落地实施计划 |

---

## 0. 前置阻塞项（实施前必须解决）

需要确认 ECDICT 挂载的实际数据文件里 `tag` 列是否有可用内容（不同版本/精简版 ECDICT 数据可能不含该列或为空）。**在此验证之前，不要开始 §7 步骤 2（生产路径改造、数据库迁移）及之后的任何步骤**——如果 `tag` 列实际是空的，本 Spec 整个"顺带打标"的设计需要先解决数据源问题（见 ADR-003 Revisit Trigger），而不是先写代码再发现打不出标。

---

## 1. 背景与动机

详见 [ADR-003](../architecture/adr-003-ielts-wordlist-mastery-model.md)。简述：`words` 表要加四个考试标记布尔列，由两条写入路径维护——① 生产查询路径（`fillFromEcdict` → `Word.Save()`）在新插入词时顺带打标，从上线时刻起持续生效；② 一次性批量脚本回填上线前已存在的历史行。两条路径共享同一个 tag 解析函数，避免逻辑分裂。

---

## 2. 现状调查（本 Spec 编写时已确认的事实）

### 2.1 `user_dicts` 现状

`enx-api/repo/ecp.go:26-38` 的 `UserDict` struct，逐词记录查询次数和掌握标记，通过 `POST /api/mark`（`enx-api.go:179/196`）→ `MarkWord` → `enx.UserDict.Mark()`（`enx-api/enx/user-dict.go:40-65`）写入，`enx-sync` 跨设备同步，本次不涉及。

### 2.2 `words` 表现状：两条会新增行的路径

`enx-api/repo/ecp.go:9-24` 的 `Word` struct 对应 `words` 表，是懒加载查询缓存。**关键：新词进入这张表只有一条现有路径**——`translate/helpers.go:27-54` 的 `fillFromEcdict()`：

```go
func fillFromEcdict(c *gin.Context, word *enx.Word, userId string) (bool, bool) {
    if word.Id != "" {
        return true, false // 本地已有，不需要 ECDICT
    }
    epc, err := dictionary.Lookup(c.Request.Context(), word.English)
    // ... 错误处理
    if epc == nil {
        return true, false // ECDICT 也没有，不插入
    }
    word.English = epc.English
    word.Key = strings.ToLower(epc.English)
    word.Chinese = epc.Chinese
    word.Pronunciation = epc.Pronunciation
    word.Save() // ← 新增行写入 words 表，见 enx-api/enx/ecp.go:145-157
    // ...
}
```

`word.Save()`（`enx-api/enx/ecp.go:145-157`）构造 `repo.Word{}` 并 `sqlitex.DB.Create(&sWord)`。本次要在这个既有插入点上，多写入四个字段。`enx.Word` struct（`enx-api/enx/ecp.go:14-32`）和 `repo.Word` struct（`enx-api/repo/ecp.go:9-24`）都需要加对应字段。

`words` 表唯一索引 `idx_english` 区分大小写（`migrations/007`），标记逻辑（无论哪条路径）都要意识到同一单词可能有多条大小写不同的行。

### 2.3 ECDICT 现状：`tag` 列存在但当前完全没有被读取

`enx-api/ecdict/ecdict.go:25-31` 的 `stardict` struct 只取 `Word/Sw/Phonetic/Translation/Exchange`；`enx-api/enx/enx.go:3-8` 的 `Dictionary` struct 只有 `English/Chinese/Pronunciation/CreateTime`。两者都没有 `tag`。`Query()`（`ecdict.go:92-128`）的返回值构造处（`ecdict.go:118-123`）需要多带一个 `Tag` 字段透传出去。

### 2.4 `enx-api/handlers` 与 `enx-ui` 现状

`enx-api/handlers` 目前只有 `version.go`；`enx-ui` 无仪表盘页面。`ApiService`（`enx-ui/src/services/api.ts`）统一处理鉴权和 `ApiResponse<T>` 包装；`AuthWrapper` 组件负责页面级鉴权，均直接复用。

---

## 3. 目标设计

### 3.1 数据库改动（新增迁移文件 `enx-api/migrations/008_words_exam_tags.sql`）

```sql
ALTER TABLE words ADD COLUMN is_ielts BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE words ADD COLUMN is_cet4  BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE words ADD COLUMN is_cet6  BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE words ADD COLUMN is_toefl BOOLEAN NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_words_is_ielts ON words(is_ielts) WHERE is_ielts = 1;
CREATE INDEX IF NOT EXISTS idx_words_is_cet4  ON words(is_cet4)  WHERE is_cet4  = 1;
CREATE INDEX IF NOT EXISTS idx_words_is_cet6  ON words(is_cet6)  WHERE is_cet6  = 1;
CREATE INDEX IF NOT EXISTS idx_words_is_toefl ON words(is_toefl) WHERE is_toefl = 1;
```

同一迁移文件里一并建 `user_dict_events` 表（见 §3.4，用于趋势图，和考试标记列是两件独立的事，放同一个迁移文件纯粹是减少迁移文件数量）。

`repo.Word` struct（`enx-api/repo/ecp.go:9-24`）加：

```go
IsIelts bool `gorm:"column:is_ielts;default:false"`
IsCet4  bool `gorm:"column:is_cet4;default:false"`
IsCet6  bool `gorm:"column:is_cet6;default:false"`
IsToefl bool `gorm:"column:is_toefl;default:false"`
```

### 3.2 共享的 tag 解析逻辑（新增 `enx-api/ecdict/tags.go`）

```go
type ExamTags struct {
    Ielts bool
    Cet4  bool
    Cet6  bool
    Toefl bool
}

func ParseExamTags(tag string) ExamTags {
    var t ExamTags
    for _, f := range strings.Fields(tag) {
        switch f {
        case "ielts":
            t.Ielts = true
        case "cet4":
            t.Cet4 = true
        case "cet6":
            t.Cet6 = true
        case "toefl":
            t.Toefl = true
        }
    }
    return t
}
```

具体 ECDICT tag 值的拼写（是 `ielts` 还是别的写法）需要在 §7 步骤 1 用实际数据文件核实后再定，上面的 `switch` 分支值是待验证的假设，不是确认过的事实。

`stardict` struct（`ecdict.go:25-31`）加 `Tag string \`gorm:"column:tag"\``；`enx.Dictionary`（`enx.go:3-8`）加 `Tag string`；`Query()` 返回构造处（`ecdict.go:118-123`）把 `res.entry.Tag` 一并赋给返回的 `Dictionary.Tag`。

### 3.3 写入路径 A：生产查询路径顺带打标

`enx.Word` struct（`enx-api/enx/ecp.go:14-32`）加 `IsIelts/IsCet4/IsCet6/IsToefl bool` 字段。

`translate/helpers.go` 的 `fillFromEcdict()` 在 `word.Chinese = epc.Chinese` 之后、`word.Save()` 之前，新增：

```go
tags := ecdict.ParseExamTags(epc.Tag)
word.IsIelts = tags.Ielts
word.IsCet4 = tags.Cet4
word.IsCet6 = tags.Cet6
word.IsToefl = tags.Toefl
```

（`translate` 包需要新增对 `enx-api/ecdict` 的 import；目前只 import 了 `enx-api/dictionary`，这是本次唯一新增的包依赖）

`Word.Save()`（`enx-api/enx/ecp.go:145-157`）构造 `sWord := repo.Word{}` 时一并赋值 `sWord.IsIelts = word.IsIelts` 等四行。

### 3.4 写入路径 B：批量回填脚本（回填改造上线前的历史行）

新增 `enx-api/cmd/tag-wordlists/main.go`：

1. `SELECT id, english FROM words`，逐行扫描。
2. 对每一行调用 `ecdict.Query(ctx, row.English)`（复用生产查询函数，不再像本 Spec 上一版那样自己定义独立的 tag 查询逻辑）。
3. 若查到结果，用 `ecdict.ParseExamTags(result.Tag)` 解析，`UPDATE words SET is_ielts=?, is_cet4=?, is_cet6=?, is_toefl=? WHERE id=?`。
4. ECDICT 查不到的词（比如生僻词），跳过，不报错。
5. 打印统计：扫描总行数、四个标记各命中多少行。
6. **只 `UPDATE`，不 `INSERT`**——这一条约束不变（见 ADR-003 Decision 4）。
7. **幂等**：重复运行结果不变；且路径 A 上线后新插入的行本身已经带正确标记，重复跑批量脚本对这些行是无意义但无害的重复写入（结果相同）。

逐行调用 `ecdict.Query()` 而非批量 SQL JOIN，是因为 `words` 表和 ECDICT 是两个独立的 SQLite 文件（不同数据库连接，无法直接 JOIN），这本来就是现有架构的既定约束（`ecdict.go` 的 `db` 和 `sqlitex.DB` 是两个连接），不是本次引入的新限制。

### 3.5 事件写入：`UpsertUserDict` 改造（历史趋势支持，与考试标记无关，独立功能）

同前版本设计不变：`UpsertUserDict` 在 `already_acquainted` 翻转或 `query_count` 跨 5 的倍数时，追加写入 `user_dict_events(id, user_id, word_id, event_type, query_count, already_acquainted, created_at)`，其它情况不写。

### 3.6 新增 API（`enx-api/handlers/wordlist.go`，新文件）

| 方法 & 路径 | 说明 |
| --- | --- |
| `GET /api/word-lists/ielts/progress` | `{total, mastered, unmastered, need_review}`，查询 `words JOIN user_dicts ON words.id=user_dicts.word_id AND user_dicts.user_id=? WHERE words.is_ielts=1` |
| `GET /api/word-lists/ielts/words?status=...&sort=...&order=...&page=&page_size=` | 分页词表明细 |
| `GET /api/word-lists/ielts/trend?weeks=8` | 从 `user_dict_events` 按周聚合掌握率序列 |

固定 `ielts` 路径，不做通用 `:slug`（理由同前版本：四个字段而非可参数化的表，`:slug → 列名` 映射本次不做）。

### 3.7 `enx-ui` 新增页面

| 文件 | 说明 |
| --- | --- |
| `enx-ui/src/app/wordlists/ielts/page.tsx`（新增） | 看板页面，`AuthWrapper` 包裹 |
| `enx-ui/src/app/wordlists/ielts/ProgressSummary.tsx`（新增） | 总览统计卡片 |
| `enx-ui/src/app/wordlists/ielts/WordListTable.tsx`（新增） | 词表明细，筛选/排序/分页 |
| `enx-ui/src/app/wordlists/ielts/TrendChart.tsx`（新增） | 趋势曲线，图表库技术选型实施时定 |
| `enx-ui/src/services/api.ts` | 新增 `getIeltsProgress()`/`getIeltsWords(params)`/`getIeltsTrend(weeks)` |
| `enx-ui/src/types/index.ts` | 新增 `IeltsProgress`/`IeltsWordEntry`/`IeltsTrendPoint` |

---

## 4. 验收标准

### 4.1 ECDICT tag 数据验证（§0 前置阻塞项的落地检查）

- [ ] 用实际挂载的 ECDICT 数据文件查询若干已知的雅思/CET4/CET6/托福词，确认 `tag` 列非空且包含预期标签值；若为空或格式与假设不符，先更新 §3.2 的 `switch` 分支再继续后续步骤

### 4.2 写入路径 A（生产路径顺带打标）

- [ ] 构造一个 `words` 表里不存在、ECDICT 里存在且 `tag` 含 `ielts` 的词，走一次真实查词请求（缓存未命中），断言新插入的行 `is_ielts=1`
- [ ] 同上，验证 `is_cet4`/`is_cet6`/`is_toefl` 各自独立触发正确
- [ ] 构造一个 ECDICT 里 `tag` 为空或不含任何已知标签的词，断言新插入行四个标记列均为 `0`（不报错，优雅降级）
- [ ] 现有 `fillFromEcdict`/`Word.Save()` 相关测试（若有）在改造后仍然通过，`English/Chinese/Pronunciation` 等既有字段行为不受影响

### 4.3 写入路径 B（批量回填脚本）

- [ ] 构造一个改造前就存在的历史行（手工插入,不经过路径 A），脚本运行后其考试标记列被正确回填
- [ ] 构造大小写两条历史行，脚本运行后两行独立被正确回填
- [ ] ECDICT 查不到的历史词，脚本运行后该行标记列保持默认值,不报错、不中断整体运行
- [ ] 脚本重复运行两次结果一致

### 4.4 API

- [ ] `GET /api/word-lists/ielts/progress`：新建测试用户，标记 3 个雅思词已掌握、5 个查询过未标记，断言返回数字精确匹配
- [ ] `GET /api/word-lists/ielts/words?status=need_review`：只返回 `already_acquainted=0 AND query_count>=5`
- [ ] 分页越界返回空列表
- [ ] `GET /api/word-lists/ielts/trend?weeks=8`：序列长度为 8，`mastered<=total`
- [ ] 未登录请求均返回 401

### 4.5 事件写入

- [ ] `already_acquainted` 翻转写入恰好一条 `mark_changed`
- [ ] `query_count` 跨 5 的倍数写入恰好一条 `query_milestone`

### 4.6 Web 端

- [ ] 总览统计与 `/progress` 一致；词表筛选/排序/分页正确；趋势图正常渲染；未登录访问被拦截

---

## 5. 风险与约束

| 风险 | 缓解 |
| --- | --- |
| ECDICT 数据文件的 `tag` 列可能为空或格式与假设不符 | §0/§4.1 作为前置验证，未通过不继续后续步骤 |
| 改造了生产查询路径（`fillFromEcdict`），有回归风险 | §4.2 明确要求既有字段行为（English/Chinese/Pronunciation）不受影响的回归测试；改动只新增字段赋值，不修改既有逻辑分支 |
| 批量脚本逐词调用 `ecdict.Query()`，历史数据量大时耗时可能较长 | 一次性运维脚本，不要求实时性；若实测过慢可加并发（多个 goroutine 分片处理），实施时按实际数据量决定是否需要 |
| 统计口径只覆盖"已查询过的词" | ADR-003 已记录为确认过的产品取舍；看板文案需要说明这一点 |
| `words` 表既存大小写重复行不会被本次修复 | 列入 ADR-003 Revisit Trigger，本次只保证两条路径都不漏标 |

---

## 6. 相关文件索引

| 文件 | 说明 |
| --- | --- |
| `enx-api/migrations/008_words_exam_tags.sql`（新增） | `words` 加四个布尔列 + 索引；`user_dict_events` 建表 |
| `enx-api/ecdict/ecdict.go` | `stardict`/`Dictionary` 加 `Tag` 字段，`Query()` 透传 |
| `enx-api/ecdict/tags.go`（新增） | `ParseExamTags` 共享解析函数 |
| `enx-api/enx/enx.go` | `Dictionary` struct 加 `Tag` |
| `enx-api/enx/ecp.go` | `Word` struct 加四个标记字段；`Save()` 写入 |
| `enx-api/repo/ecp.go` | `Word` struct（DB 层）加四个字段 |
| `enx-api/translate/helpers.go` | `fillFromEcdict()` 调用 `ParseExamTags` |
| `enx-api/cmd/tag-wordlists/main.go`（新增） | 批量回填脚本，复用 `ecdict.Query`/`ParseExamTags` |
| `enx-api/handlers/wordlist.go`（新增） | `/api/word-lists/ielts/*` |
| `enx-ui/src/app/wordlists/ielts/`（新增） | 看板页面 |
| `docs/architecture/adr-003-ielts-wordlist-mastery-model.md` | 关联决策记录 |

---

## 7. 实施顺序（建议）

```text
1. [ ] 验证 ECDICT 数据文件 tag 列实际内容（§0/§4.1），确认 §3.2 的标签值假设是否需要调整
2. [ ] 数据库迁移：008_words_exam_tags.sql
3. [ ] ecdict 包改造：stardict/Dictionary 加 Tag，新增 ParseExamTags（§3.2）
4. [ ] 写入路径 A：enx.Word/repo.Word 加字段，fillFromEcdict 改造，Word.Save 改造（§3.3）
       跑一次真实查词验证 §4.2 全部用例
5. [ ] 写入路径 B：cmd/tag-wordlists（§3.4），在开发库跑一次，人工核对命中量级，
       跑 §4.3 全部用例
6. [ ] repo 层事件写入改造（§3.5），补单测
7. [ ] API：handlers/wordlist.go 三个 endpoint + 路由注册，补集成测试（§4.4/§4.5）
8. [ ] enx-ui：ProgressSummary → WordListTable → TrendChart 依次实现并联调
9. [ ] 端到端手工验证；勾选 §4 全部验收项；状态更新为 Done — YYYY-MM-DD；
       ADR-003 状态同步改为 Accepted
```

---

## 8. SDD 工作方式（给 Agent / 开发者）

1. **实现前**：以本文与 [ADR-003](../architecture/adr-003-ielts-wordlist-mastery-model.md) 为唯一需求来源；§0/步骤 1 未验证通过前不进入步骤 2 及之后。
2. **实现中**：严格按 §7 分步提交；写入路径 A（改动生产路径）和路径 B（新增运维脚本）分开提交，便于分别 review 回归风险。
3. **实现后**：勾选 §4 验收清单；状态更新为 `Done — YYYY-MM-DD`；ADR-003 状态同步改为 `Accepted`。

---

## 9. 后续扩展（Out of Scope）

- CET4/CET6/托福看板 UI
- 回填"生产路径改造前、ECDICT 里也没有"的词到 `words` 表（词库全量覆盖率）
- `words` 表大小写重复行的数据清理
- Web 端标记入口、"阅读障碍"独立状态、间隔重复复习提醒、词库后台管理界面
