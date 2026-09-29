# ADR-040：enx-api 用 Prometheus 指标监控响应时间与服务健康——不写数据库、不用 CloudWatch；生产经 Alloy 推到 Grafana Cloud

| 字段 | 值 |
| --- | --- |
| **状态** | Accepted — 2026-09-29。生产推 Grafana Cloud 免费版，不回 homelab；homelab 用自建 Prometheus + Grafana，经 `ServiceMonitor` 抓取；告警推迟（Decision 6）。enx-api 埋点随本 ADR 的 PR 落地；采集配置（homelab `ServiceMonitor`、EC2 Alloy）和 dashboard 在 `w10n-config` 另行实施 |
| **日期** | 2026-09-28 |
| **关联** | [`adr-018-dictionary-lookup-single-metered-seam.md`](adr-018-dictionary-lookup-single-metered-seam.md)（查词计量 seam）、[`adr-030-dictionary-provider-chain-and-fallback-sources.md`](adr-030-dictionary-provider-chain-and-fallback-sources.md)（Decision 0 ② miss 率采样，`dictsample`）、[`adr-031-production-deployment-topology.md`](adr-031-production-deployment-topology.md)（生产 = 单台 EC2 东京 + SQLite 单写者；发布不依赖作者家的网） |

---

## Context

上线后需要回答两类问题：**用户等了多久**（体验），以及**服务是否健康**（出事能先于用户发现）。目前 enx-api 两者都答不了：

- 没有任何耗时度量。（写作时的请求日志只记方法和路径；#72 已改成每请求一条结构化日志，带 `status` 和 `duration_ms`，见 Decision 4。）
- 查词路径的命中来源只有 ADR-030 的 `dictsample` 临时采样（默认关闭、计划整包删除），拿不到长期的命中率。
- 生产和 Grafana 不在一处：生产是东京 EC2（ADR-031），homelab 有 kube-prometheus-stack + Grafana + Loki + Alloy，但 homelab 只在作者家里。

维护者最初关心的三类耗时：

1. 查词命中本地 `words` 表直接返回；
2. `words` 未命中、回落查 ECDICT；
3. AI 整句翻译。

代码上的关键事实：

- 查词入口是 `GET /api/translate` 和 `GET /api/word/:word`（`translate.Handler`）。查本地 `words`、回落 ECDICT、回填缓存、计量都在 `dictionary.Service.Resolve` 里（ADR-018 深 seam，#64/#70），它返回的 `Result.Source` 就是来源：`local` / `ecdict` / `miss`。
- AI 调用都经过 `aitranslate.Translator` 接口（`TranslateSentence`、`TranslateWordInContext` 等）和 `rephrase.Rephraser` 接口，由 `aitranslate/factory.go`、`rephrase_factory.go` 按 provider 构造，返回值带 `Usage`（token 数）。目前**全部非流式**。
- 每个接口只在 `/api` 下注册一次（#69），路由模板唯一。

## Options Considered

### 存到哪

#### A. 写数据库（每请求一行耗时记录）

| Pros | Cons |
| --- | --- |
| 用现成的 SQLite；能按用户/单词任意 SQL 追查 | SQLite 单写者（ADR-031）：每个请求多一次写，与业务写抢锁，监控本身就会拖慢被监控的东西；p95/p99 要自己写 SQL 聚合；数据量线性增长，需要清理任务；Grafana 画图要再接 SQLite 数据源 |

#### B. 只写结构化日志，从日志里算

| Pros | Cons |
| --- | --- |
| 单条请求细节完整，排障最有用 | 从日志算分位数趋势慢且贵（Loki 要扫全量行）；告警规则写起来别扭；日志采样/丢失会直接失真 |

#### C. AWS CloudWatch 自定义指标

| Pros | Cons |
| --- | --- |
| EC2 上天然可用、托管、不依赖作者家 | 自定义指标每个（每种维度组合）约 $0.30/月，加上 `route × status × source` 很快上百条；原生看板弱，要 Grafana 还得付 Amazon Managed Grafana（按用户计费）；锁在 AWS 上，homelab staging 用不了同一套 |

#### D.（采用）Prometheus 指标 + Grafana，日志作补充

| Pros | Cons |
| --- | --- |
| 直方图原生给 p50/p95/p99，内存里聚合、对请求路径几乎零开销；与 homelab 现有 kube-prometheus-stack/Grafana 同构，staging 与生产共用 dashboard；厂商中立（Grafana Cloud、自建、甚至 CloudWatch 都能收 remote_write） | 多一个依赖（`client_golang`）；标签基数要自律（见 Decision 3）；生产需要解决「指标送到哪」（Decision 5） |

### 埋点 SDK：`client_golang` vs OpenTelemetry

OTel 能顺带做 tracing，但当前只有一个 Go 服务、没有跨服务调用链，tracing 收益很低，而 OTel metrics SDK 的配置面明显更大。选 `client_golang`；将来要 tracing 时 OTel 可以和它并存（或经 Alloy 转换），不是单向门。

## Decision

### 1. 指标清单（v1）

所有指标前缀 `enx_`。耗时一律用直方图（`_seconds`），计数一律 `_total`。

**查词**

- `enx_dictionary_lookup_duration_seconds{source}` —— 直方图，`source ∈ {local, ecdict, miss}`（`miss` = words 与 ECDICT 都没有）。度量范围是**整个查词 handler**（含 `words` 查询、配额计量、ECDICT、回写 `words`），即服务端视角下用户等的时间。桶：5ms, 10ms, 25ms, 50ms, 100ms, 250ms, 500ms, 1s, 2.5s。
- 同一直方图的 `_count` 按 `source` 相除即是命中率 / miss 率，长期替代 `dictsample`（`dictsample` 按 ADR-030 原计划删除，不在本 ADR 范围内删）。
- 配额拒绝（429）、ECDICT 不可用（503）不进这个直方图——它们没有完成一次查词——而体现在 HTTP 指标的状态码上。

**AI**

- `enx_ai_request_duration_seconds{provider, operation, outcome}` —— 直方图。`operation ∈ {translate_sentence, word_in_context, sentence_with_word, rephrase}`，`outcome ∈ {ok, error, timeout}`。桶：250ms, 500ms, 1s, 2s, 4s, 8s, 15s, 30s, 60s。
- `enx_ai_tokens_total{provider, operation, direction}` —— 计数器，`direction ∈ {input, output}`，来源是 `Usage`。与 `token_ledger` 的关系：ledger 是**按用户计费的账**（留在库里），这个计数器只是**总量趋势图**，两者不互相替代。
- 当前都是非流式，不做首 token 耗时。将来改流式时补 `enx_ai_time_to_first_token_seconds`——那才是用户感知的等待。

**HTTP 通用（RED）**

- `enx_http_requests_total{route, method, status}`、`enx_http_request_duration_seconds{route, method}`。`route` 取 `c.FullPath()` 的模板值（如 `/api/word/:word`），**未匹配路由统一记为 `unmatched`**。`status` 按原值记（数量有限），看图时区分 5xx / 429 / 401。

**外部依赖与存储**

- `enx_clerk_verify_duration_seconds{outcome}` —— 每次 Clerk token 校验的耗时与结果，`outcome ∈ {ok, missing_token, expired, invalid, unauthorized_party, provision_error, unavailable}`。鉴权失败在用户那里表现为「会话过期」，非常难从用户描述反推。（起草时还列了 `enx_clerk_jwks_fetch_total`；JWKS 由 `keyfunc` 在内部拉取和缓存，不提供拉取回调，改它的存储层不值得。JWKS 刷新会走网络，直接表现为这个直方图的耗时尖峰，所以不单列。）
- `enx_stripe_webhook_total{event_type, outcome}` —— 付了钱没生效的唯一早期信号。`event_type` 只记我们处理的那几种，其余归 `other`，签名校验失败的记为 `unknown`（未验证的 payload 里的类型不可信）；`outcome ∈ {ok, error, bad_signature}`。
- `enx_sqlite_busy_total{op}` —— `SQLITE_BUSY` / `SQLITE_LOCKED` / `database is locked` 的出现次数（`op ∈ {read, write, raw}`，经 GORM 回调统计）。单写者在用户增长后最先出问题的地方。

**进程与主机**

- Go 运行时与进程指标：`client_golang` 默认 collector 自带（内存、GC、goroutine、fd）。
- 主机：EC2 上跑 node_exporter，重点看**磁盘剩余**（ECDICT ~850MB + SQLite + 日志）、内存、CPU。

**不在 v1**：客户端视角的端到端耗时（扩展里「点击 → 弹窗显示」，含 Cloudflare→东京的网络和渲染）。上线初期用 Cloudflare Analytics 的边缘指标近似；等有真实用户抱怨慢、而服务端数字好看时，再做客户端上报（另起 ADR，涉及隐私与上报通道）。

### 2. 埋点位置：计时只在一处，业务代码只打标签

- 一个 Gin 中间件负责**所有计时**，挂在 `middleware.RequestLog` 旁边：记录 HTTP 指标；若 handler 在 context 里设置了查词来源（`c.Set(metrics.LookupSourceKey, "local"|"ecdict"|"miss")`），同时记一条 `enx_dictionary_lookup_duration_seconds`。`translate.Handler` 只需在拿到 `Resolve` 的结果后加一行 `c.Set(metrics.LookupSourceKey, …)`，不用自己掐表。
- AI 用**装饰器**：在 `main` 组装处给 `Translator` 和 `Rephraser` 各包一层，对每个接口方法计时、记 token、归类 outcome（`context.DeadlineExceeded` → `timeout`）。provider 实现零改动，新 provider 自动覆盖。
- 新包 `enx-api/metrics` 持有指标定义与注册（用自有 `prometheus.Registry`，不用全局默认，便于测试隔离），以 `*metrics.Metrics` 的形式经构造函数注入到需要的地方（`.ai/instructions.md` 的 DDD 约定）。

### 3. 标签基数红线

**标签里永远不出现**：用户 id、单词、句子、原始 URL 路径、错误消息原文、Clerk session id。这些进日志（Decision 4）。每个新标签都必须是能枚举的小集合；code review 按这条卡。

依据：v1 全部指标估算 < 1,000 条活跃时间序列，远低于 Grafana Cloud 免费版的 1 万条限制。

### 4. 日志作补充：请求日志加耗时

`middleware.RequestLog`（#72）已为每个请求写一条结构化行：`method`、`route`、`status`、`duration_ms`、`user_id`。本 ADR 再加 `lookup_source`（查词请求才有）。用途是**指标报警后按时间窗口追到具体请求**，不用于画趋势图。Loki 收集沿用 Decision 5 的同一个 Alloy。

### 5. 指标送到哪：生产推 Grafana Cloud 免费版，不回 homelab

`/metrics` 挂在**独立端口 `:9091`**，不和业务端口 8091 共用，不经 nginx、不上公网。监听地址由 `METRICS_ADDR` 配置，默认 `127.0.0.1:9091`：

- 生产（EC2）用默认值，只有本机的 Alloy 能访问；容器端口映射同样只绑 `127.0.0.1:9091`。
- homelab（k8s）设为 `0.0.0.0:9091`，否则集群内的 Prometheus 从 Pod 外抓不到；再在 `enx-api` Service 上加一个 `metrics` 端口。集群内不经 Ingress，外部仍访问不到。

- **homelab（staging）**：在 `w10n-config` 的 `infra/homelab/k8s/enx/` 加一个 `ServiceMonitor`，选中 `enx-api` Service 的 `metrics` 端口，带 `release: kube-prometheus-stack` 标签（kube-prometheus-stack 默认只认这个标签）；在 homelab 自建的 Grafana 里看。**homelab 不接 Grafana Cloud。** 配置走 ArgoCD。
- **生产（EC2）**：EC2 上装 Grafana Alloy，抓本机 enx-api `:9091` 和 node_exporter，**remote_write 到 Grafana Cloud 免费版**（5a）。生产监控链路不经过 homelab、不依赖作者家的网络。

**两个环境的采集方式不同，但 enx-api 只有一套代码。** 采用的是 Prometheus 的拉模式：enx-api 只负责在 `/metrics` 上按标准格式暴露数字，不知道谁来读、数据送到哪。「谁来读」是部署配置，放在 `w10n-config`，不在 enx 仓库：

| 层 | homelab | 生产 | 份数 |
| --- | --- | --- | --- |
| enx-api 代码与镜像 | 暴露 `/metrics` | 暴露 `/metrics` | 一套（ADR-031 已让两边镜像通用） |
| 采集 | Prometheus，由 `ServiceMonitor` 配置 | Alloy，remote_write | 两份小配置，写好后基本不动 |
| 存储与看图 | homelab Prometheus + 自建 Grafana | Grafana Cloud | 各自独立 |
| Dashboard | 同一份 JSON | 同一份 JSON | 一套（见 Decision 7） |

homelab 用 `ServiceMonitor` 而不是 `additional-scrape-configs`：`ServiceMonitor` 是 Prometheus Operator 下**集群内服务**的标准做法，按标签发现 Service 背后的 Pod，Pod 重建、扩缩容自动跟随，且和 enx 的 Deployment 放在同一目录。`additional-scrape-configs` 适合**集群外的静态目标**——homelab 现在那份里全是工作站、路由器、VPS 上的 node_exporter，正是这个用途；仓库里之前没有 `ServiceMonitor`，只是因为还没有集群内的自研服务暴露指标。几种采集方式拿到的数据完全相同。

考虑过的两个去处：

| | 5a.（采用）Grafana Cloud 免费版 | 5b.（否决）经 Tailscale/WireGuard 推回 homelab Prometheus |
| --- | --- | --- |
| 可用性 | 与作者家无关；家里断网时生产监控照常 | 家里断网 = 生产监控断档，而且断的正是最需要它的时候 |
| 限制 | 1 万活跃序列、日志 50GB/月、保留 14 天 | 无额度限制；保留期由自己定 |
| 成本 | $0 | $0，但多维护一条 EC2↔家的隧道 |
| 告警 | 自带，可推邮件/Telegram | 用现有 Alertmanager |
| 与 ADR-031 的一致性 | 一致（生产不依赖作者家） | 违背「生产链路不依赖作者家」的精神 |

采用 5a，**不做 5b**：生产的观测不能在家里断网时断档。homelab staging 仍由集群内 kube-prometheus-stack 抓取，这是 homelab 自己的事，和生产链路无关。生产数据在 Grafana Cloud 自带的 Grafana 里看。14 天保留足够看「上线后性能」；需要更长的趋势时，再评估 recording rule 降采样或升级付费档。

### 6. 告警：v1 不做

先只采集和看图，不配任何告警规则。维护者测试一段时间、看过真实的耗时分布之后，再定告警项和阈值（另行修订本 ADR 或开 issue）。原因：没有基线数据时拍的阈值要么天天误报，要么永远不响。

之后要加告警时，Grafana Cloud 自带告警，不需要额外组件。候选项（仅记录，不实施）：查词 p95、AI 失败率、5xx 占比、Clerk 验证失败率、磁盘使用、enx-api 失联。

### 7. Dashboard 进仓库

Grafana dashboard 的 JSON 放进 `w10n-config` 的 `infra/homelab/k8s/observability/grafana/dashboards/`（homelab 看板的现有位置），用 `task grafana:push` 推到 homelab Grafana，登记进同目录的 `DASHBOARDS.md`；面板文字一律英文（homelab 看板约定）。不在 UI 里手改后遗忘。第一版一张图四行：查词（按 source 的 p50/p95 + 命中率）、AI（按 provider/operation 的 p95 + 错误率 + token 量）、HTTP RED、主机与依赖。

**同一份 JSON 导入 homelab Grafana 和 Grafana Cloud 两处。** 为此查询必须与采集器无关：

- 只用 `enx_*` 指标自己的标签（`source`、`route`、`provider` 等）过滤和分组。`job`、`instance` 这类标签由采集器决定，两边取值不同，查询里不出现。
- 数据源用 Grafana 的数据源变量（`${datasource}`），不写死数据源 UID。这一点**有意偏离** homelab 看板「数据源 UID 写死」的约定：写死的 UID 只在 homelab 的 Grafana 里存在，导入 Grafana Cloud 就失效。Grafana Cloud 那边用 UI 或 API 导入同一份 JSON，选中它的 Prometheus 数据源即可。
- 主机指标（node_exporter）同理：homelab 的节点指标来自 kube-prometheus-stack 自带的 node_exporter，生产来自 EC2 上的 node_exporter，指标名相同；「主机」一行按 `instance` 变量选择，不写死。

## Consequences

- enx-api 新增 `client_golang` 依赖和一个 `metrics` 包；查词 handler 多一行打标签；`aitranslate/factory.go` 多一层包装。业务逻辑不变。
- 新增运维面：EC2 上 Alloy + node_exporter 两个 systemd unit（ansible 管），homelab 的 `enx-api` Deployment/Service 加 metrics 端口和 `METRICS_ADDR`、加一个 `ServiceMonitor`。
- ADR-030 的 miss 率有了长期数据源，`dictsample` 可以按原计划删除（单独 PR）。
- 引入 Grafana Cloud 账号这一外部依赖（需要一个只写的 remote_write token，存在 EC2 上，由 ansible 下发）；它挂掉只影响观测，不影响服务。
- 在补告警之前，出问题只能靠人去看图发现。
- 标签基数红线需要在 code review 里持续执行，否则迟早撞额度。
- 服务端耗时不等于用户体验：网络和渲染时间仍是盲区，直到客户端上报（不在本 ADR）。

## 验证

1. 单测：用自有 Registry 驱动中间件，分别走 local / ecdict / miss / 429 四条路径，断言直方图的 `source` 标签与计数；AI 装饰器对 ok / error / 超时各断言 `outcome` 与 token 计数器。
2. homelab：部署后在 Grafana Explore 里能查到 `enx_dictionary_lookup_duration_seconds_bucket`，手动在扩展里查一个已知词与一个新词，两种 `source` 各 +1。
3. 生产：`curl 127.0.0.1:9091/metrics` 在 EC2 上有输出；从公网访问 `:9091` 失败；Grafana Cloud 里能查到 enx-api 与 node_exporter 的数据，dashboard 四行都有图。

## 修订记录

| 日期 | 修改 | 原因 |
| --- | --- | --- |
| 2026-09-29 | homelab 采集由 `additional-scrape-configs` 改为 `ServiceMonitor` | 前者适合集群外静态目标，集群内服务的标准做法是后者；维护者确认 |
| 2026-09-29 | 查词入口、路由、请求日志、AI 装饰位置按已合并代码更新 | #64/#69/#70/#72 在本 ADR 起草后合并 |
| 2026-09-29 | 去掉 `enx_clerk_jwks_fetch_total`，Clerk 只保留校验耗时直方图并列出 outcome；写明 Stripe、SQLite 指标的标签取值 | `keyfunc` 不暴露 JWKS 拉取回调；实现时确定了具体取值 |
