# 首次查词延迟偏高问题记录

## 现象

homelab k8s 上查询单词 `topological`，第一次查询明显比之后再查同一个词慢。

## 环境

- Pod: `enx-api-89c946ffb-8f9vb`（namespace `enx`）
- 用户: `user_id=94dcde6e-cb24-453f-baad-3d39af0d8b93`
- 日期: 2026-07-22

## 复现过程（日志还原）

### 第一次查询（冷）— 00:41:16.726 → 00:41:16.827，共 ~101ms

请求 `GET /api/translate?word=topological` 进入后：

| 步骤 | 耗时 | 说明 |
|---|---|---|
| `UPDATE users SET last_login_time=...` | 30.731ms | 每次请求都会执行，非本次问题特有 |
| `SELECT count(*) FROM words WHERE LOWER(english)=LOWER(?)` | 2.115ms | `word.RemoveDuplicateWord()` 触发 |
| `SELECT * FROM words WHERE english=?`（精确） | 0.143ms, 0 rows | `enx.Word.Translate()` → `repo.Translate()` → `GetWordByEnglish` 第 1 次 |
| `SELECT * FROM words WHERE LOWER(english)=LOWER(?)` | 6.300ms, 0 rows | 同上，未命中 |
| `SELECT * FROM words WHERE english=?`（精确） | 0.149ms, 0 rows | `dictionary.Lookup()` → `GetWordByEnglish` **第 2 次**，与上面参数完全相同 |
| `SELECT * FROM words WHERE LOWER(english)=LOWER(?)` | 6.494ms, 0 rows | 同上，未命中 |
| ECDICT 查询命中 | ~13ms | `ecdict.Query`，本地 ECDICT sqlite 库 |
| `INSERT INTO words (...)` | 19.969ms | 把 ECDICT 结果写入本地 `words` 缓存表 |
| `INSERT INTO user_dicts (...)` | 20.098ms | 新建用户查词记录 |

### 之后再查同一个词（热）— 00:42:57.004 → 00:42:57.034，共 ~30ms

`words` 表已有该词，只需：`SELECT count(*)`（2.1ms）+ `SELECT * FROM words`（0.2ms，命中）+ `SELECT * FROM user_dicts`（0.15ms）三次快速查询，无 INSERT。

## 根因分析

1. **本地词典缓存未命中（首次全局查询该词）**，需要回源到内置 ECDICT 库查询，再回写两条新记录（`words` + `user_dicts`），这两条 `INSERT` 各约 20ms，是慢的主要部分。
   - 打开 SQLite 时（`enx-api/utils/sqlitex/sqlitex.go:116`）未设置 `journal_mode=WAL` / `synchronous=NORMAL`，默认 `synchronous=FULL` 下每次写事务都要 fsync，这是 INSERT 耗时的主因，homelab 存储越慢（如 NFS/慢盘 PVC）越明显。

2. **`GetWordByEnglish` 被重复调用了一次**，属于代码逻辑冗余：
   - `enx.Word.Translate()`（`enx-api/enx/ecp.go:118`）→ `repo.Translate()`（`enx-api/repo/ecp.go:123`）已经查了一遍本地 `words` 表（未命中）
   - 紧接着 `dictionary.Lookup()`（`enx-api/dictionary/lookup.go:31`）又对同一个词、同样的查询条件再查了一遍，白白多跑 2 条 SQL（约 6.6ms，因为 `words.english` 无索引，`LOWER()` 又用不到索引，是全表扫描）

3. **`last_login_time` 每次认证请求都无条件 UPDATE，不只发生在首查**：
   - 认证中间件 `middleware/cognito_auth.go:144` 校验完 JWT 后，每次请求都调用 `enx.GetOrCreateByCognitoSub()`（`enx-api/enx/user.go:112`）
   - 该函数原逻辑：只要用户存在就无条件 `UPDATE users SET last_login_time=?, updated_at=?`，没有节流，字段名叫"最后登录时间"但实际每次 API 调用都刷新，语义上其实是"最后活跃时间"
   - 这条 UPDATE 同样受 SQLite `synchronous=FULL`（无 WAL）影响，日志中稳定耗时 20-60ms（如 30.731ms、63.093ms、56.014ms），且发生频率比 ECDICT 回源更高——**每一次**带 token 的请求都有一次，不管查没查到新词
   - **已修复**（见下方"已实施"）：加节流，超过配置的时间间隔才写一次
   - **存储位置与作用**：`last_login_time` 是 `users` 表（SQLite，`enx-api/utils/sqlitex/sqlitex.go:33` / `enx-api/enx/user.go:30`）里的一个持久化字段，不是内存缓存。写入路径有两处：用户首次登录创建时（`GetOrCreateByCognitoSub` 新建分支，`enx-api/enx/user.go:150`）和之后每次请求的更新分支。当前**没有任何地方读取它用于业务逻辑**——`GET /api/me`（`enx-api.go:379`）只返回 `id/name/email/status`，没有暴露这个字段；代码库里也没有基于它做过滤或排序的查询。也就是说目前它是纯"写入型"的活跃时间戳，实际作用是为将来可能的"最近登录/活跃"展示或运营统计预留数据，现状下不影响任何读路径，所以加节流是安全的。

4. **`word.RemoveDuplicateWord()` 是死代码，每次查词都白跑一条 `COUNT` 查询**：
   - `enx.Word.Translate()`（`enx-api/enx/ecp.go`）开头无条件调用 `word.RemoveDuplicateWord()`，对应日志里那条 `SELECT count(*) FROM words WHERE LOWER(english)=LOWER(?)`（~2.1ms）
   - 该逻辑是 2025-03-15（commit `a7260a8`，"fix duplicate word"）在老的 MySQL/非 UUID 系统上加的，用于清理并发写入产生的重复词条
   - 现状：`repo.DeleteDuplicateWord`（`enx-api/repo/ecp.go:141-145`）已经是空函数，注释明确写着「This function is no longer needed with UUID-based P2P system, Duplicates are prevented by unique constraint on english field」；`words` 表也确实有 `CONSTRAINT uni_words_english UNIQUE (english)`（见 auto-migration 建表 SQL），数据库层面已不可能出现重复 `english`
   - 也就是说 `count > 1` 这个分支现在永远走不到，`RemoveDuplicateWord()` 每次查词都是纯开销、没有任何实际效果

## 优化方向

### 已实施

1. **`last_login_time` 更新节流**：`enx.GetOrCreateByCognitoSub()`（`enx-api/enx/user.go`）改为只有当 `now - existing.LastLoginTime >= 配置的间隔` 才执行 UPDATE，否则跳过，直接复用已有的 user id。
   - 新增配置项 `user.last-login-update-interval`（环境变量 `USER_LAST_LOGIN_UPDATE_INTERVAL`），Go duration 格式（如 `5m`、`30s`）
   - **默认值：`5m`**——足够粗粒度地反映用户"最近活跃"，同时把这条写入频率从"每请求一次"降到"每个用户每 5 分钟最多一次"，在正常查词场景下几乎消除这部分开销
   - 配置入口：`enx-api/utils/viper.go`

2. **消除重复查询**：`dictionary.Lookup()`（`enx-api/dictionary/lookup.go`）不再内部查一遍本地 `words` 表——原来的调用方 `DoSearch` 已删除，`fillFromEcdict()`（`enx-api/translate/helpers.go`）是唯一调用方，且调用前已经通过 `word.Id == ""` 确认本地未命中，`Lookup()` 直接精简成只查 ECDICT。连带删除了只在这条路径里用到的 `FromRepoWord()` 辅助函数。`enx.Word.Translate()` 里的第一次查询（正常缓存命中路径唯一的数据来源）没有改动。首查现在本地 `words` 表只查 1 遍。

3. **业务 SQLite 开启 WAL 模式**：`enx-api/utils/sqlitex/sqlitex.go` 打开主库时，DSN 加上 `?_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)`。只改主库（`words`/`user_dicts`/`users` 所在库）；ECDICT 只读库（`mode=ro`）没有改动，不需要也不能开 WAL。

4. **`words.english` 表达式索引**：`AutoMigrate()` 之后加了一行 `DB.Exec("CREATE INDEX IF NOT EXISTS idx_words_english_lower ON words(LOWER(english))")`（`enx-api/utils/sqlitex/sqlitex.go`），跟现有"迁移老用户 status"那段手动迁移代码同样的写法。`english` 列本身保持区分大小写、不加 `COLLATE NOCASE`。同步做了：
   - 新增 `enx-api/migrations/006_words_english_lower_index.sql`，记录同一条 SQL（这个目录下的文件本身不会被自动执行，只是文档；真正生效靠 `sqlitex.go` 里的 `DB.Exec`）
   - 更新了 `enx-api/schema.sql`：去掉 `words.english` 上过期的 `COLLATE NOCASE`，把对应的 `idx_words_english` 索引换成新的 `idx_words_english_lower` 表达式索引，并在文件顶部加了一条说明——这份 `schema.sql` 是历史/参考快照，不会被自动应用，真正的 schema 由 GORM `AutoMigrate` + `migrations/` 管理（`users` 表那部分因为更早、更明显的过期，也一并标注了）

5. **删除死代码 `RemoveDuplicateWord()`**：`enx.Word.Translate()`（`enx-api/enx/ecp.go`）里对它的调用已删除；`RemoveDuplicateWord()`、`repo.GetWordByEnglishCaseSensitive()`、`repo.DeleteDuplicateWord()` 一并删除（没有其他调用方）。`repo.CountByEnglish` / `enx.Word.CountByEnglish()` 保留，因为集成测试还在用。
   - 测试改名：`TestRemoveDuplcateWord` → `TestSaveDuplicateEnglish_UniqueConstraintPreventsDuplicate`（`enx-api/enx/ecp_integration_test.go`），反映它现在测的是数据库唯一约束，不是被删掉的去重逻辑。

6. **删除 `DoSearch` 与所有 MySQL 相关遗留代码，修复 SQL 注入**：
   - `enx-api.go`：删除了 `DoSearch` 处理函数和它的两处路由注册（`/do-search`）
   - `enx-api/enx/enx.go`：删除了 `Search()`、`instance()`、`FindOne()`、包级变量 `enxDb`；`Dictionary` struct 保留（被 `ecdict`、`dictionary`、`enx-api.go` 多处复用，跟 MySQL 无关）
   - `enx-api/utils/mysql/` 整个包已删除（`config.go`、`database.go`、`database_test.go`）
   - `enx-api/utils/viper.go`：删除了 `mysql.address` / `mysql.user` / `mysql.password` 三个 `BindEnv`
   - SQL 注入（`enx.Search()` 字符串拼接拼 SQL）随死代码删除一并修复
   - `DoSearchEcdict` 保留，去掉了 `words := enx.Search(key)` 和 `result.WordList = words` 两行；`SearchResult` 结构体的 `WordList []string` 字段整体删除（没有调用方了），现在只返回 `Dict`（纯查 ECDICT，不再触碰 MySQL）

## 结论

不是网络问题，也不是 ECDICT 本身慢（~13ms，符合 ADR-0001 里 <50ms 的预期），而是"缓存未命中 → 回源 → 两次写库(fsync)"的正常首查开销，被一个重复查询的小 bug、一条死代码遗留的 COUNT 查询又放大了一些。首查 ~101ms vs 热查 ~30ms，差距主要来自两条 INSERT（~40ms）+ 重复查询（~13ms）+ ECDICT 回源（~13ms）+ 死代码 COUNT（~2ms）。另外 `last_login_time` 的无节流 UPDATE（20-60ms）虽不是首查独有，但发生在每一次认证请求上，是比首查更高频的开销点，已加节流修复。

## 参考

- [[docs/adr/0001-integrate-ecdict-dictionary.md]] — ECDICT 集成的原始设计决策
- `enx-api/repo/ecp.go` — `GetWordByEnglish`、`Translate`、`CountByEnglish`
- `enx-api/dictionary/lookup.go` — `Lookup`
- `enx-api/translate/helpers.go` — `fillFromEcdict`
- `enx-api/translate/service.go` — `translateWord`
- `enx-api/utils/sqlitex/sqlitex.go` — SQLite 连接初始化（WAL + `idx_words_english_lower` 已加）
- `enx-api/middleware/cognito_auth.go` — 认证中间件，每次请求调用 `GetOrCreateByCognitoSub`
- `enx-api/enx/user.go` — `GetOrCreateByCognitoSub`（已加节流）
- `enx-api/utils/viper.go` — `user.last-login-update-interval` 配置项
- `enx-api.go` — `DoSearch`（已删除）、`DoSearchEcdict`（保留，已去掉 `enx.Search`/`WordList`）
- `enx-api/enx/enx.go` — `Search`/`instance`/`FindOne`（已删除，原是老 MySQL 后端，有 SQL 注入）、`Dictionary`（保留，被多处复用）
- `enx-api/utils/mysql/` — 已整包删除
- `enx-api/enx/ecp_integration_test.go` — `TestSaveDuplicateEnglish_UniqueConstraintPreventsDuplicate`（原 `TestRemoveDuplcateWord`）
- `enx-api/schema.sql` — 历史/参考快照，已更新 `words.english` 相关部分并加了说明
- `enx-api/migrations/006_words_english_lower_index.sql`（新增）、`005_cognito_migration.sql`（格式参考）
