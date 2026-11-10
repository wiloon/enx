---
status: accepted
date: 2026-11-11
related: AGENTS.md §enx-api（「SQL lives in `repo/`」）、docs/agents/enx-api-design.md §Layer Separation、PR #799
---

# ADR-078：enx-api 的包布局——领域包自带 HTTP 与适配器，技术层包逐步退场

enx-api 根目录下现在有 42 个目录，其中 33 个是 Go 包（另有 `cmd/`）。这些包有两种组织方式并存：

- **按领域分包**（多数）：`account`、`referral`、`preferences`、`entitlement` 的核心不引用 gin / gorm，SQL 和外部 API 放在各自的 `adapters/` 子包里，通过接口注入；`reader`、`savedpage`、`wordlist`、`stats`、`userstats`、`adminuser` 这些简单的 CRUD 包把 `handler.go` 和存储放在同一个包里。
- **按技术分层**（遗留）：
  - `handlers/`：11 个文件，横跨账户、邀请、偏好、查词、额度流水、版本、健康检查，是「领域核心不碰 gin」之后 HTTP 代码没地方放的产物。
  - `repo/`：25 个非测试文件，装着几乎所有领域的 SQL。它 import 24 个领域包（`account`、`adminuser`、`referral`、`userstats`、`creditledger`、`reader/saving` 和 18 个 `billing/*` 子包），返回领域类型——依赖方向是对的，只是所有领域的适配器挤在同一个包里。AGENTS.md 规定「SQL lives in `repo/`」，与 `account/adapters` 等子包的做法形成两套规则。
  - `enx/`：名字不是领域概念。里面是 `Dictionary`（只有 `ecdict` 用）、`Word` / `AIFallback`（查词，active-record 风格直接读写全局 DB）、`User` / `GetOrCreateClerkUser` / `SetNewUserHook`（本地用户身份）、`TextWords`（段落取词状态）。还有一个提交进 git 的 0 字节 `enx/enx.db`。
  - `utils/`：`logger`、`password`、`sqlitex`。`sqlitex` 除了 DB 连接，还放着全部 gorm 表模型（`billing_models.go`、`referral_models.go` 等）、集中的 `AutoMigrate` 列表和跨表的启动迁移（`users_rebuild.go` 559 行、`billing_cutover.go`、`deletion_gates.go`），并为清理缓存音标 import 了 `ecdict`。
- **有核心的领域包里也混着框架代码**：gin 出现在 `billing/` 顶层的 `handler.go`、`admin.go`、`conflict_admin.go`、`portal_session.go`、`receipt.go`、`support.go`、`webhook_event_admin.go`，`dictionary/lookup.go`（`RespondUnavailable`、`RespondQuotaExceededWithSubscriptions` 两个响应函数），`feedback/handler.go`；gorm 出现在 `billing/trial.go` 和 `billing/credit` 的 8 个文件。非测试代码里直接 import `sqlitex` 的领域核心是 `billing`（只有 `billing/handler.go` 一个文件，第 4 阶段随 handler 进 `billing/httpapi` 后自然消失）和 `billing/credit`（第 9 条的例外）。

后果是：新代码该放哪里要看「这个领域当初是谁写的」；读一个领域要在 `handlers/`、`repo/`、`enx/`、`utils/sqlitex/` 和领域包之间来回跳；`server/router.go` 463 行，一个领域有哪些接口要在这里翻；根目录同一层既有领域，也有技术层，还有一次性脚手架（`dictsample`）和只服务一个调用方的小工具包（`urlnorm`）。

我们决定：**以领域包为组织单位。领域核心保持纯净，它的 HTTP 边缘（`httpapi/`）和 I/O 适配器（`adapters/`）作为子包挂在领域下面；`handlers/`、`repo/`、`enx/` 从本 ADR 接受起冻结，逐步拆空后删除；`utils/` 改名为 `platform/`，只放与领域无关的基础设施；表模型和启动迁移集中到顶层 `schema/`。不引入 `internal/`。**

## Decision

1. **一个领域一个顶层包，按复杂度选两种形态。**
   - **有领域核心的**（`account`、`billing`、`dictionary`、`referral`、`preferences`、`entitlement`、`feedback`）：核心包不 import gin、gorm、`database/sql`、`net/http` 客户端；`<领域>/adapters` 放 SQL 和外部 API 的实现；`<领域>/httpapi` 放 gin handler。依赖方向只能是 `httpapi → 核心 ← adapters`，由 `server/` 组装。
   - **简单 CRUD**（`reader`、`savedpage`、`wordlist`、`stats`、`userstats`、`adminuser`）：维持现状，handler、存储、规则同包。不为了对称而拆子包（AGENTS.md「Plain stays plain」）。一个 CRUD 包长出了真正的规则，再升级成第一种形态。
   - **未在本 ADR 列出的包维持现状**：`config`、`middleware`、`server`、`metrics`、`email`、`ecdict`、`ailimit`、`ratelimit`、`aitranslate`、`translate`、`version`、`cmd/`。`version` 包不动，因为 `.ko.yaml` 和 `build/build.sh` 用 `-X enx-api/version.*` 在构建时写入版本号；搬走的只是 `handlers/version.go` 这个 HTTP handler。

2. **每个 `httpapi` 子包导出自己的路由注册函数。** 形如 `Register(r gin.IRouter, deps Deps)`：领域在这里列出自己的全部接口；`server` 只组装依赖、挂中间件、按顺序调用各领域的 `Register`。加接口不再需要改 `server/`。子包名定为 `httpapi`：不遮住标准库的 `net/http`，也比 `web` 准确（这里没有页面）。

3. **HTTP 代码的去向：**

   | 现位置 | 去向 |
   |---|---|
   | `handlers/account.go`、`handlers/me.go` | `account/httpapi` |
   | `handlers/referral.go` | `referral/httpapi` |
   | `handlers/preferences.go` | `preferences/httpapi` |
   | `handlers/word_lookup.go`、`known_word.go`、`review_words.go`、`admin_dictionary.go`；`dictionary/lookup.go` 里的两个 `Respond*` 函数；整个 `paragraph` 包 | `dictionary/httpapi` |
   | `billing/` 顶层的 7 个 gin 文件（见背景） | `billing/httpapi` |
   | `feedback/handler.go` | `feedback/httpapi` |
   | `handlers/credit_history.go` | `billing/httpapi`（`billing/creditledger` 是核心，只有 `ledger.go`，不放 handler） |
   | `handlers/ping.go`、`handlers/version.go` | `server/`（属于进程而不是领域） |

   `paragraph` 包只有一个 handler，包着 `TextWords`（见第 5 条），并入后删除。

4. **`repo/` 按领域拆进 adapters，然后删除。** `repo/` 已经依赖领域包而不是反过来，所以按文件搬迁不会产生循环依赖。按「这个文件实现的是哪个领域的接口」归属：
   - `account*.go` → `account/adapters`；`referral.go` → `referral/adapters`；`ecp*.go`、`review_words.go`、`lookup_events.go` → `dictionary/adapters`；`credit_ledger.go` → `billing/creditledger`；`reader_documents.go` → `reader`；`user_stats.go` → `userstats`；`admin_*.go` → `adminuser`。
   - **计费相关的全部进一个 `billing/adapters`**（`billing_*`、`subscription_*`、`invoice_paid`、`checkout_completed`、`charge_refunds`、`webhook_*`、`portal_session_owners`、`accepted_subscriptions`、`alerts`），包内按文件分。`repo/` 实现了 18 个 `billing/*` 子包的接口，按子域各建一个 `adapters` 会多出十几个只有一两个文件的包，跳转成本比现在还高。哪个子域的适配器真的长大了再单独拆。

5. **`enx/` 拆散后删除。**
   - `Dictionary` → `ecdict`。
   - `User`、`GetOrCreateClerkUser`、`SetNewUserHook`、`ClerkProfile` → `account`（DB 部分进 `account/adapters`）。GLOSSARY 把「本地用户身份」「外部认证身份」「注销账号」「禁用账号」放在同一节「身份与账户」下，注销和禁用操作的就是这个 User；单独建 `identity` 包会把账户的生命周期拆在两个包里。
   - `Word`、`AIFallback` → `dictionary`。直接读写 DB 的 `Save` / `FindId` / `FindQueryCount` 改成注入的适配器，放 `dictionary/adapters`；核心只留实体和规则。
   - `TextWords` → `dictionary`，不放进它唯一的调用方 `paragraph`。它执行的都是查词规则：把一个 token 规整成词（`Word.SetEnglish`，ADR-043 的大小写与撇号折叠）、跳过数字开头的 token、按用户的复习状态标注每个词，返回的也是 `dictionary.Word`。`paragraph` 只是把它暴露成 HTTP 接口的边缘，按第 3 条并入 `dictionary/httpapi`。
   - 删除 `enx/enx.db`，在 `enx-api/.gitignore` 加 `*.db`。

6. **`utils/` 改名为 `platform/`，`sqlitex` 拆成两层。**
   - `platform/logger`、`platform/password`、`platform/signal`（原 `utils/signal.go`）、`platform/clerktest`（原顶层 `clerktest`，只有测试用）。
   - `platform/sqlitex`：只留连接、pragma、事务、SQL 日志这类纯基础设施。
   - 顶层 `schema/`：全部 gorm 表模型、`AutoMigrate` 列表、启动迁移（`users_rebuild`、`billing_cutover`、`deletion_gates`、`webhook_receipts`、`subscription_ownership`、`credit_provenance` 等）、`CheckBillingSchema` 和 `cleanCachedEcdictPhonetics`。它可以 import `ecdict`。
   - 这样仍然是「一处看清全部表」，跨表迁移和 `AutoMigrate` 的顺序集中在 `schema/`；而 `platform/` 下的包一律不 import 领域包，没有例外。表模型不随领域分散，理由见 Considered Options。

7. **小包合并：**
   - `urlnorm` → 并入 `savedpage`（唯一调用方；ADR-032 当初为与 `pagereport` 共享而抽出，`pagereport` 后来并入 `feedback`，`feedback` 用自己的 `url.go`）。
   - `creditledger` → `billing/creditledger`（ADR-063 的额度流水，属于计费）。
   - `dictsample` → 保留在顶层，不搬不删（owner 确认，2026-11-11）。ADR-030 Decision 0 的埋点已经写好，但从未开启：`config.toml` 默认 `sampling = false`，homelab 和生产都没有设 `ECDICT_SAMPLING`，线上没有 `DICTSAMPLE` 日志。开不开、何时连同 `scripts/dictsample-report.sh` 一起删除，由 ADR-030 决定。

8. **以下包看似重叠，保持分开：**
   - `ailimit`（AI 花费上限，ADR-045/048）和 `ratelimit`（全站请求限流，ADR-060）。
   - `stats`（用户自己的阅读统计，ADR-028）、`userstats`（运营看的用户数，ADR-058）和 `metrics`（Prometheus，ADR-040）。`stats` / `userstats` 的命名容易混淆，改名先走 `domain-modeling` 在 GLOSSARY 里定术语，不在本 ADR 范围。
   - `translate`（查词翻译流程）和 `aitranslate`（AI 供应商适配）。`translate` 是否并入 `dictionary` 另行评估。

9. **例外：`billing/credit` 和 `billing/trial.go` 保留 gorm。** 额度账本按 ADR-009 Decision 5 用条件更新加事务实现「检查余额→扣减→记流水」的原子性，`TrialGrant.NewUser` 要接收建用户的同一个 `*gorm.DB` 事务。把事务从核心里抽象出去是重新设计，不是搬迁，不在本 ADR 范围。depguard 规则把这两处明确排除，并注释指向本条。

10. **非代码目录：**
    - `build/` 不动：`deploy-prod.yml` 和 homelab Tekton（仓库外）引用了 `enx-api/build/*.sh`、`build.conf`。
    - `migrations/`、根目录 `testdata/`（被 `billing/app`、`repo`、`utils/sqlitex` 三个包的测试共用）不动。
    - `examples/`（1 个 JSON）、`test/`（4 个 `.http` 手工请求文件，名字容易误认为是测试代码）、根目录的 `TESTING.md`、`TASKFILE_README.md`、`VERSION_API.md`、`enx.puml` 移入 `enx-api/docs/`，同时修好引用它们的链接。
    - `deploy/`（Jenkins 脚本、systemd unit）删除：仓库内没有任何地方引用，homelab 和 prod 都已改用 GitHub Actions 部署，owner 确认已废弃（2026-11-11）。
    - `scripts/` 不动：`dictsample-report.sh` 随 `dictsample` 保留。

11. **不引入 `internal/`。** enx-api 是一个应用，不是被别人 import 的库，`internal/` 唯一的好处（禁止外部 import）在这里用不上，代价却是改动全部 import 路径。完成本 ADR 后，顶层 Go 包从 33 个降到 27 个（删除 `handlers`、`repo`、`enx`、`paragraph`、`urlnorm`、`creditledger`、`clerktest`、`utils`；新增 `platform`、`schema`），非代码目录从 8 个降到 5 个（删除 `deploy`、`examples`、`test`）。

## Considered Options

- **保留 `handlers/` / `repo/` 这种技术分层（现状）。** 改动为零，但两套规则继续并存。每个新领域都要在「放进 `repo/`」和「自带 `adapters/`」之间选一次，而最近的领域（account、referral、preferences、feedback）都已经选了后者。
- **把 handler 直接放回领域核心包（`account/handler.go`）。** 简单 CRUD 包就是这么做的，但对有核心的领域会把 gin 带进核心，违反 AGENTS.md「A domain core free of frameworks and I/O」。所以只对 CRUD 包保留这种形态。
- **`repo/` 的计费部分按子域拆进 `billing/<子域>/adapters`。** 形式上最对称，但会多出十几个极小的包。同一个 SQLite、同一组表，一个 `billing/adapters` 内部按文件分更好读。
- **表模型随领域搬进各自的 `adapters/`，由 `server` 把模型列表传给迁移。** 更「纯」，但 `users_rebuild`、`billing_cutover`、`deletion_gates` 这类跨表迁移会失去落脚点，`AutoMigrate` 的顺序也会分散到组装代码里。收益只有「模型和 SQL 挨在一起」，风险落在启动迁移上。以后某个领域的表真的独立了，可以单独搬。
- **表模型留在 `platform/sqlitex`。** 少拆一次，但模型是领域形状的东西，`platform/` 不 import 领域包的规则从第一天起就要靠例外撑着（`ecdict`）。顶层 `schema/` 既保住「一处看清全部表」，又让 `platform/` 真正与领域无关。
- **全部收进 `internal/`，按 `internal/domain/…`、`internal/platform/…` 分层。** 根目录最干净，但会改动每一个 import，和本 ADR 的其他迁移叠在一起 review 不动；收益又如第 11 条所述。
- **一次性大搬迁。** 一个 PR 完成全部移动。diff 巨大，和并行开发（包括无人值守 agent）冲突，出问题难以定位。改为下面的分阶段。

## Consequences

- **本 ADR 合并时**，AGENTS.md §enx-api 的「SQL lives in `repo/`」改为「新 SQL 写进领域的 `adapters/`（CRUD 包写在包内）；`repo/`、`handlers/`、`enx/` 是遗留，只减不增」，`docs/agents/enx-api-design.md` 的分层说明同步更新。这样迁移期间新代码就不会继续流进这三个目录。拆空 `repo/` 的那个 PR 再删掉「遗留」的说法。
- 已接受的 ADR 里出现的旧路径（如 ADR-029、ADR-048 的 `utils/sqlitex/billing_models.go`、ADR-061 的 `handlers/word_lookup.go`）不改，它们是历史记录。
- **depguard 规则逐包提前开，不留到最后：**
  - 第 1 阶段：`account`、`referral`、`preferences`、`entitlement` 的核心已经不 import gin / gorm，立即开规则，防止回退。
  - 之后每搬完一个领域的 HTTP 和 SQL，就把它加进规则的 `files` 列表（第 9 条的例外除外）。
  - 第 3 阶段改名为 `platform/` 时，同时开「`platform/**` 不得 import 领域包」。
  - 写法照 `.golangci.yml` 里已有的 `koanf-only-in-config`。
- **测试：** 只移动文件、改 import 和 package 声明的阶段，由编译器和现有测试保证，不补特征测试。代码形状有变化的地方要先补测试、看它在旧代码上绿、搬完仍绿：`Word` 从 active-record 改成注入的适配器（第 5 阶段），`sqlitex` 拆出 `schema/`（第 3 阶段），各 `httpapi` 的 `Register` 替换 `server/router.go` 里的路由（第 4 阶段，用现有的 `server` 集成测试覆盖路由表）。
- **搬迁 PR 的纪律：** 只移动文件，改 import、package 声明和测试里读 fixture 的相对路径（如 `repo/subscription_conflicts_test.go` 的 `../testdata/...`、`utils/sqlitex/billing_schema_check_test.go` 的 `../../testdata/...`，搬家后层级会变），不夹带任何其他修改，保证 `git log --follow` 能跟上；开 PR 前确认 `ready-for-agent` 队列里没有碰同一个领域的 issue；当天开、当天合，避免和无人值守 agent 的改动反复 rebase。

### 实施分阶段（接受后转为 GitHub issue 的任务列表）

按风险从低到高，每一步一个 PR，都可以单独回滚：

1. **清理与护栏**：删除 `enx/enx.db`，`.gitignore` 加 `*.db`；删除 `deploy/`；`examples/`、`test/` 和根目录的 md 文档移入 `docs/`；给 `account`、`referral`、`preferences`、`entitlement` 开 depguard 规则。
2. **小包合并**：`urlnorm` → `savedpage`；`creditledger` → `billing/creditledger`；`clerktest` → `platform/clerktest`。
3. **`utils/` → `platform/`，拆出 `schema/`**：先纯改名，再把模型和迁移搬进 `schema/`；开 `platform/**` 的 depguard 规则。
4. **HTTP 进 `httpapi`**：按第 3 条，一个领域一个 PR（`account`、`referral`、`preferences`、`dictionary` 含 `paragraph`、`feedback`、`billing`），同时把该领域的路由从 `server/router.go` 移进它的 `Register`；`ping` / `version` 进 `server/`；`handlers/` 拆空后删除。
5. **拆 `enx/`**：先 `Dictionary` → `ecdict`，再 `User` 系列 → `account`，最后 `Word` 系列和 `TextWords` → `dictionary`。
6. **拆 `repo/`**：按领域分批，`billing/adapters` 单独成一个或多个 PR。拆空后删除 `repo/`，并删掉 AGENTS.md 里「遗留」的说法。

每个领域搬完，就把它加进 depguard 规则。
