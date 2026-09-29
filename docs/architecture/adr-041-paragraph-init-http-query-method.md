# ADR-041：paragraph-init 改用 HTTP QUERY 方法、请求体传段落——网络不支持时回退 POST，GET 保留但弃用

| 字段 | 值 |
| --- | --- |
| **状态** | Accepted — 2026-09-29（维护者拍板：默认 QUERY，网络不通时回退 POST，GET 加弃用注释暂留、以后删除） |
| **日期** | 2026-09-29 |
| **关联** | [`adr-031-production-deployment-topology.md`](adr-031-production-deployment-topology.md)（生产链路：Cloudflare → nginx → enx-api）、PR #74（paragraph-init 批量查询）、RFC 10008 *The HTTP QUERY Method* |

---

## Context

enx-chrome 每打开一个页面，就把页面上的不重复单词按每批 200 个调用一次 `GET /api/paragraph-init?paragraph=<200 个词>`，拿回每个词的 id 和当前用户的复习状态，用来画下划线。

问题都出在「段落放在 URL 里」：

1. **页面文字进日志。** URL 会被 Cloudflare 日志、nginx 访问日志、错误监控（`enx-ui/src/lib/legal.ts` 已记录 `/api/word/<词>` 会进 Sentry）一路记下。200 个词基本能还原用户在读什么。请求体默认不被这些环节记录。
2. **URL 长度上限。** Cloudflare 约 16 KB，nginx 默认请求头缓冲 8 KB。今天 200 个词编码后约 1.5–2 KB，有余量，但调大批量或遇到长词多的页面会逼近。
3. **GET 的好处在这里用不上。** GET 最大的价值是可被 HTTP 缓存；这个接口带 `Authorization`、结果按用户不同，本来就不会被缓存。

查询方法的现状（2026-09）：HTTP QUERY 已于 2026-06 发布为 **RFC 10008**（标准轨道）：安全、幂等、带请求体、必须带 `Content-Type`，响应可缓存且缓存键包含请求体，服务端可用 `Accept-Query` 声明支持。它正是「只读查询 + 请求体」的准确语义。

### 实测（2026-09-29）

| 环节 | 结果 |
| --- | --- |
| Chrome 153 `fetch({method: 'QUERY'})` | 同源、跨域都成功；跨域先发 `OPTIONS` 预检（204）再发 `QUERY`（200），请求体完整 |
| gin（`router.Handle("QUERY", …)`） | 正常路由，方法、`Content-Type`、请求体都收到 |
| 生产：Cloudflare → nginx → enx-api（`api.catglish.com`） | `QUERY /ping` 拿到 gin 自己的 `404 page not found`：两跳都转发了 QUERY |
| homelab：Kong 3.9.3 → enx-api（`enx-api.wiloon.lab`） | 同上，Kong 头显示已到上游 |

上面两条链路的测试只证明**方法**被转发；**请求体**是否原样到达，要等真实的 QUERY 路由上线后验证（见「验证」）。

## Options Considered

### A. 保持 GET

| Pros | Cons |
| --- | --- |
| 不用改；语义正确（安全、幂等） | 页面文字进 URL 和各层访问日志；受 URL 长度上限约束；缓存优势用不上 |

### B. POST + 请求体

| Pros | Cons |
| --- | --- |
| 任何网络、代理都支持；请求体不进日志 | 语义不准确（POST 不承诺安全、幂等），需要注释解释「这是只读查询」，否则会被当成写接口或被「纠正」回 GET |

### C.（采用）QUERY 为默认，POST 为回退，GET 暂留

| Pros | Cons |
| --- | --- |
| 语义完全准确；页面文字只在请求体；实测整条链路放行 | 用户所在网络若有解密 HTTPS 并拦截未知方法的代理，QUERY 会失败——用 POST 回退兜住；服务端要同时维护三个入口直到旧扩展消失 |

### D. GET 带请求体

规范没有定义 GET 请求体的语义，很多代理会丢弃它。不可靠，排除。

## Decision

### 1. 服务端（enx-api）

- `QUERY /api/paragraph-init` 和 `POST /api/paragraph-init` 走同一个处理函数 `paragraph.Handler.ParagraphInitBody`，请求体 `{"paragraph": "…"}`。
- 按 RFC 10008，`Content-Type` 缺失或不是 `application/json` 返回 **415**；JSON 解析失败返回 400。
- 成功响应带 `Accept-Query: application/json`。
- CORS 的 `Access-Control-Allow-Methods` 加上 `QUERY`（跨域 QUERY 必然触发预检）。
- `GET /api/paragraph-init?paragraph=` **保留但弃用**：处理函数加 `Deprecated:` 注释，只为尚未升级的扩展服务。

### 2. 客户端（enx-chrome）

- 默认用 QUERY，段落放在 JSON 请求体里。
- **回退条件**：请求失败、不是会话过期，且（没有 HTTP 状态——网络层失败，或状态是 **405 / 501**——代理不认识这个方法）。满足时立即用 POST 重发同一请求。
- POST 重发**成功**后，本次 service worker 生命周期内改用 POST；POST 也失败（例如 API 宕机）则不切换，下次仍先试 QUERY。
- 会话过期（401）和真实的 API 应答（402、429、500 等）不回退：POST 会得到同样的答案。

### 3. 上线顺序

旧版 enx-api 没有 QUERY 路由，会答 404，而 404 不在回退条件里。所以必须**先部署 enx-api，后发布扩展**：

1. enx-api 上 homelab，确认 QUERY 请求体完整到达（见「验证」）；
2. enx-api 上生产，同样验证；
3. 发布扩展。

### 4. 以后删除 GET

当所有在用的扩展版本都已包含本改动（Chrome Web Store 的版本分布可查），删除 GET 路由和 `ParagraphInit`。删除前在 enx-api 请求日志里确认 `GET /api/paragraph-init` 已无流量（ADR-040 的 `route` 字段可直接筛）。

### 5. 约定

**内容来自用户页面或用户输入的查询，不放进 URL。** 优先用 QUERY、POST 回退。`GET /api/word/:word`（单个词）同样适用，但每次只暴露一个词、影响小，另行处理。

## Consequences

- 页面文字不再出现在 Cloudflare、nginx 访问日志的 URL 里，也不再受 URL 长度限制。
- enx-api 在过渡期同时维护 QUERY、POST、GET 三个入口，共用同一个查询实现；GET 删除后剩两个。
- ADR-040 的指标按 `method` 和 `route` 可以看到 QUERY 与 POST 的比例，也就是回退发生得有多频繁；若 POST 占比明显，说明有相当多用户的网络不放行 QUERY。
- 若将来需要缓存，QUERY 响应按规范可缓存（缓存键含请求体）；目前带 `Authorization`，不缓存。

## 验证

1. 单元测试：`paragraph` 包——QUERY 与 POST 均返回 200 并读到请求体、`Accept-Query` 头、缺失或错误 `Content-Type` 返回 415、坏 JSON 返回 400、弃用的 GET 仍可用；路由测试——三个入口都已注册、CORS 预检允许 QUERY；e2e——真实 QUERY 与 POST 请求穿过完整路由（CORS、Clerk 鉴权、日志）拿到正确结果。
2. 扩展单测：默认发 QUERY 且段落在请求体；网络层失败、405、501 时回退 POST 并保持；POST 也失败时不切换；500、429 不回退。
3. 部署后（homelab 与生产各一次）：用带有效 token 的 `curl -X QUERY -H 'Content-Type: application/json' --data '{"paragraph":"good morning"}' https://<host>/api/paragraph-init`，确认返回 200 且 `data` 里有 `good`、`morning` 两个 key——证明请求体穿过 Kong、Cloudflare、nginx 后完整到达。
