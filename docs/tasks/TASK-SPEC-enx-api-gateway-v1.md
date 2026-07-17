# TASK-SPEC: ENX API 网关分层与 `/api/v1` 公开契约

| 字段 | 值 |
| --- | --- |
| **状态** | Draft — 2026-06-21 |
| **类型** | SDD Task Spec（未来架构；**不在** `TASK-SPEC-enx-api-java.md` 范围内） |
| **前置** | 建议先完成 [TASK-SPEC-enx-api-java.md](./TASK-SPEC-enx-api-java.md)（Java 双栈落地）；本 Spec 是对 **全站 URL 与网关** 的重构 |
| **目标** | 建立 **OpenAPI 驱动的公开契约** `/api/v1/...`；**Kong** 负责对外路径、版本入口、重写与多后端聚合；**Go/Java 后端** 只注册 **域内资源路径**（无 `/api`、无 `v1`）；内外路径差异在 OpenAPI 与 Ingress 中显式文档化 |
| **非目标** | 不在本 Spec 内重写全部业务逻辑；不强制一次性改完所有端点命名（允许分阶段 alias）；不替换 Cognito；不讨论 enx-sync |
| **触发原因** | 多后端（Go + Java）长期共存；希望公开 API 可版本化、可演进，后端与网关职责清晰 |

---

## 1. 设计原则

### 1.1 三层路径模型

```text
┌─────────────────────────────────────────────────────────────────┐
│  Layer 1 — 公开契约（OpenAPI / 客户端 / 文档）                      │
│  https://enx-lab.wiloon.com/api/v1/users/me                     │
│  https://enx-lab.wiloon.com/api/v1/logs                         │
└───────────────────────────────┬─────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────┐
│  Layer 2 — Kong Ingress（对外「长什么样」）                         │
│  • 路由：path + method → Service（enx-api / enx-api-java）       │
│  • 重写：strip /api/v1，必要时 path 映射                          │
│  • 版本入口：/api/v1 → 当前生产；/api/v2 → 未来新版本               │
│  • 聚合：同一 host 下多 Service                                   │
└───────────────────────────────┬─────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────┐
│  Layer 3 — 后端（Go / Java，「资源是什么」）                        │
│  GET  /users/me          POST /logs          GET /words/{word}   │
│  无 /api 前缀；无 v1（版本由网关持有）                              │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 职责划分

| 层级 | 负责 | 不负责 |
| --- | --- | --- |
| **OpenAPI** | 公开 URL、请求/响应 schema、认证方式、错误模型、deprecation | 业务实现细节 |
| **Kong** | TLS、路径路由、strip/rewrite、按 Service 分流、（可选）限流 | 业务规则、数据库 |
| **Go / Java** | 资源 handler、领域逻辑、数据访问 | 公开 URL 前缀、API 版本号 |

### 1.3 REST 命名约定（后端域内路径）

| 约定 | 说明 | 示例 |
| --- | --- | --- |
| 资源用 **复数名词** | 集合用复数 | `POST /logs`，`GET /words/{word}` |
| 当前用户 | 常见子资源 | `GET /users/me`（优于裸 `/me`） |
| 动作型 legacy 端点 | 迁移期可保留，Spec 标 `deprecated` | `/paragraph-init` → 最终 `GET /paragraphs/...` |
| 运维端点 | **不进** OpenAPI 业务面，或单独 tag | K8s 探针：`/health`（Go）、`/actuator/health`（Java） |

### 1.4 与当前 ENX 的差异

| 项 | 当前（2026-06） | 本 Spec 目标 |
| --- | --- | --- |
| 客户端路径 | `/api/me`、`/api/translate`… | `/api/v1/users/me`、`/api/v1/...` |
| Kong | `path: /` 原样转发，**不** strip | `path: /api/v1` + **strip-path** + 按资源分流 |
| Go 路由 | 双份：`/foo` + `/api/foo` | 仅域内路径一份 |
| 版本 | 无 URL 版本 | 公开 `/api/v1`；未来 `/api/v2` 由 Kong 切换 |
| 契约文档 | 散落 README / 代码 | **`openapi/enx-api-v1.yaml`** 为单一真相源 |

---

## 2. 公开契约（OpenAPI）

### 2.1 文件位置

```text
enx/
└── openapi/
    ├── enx-api-v1.yaml      # 公开 /api/v1/* 契约（主文件）
    └── README.md            # 如何生成文档、如何与 Ingress 对照
```

- OpenAPI 中的 `servers.url`：`https://enx-lab.wiloon.com`（lab）；生产 `https://enx.wiloon.com` 另列 server entry。
- 每个 `paths` 键为 **公开路径**（含 `/api/v1` 前缀）。
- 使用 `x-internal-path` 扩展字段（或 description 表格）记录 Kong strip 后打到后端的 **内部路径** 与 **目标 Service**。

**示例片段**

```yaml
paths:
  /api/v1/logs:
    post:
      operationId: createFrontendLog
      summary: Submit frontend diagnostic log
      x-internal-path: POST /logs
      x-backend-service: enx-api-java
      # ... requestBody, responses, security ...
  /api/v1/users/me:
    get:
      operationId: getCurrentUser
      x-internal-path: GET /users/me
      x-backend-service: enx-api
```

### 2.2 认证（公开面）

与现网一致：`Authorization: Bearer <Cognito access_token>`；OpenAPI `securitySchemes` 使用 `oauth2` / `http bearer` 描述。

### 2.3 版本与兼容

| 规则 | 说明 |
| --- | --- |
| **v1 冻结策略** | 已发布 path 仅 additive 变更；breaking 变更走 v2 |
| **Deprecation** | OpenAPI `deprecated: true` + `Sunset` 响应头（可选）+ 客户端 release note |
| **Legacy `/api/*`（无 v1）** | 迁移期 Kong 保留 **临时** 路由：原路径 308/301 到 `/api/v1/...` 或 proxy alias； sunset 日期写在 OpenAPI |

---

## 3. Kong Ingress 设计

### 3.1 参考实现（homelab）

域名：`enx-lab.wiloon.com`（与现网一致）

**核心注解（业务 API Ingress）**

```yaml
metadata:
  annotations:
    konghq.com/strip-path: "true"   # strip 匹配前缀后再转发
    konghq.com/protocols: https
    konghq.com/https-redirect-status-code: "301"
```

**路径规则（示意）**

| Ingress path | strip 后到达后端的路径前缀 | Backend Service | 说明 |
| --- | --- | --- | --- |
| `/api/v1/logs` | `/logs` | `enx-api-java` | Java 独占 |
| `/api/v1/users` | `/users` | `enx-api` | Go：`/users/me` 等 |
| `/api/v1/words` | `/words` | `enx-api` | 翻译、mark、delete |
| `/api/v1/paragraphs` | `/paragraphs` | `enx-api` | 段落词频 |
| `/api/v1/version` | `/version` | `enx-api` | 公开版本信息 |
| `/api/v1`（兜底） | `/` | `enx-api` | 未细分子路径前的过渡 |

> **注意**：Kong strip 行为以 **Ingress 规则的 `path` 字段** 为 strip 前缀（与 [rssx ingress](https://github.com/wiloon/w10n-config/blob/main/infra/homelab/k8s/rssx/ingress.yaml) 相同模式）。若单条规则 `path: /api/v1/logs` 过细，需多条 Ingress path 或 KongPlugin `request-transformer` 做精确映射。

### 3.2 运维与健康检查（不经过公开 OpenAPI 或单独 tag）

| 用途 | 请求路径 | 是否 strip | Backend | 内部路径 |
| --- | --- | --- | --- | --- |
| Go 存活探针 | 集群内直连 Service | — | `enx-api:8091` | `GET /health` 或保留 `GET /ping`（仅集群内） |
| Java 存活探针 | 集群内直连 | — | `enx-api-java:8092` | `GET /actuator/health` |
| 可选公开 health | `GET /api/v1/health` | → `/health` | 聚合或 Go | 见实现阶段决策 |

**原则**：K8s `livenessProbe` **不依赖** Kong；避免网关配置错误导致 Pod 被误杀。

### 3.3 多后端聚合

```text
/api/v1/logs      ──► enx-api-java
/api/v1/users/me  ──► enx-api (Go)
/api/v1/words/... ──► enx-api (Go)
```

同一 host、同一 `/api/v1` 对外前缀下，**不同资源** 由 Kong 分到不同 Service；后端 **无需** 实现相同 API 全集。

### 3.4 Legacy 过渡路由（迁移期）

| Legacy 公开路径 | 过渡策略 |  sunset |
| --- | --- | --- |
| `GET/POST /api/*`（无 v1） | Kong 307 → `/api/v1/...` 或 parallel proxy | T+6 个月（示例，实现时定） |
| `POST /log`（无 /api） | 404 或 301 → `POST /api/v1/logs` | 立即废弃 |

---

## 4. 后端域内路径（Go / Java）

### 4.1 Go（`enx-api`）

- 删除 `router.Group("/api")` 与 legacy `authGroup` 重复路由；**只保留一份** 域内路由。
- 路由注册示例目标：

```text
GET    /health                    # 或保留 /ping，仅集群内文档说明
GET    /version                   # 内部简洁版本
GET    /users/me
GET    /words/{word}
DELETE /words/{word}
GET    /words                     # 原 translate?word=
POST   /words/mark                # 原 POST /api/mark（命名实现阶段可再议）
GET    /paragraphs/init           # 原 paragraph-init
...
```

- 具体资源名可在 **Phase 2** 微调，但须同步 OpenAPI + 客户端。

### 4.2 Java（`enx-api-java`）

- 域内路径示例：`POST /logs`（对应公开 `POST /api/v1/logs`）。
- 不使用 `@RequestMapping("/api")`；版本 **不** 出现在 Controller 路径中。

---

## 5. 路径对照表（当前 → 目标）

公开路径为客户端与 OpenAPI 真相；**内部路径** 为 Kong strip `/api/v1` 后的 URI（若 Ingress path 为 `/api/v1/logs`，strip 后为 `/logs`）。

| 当前公开路径（客户端） | 目标公开路径（OpenAPI） | 内部路径（后端） | 后端 | 备注 |
| --- | --- | --- | --- | --- |
| `GET /api/version` | `GET /api/v1/version` | `GET /version` | Go | E2E 探活改为 v1 URL |
| `GET /api/me` | `GET /api/v1/users/me` | `GET /users/me` | Go | |
| `GET /api/translate?word=` | `GET /api/v1/words?word=` 或 `GET /api/v1/words/{word}` | `GET /words/{word}` 或 query | Go | 实现阶段二选一，OpenAPI 定稿 |
| `GET /api/word/:word` | `GET /api/v1/words/{word}` | `GET /words/{word}` | Go | enx-ui 使用 |
| `DELETE /api/word/:word` | `DELETE /api/v1/words/{word}` | `DELETE /words/{word}` | Go | |
| `POST /api/mark` | `POST /api/v1/words/mark` 或 `PATCH /api/v1/words/{word}/acquaintance` | 对应内部路径 | Go | REST 语义优化可选 |
| `GET /api/paragraph-init` | `GET /api/v1/paragraphs/init` | `GET /paragraphs/init` | Go | 后续可再资源化 |
| `GET /api/load-count` | `GET /api/v1/words/load-count` | `GET /words/load-count` | Go | |
| `GET /api/do-search` | `GET /api/v1/search` | `GET /search` | Go | |
| `GET /api/third-party` | `GET /api/v1/search/third-party` | `GET /search/third-party` | Go | |
| `GET /api/wrap` | `GET /api/v1/text/wrap` | `GET /text/wrap` | Go | |
| `POST /api/log` | `POST /api/v1/logs` | `POST /logs` | Java | 复数资源名 |
| `POST /log` | —（废弃） | — | — | 不保留 |
| `GET /ping` | 不暴露或 `GET /api/v1/health` | `GET /health` | Go | 探针优先集群内 |

---

## 6. 客户端变更

### 6.1 受影响项目

| 项目 | 变更 |
| --- | --- |
| `enx-chrome` | `ApiService` / `background.ts` endpoint 改为 `/api/v1/...` |
| `enx-ui` | `services/api.ts` 同上 |
| E2E | `playwright.config.ts` 探活 URL → `/api/v1/version` 或 `/api/v1/health` |

### 6.2 配置建议

- `API_BASE_URL` 仍为 origin（`https://enx-lab.wiloon.com`）；endpoint 常量带 `/api/v1`。
- 或 `API_BASE_URL=https://enx-lab.wiloon.com/api/v1`，endpoint 用 `/users/me`（团队择一，**全 repo 统一**）。

---

## 7. 分阶段迁移计划

### Phase 0 — 文档与网关基线（无破坏性）

- [ ] 新增 `openapi/enx-api-v1.yaml`（可先覆盖已稳定端点：`/users/me`、`/logs`、`/version`）
- [ ] `w10n-config`：新增 Kong Ingress 规则 **并行** 暴露 `/api/v1/*`（strip-path），旧 `/api/*` **仍保留**
- [ ] 后端 **同时** 注册旧路径（临时）与新域内路径 — **或** Kong rewrite 旧 → 新（二选一，推荐后者减少 Go 双份路由）

### Phase 1 — 后端去 `/api` 前缀

- [ ] Go：移除 `apiGroup`；域内路径为 §4.1
- [ ] Java：`POST /logs`（内部）；Kong `/api/v1/logs` → java Service
- [ ] 集成测试打 **内部路径**（直连 Service port）；E2E 打 **公开** `/api/v1`

### Phase 2 — 客户端切换

- [ ] enx-chrome / enx-ui 切 `/api/v1`
- [ ] 监控旧路径访问量（Kong access log）

### Phase 3 — Legacy sunset

- [ ] 移除 Kong 上无 v1 的 `/api/*` 路由
- [ ] 移除 Go legacy `authGroup` 无前缀路由
- [ ] OpenAPI 标记 deprecated 端点删除

### Phase 4 — v2  rehearsal（可选）

- [ ] 复制 `enx-api-v2.yaml`；Kong `path: /api/v2` 指向新实现
- [ ] 后端仍 **不含** v2 字符串；v2 仅存在于网关与 OpenAPI

---

## 8. 本地开发

| 模式 | 说明 |
| --- | --- |
| **直连后端** | `localhost:8090/users/me` — 测域内路径，不经过 Kong |
| **模拟网关** | docker compose / `task dev:gateway`：nginx/Caddy strip `/api/v1` → 8090/8092 |
| **契约校验** | `openapi/enx-api-v1.yaml` + Prism / Schemathesis 对 mock 或 staging |

---

## 9. 验收标准

### 9.1 文档

- [ ] `openapi/enx-api-v1.yaml` 覆盖所有 **对外** 业务端点
- [ ] 每个 path 含 `x-internal-path` 与 `x-backend-service`
- [ ] `w10n-config/infra/homelab/k8s/enx/README.md` 有 **公开 path → Service → 内部 path** 对照表（与 OpenAPI 一致）

### 9.2 网关

- [ ] `GET https://enx-lab.wiloon.com/api/v1/users/me`（带 JWT）→ Go Pod 日志路径为 `/users/me`
- [ ] `POST https://enx-lab.wiloon.com/api/v1/logs` → Java Pod 日志路径为 `/logs`
- [ ] strip 后 **不会** 出现 `/api/v1/...` 打到后端的情况

### 9.3 客户端

- [ ] enx-chrome / enx-ui 仅使用 `/api/v1/...`
- [ ] E2E 全绿

### 9.4 清理

- [ ] Go 无 `router.Group("/api")` 双份路由
- [ ] 无公开 `POST /log`；文档无 legacy `/api/*`（无 v1）端点

---

## 10. 风险与决策记录

| 风险 | 缓解 |
| --- | --- |
| Kong strip 前缀与 Ingress path 不一致 | 每条规则在 README 写清 strip 结果；staging curl 验证 |
| 客户端与后端分批上线导致 404 | Phase 0 并行暴露旧 + 新路径 |
| 资源重命名（translate → words）工作量大 | OpenAPI 先定名；Phase 2 前允许 `/api/v1/translate` alias |
| OpenAPI 与实现漂移 | CI：`openapi-diff` + 契约测试（Schemathesis / Postman） |

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 版本号放哪 | **仅公开 URL + Kong** | 后端换 v2 无需改包名；符合「网关管版本入口」 |
| `/api` 谁处理 | **Kong strip，后端不感知** | 与 rssx 模式一致；Go/Java 路径统一 |
| 日志资源名 | **`POST /logs`（复数）** | REST 集合命名惯例 |
| 与 Java 首版 Spec 关系 | **Java 首版可仍用 `/api/log`** | 本 Spec 完成后统一改为内部 `/logs` + 公开 `/api/v1/logs` |

---

## 11. 相关文件

| 仓库 | 路径 |
| --- | --- |
| enx | [TASK-SPEC-enx-api-java.md](./TASK-SPEC-enx-api-java.md) — 当前 Java 引入（模式 A，未 strip） |
| enx | `enx-api/enx-api.go` — 待重构路由 |
| enx | `enx-chrome/src/services/api.ts`、`enx-ui/src/services/api.ts` |
| w10n-config | `infra/homelab/k8s/enx/ingress.yaml` |
| w10n-config | `infra/homelab/k8s/rssx/ingress.yaml` — strip-path 参考 |

---

## 12. SDD 工作方式

1. **OpenAPI 先行**：改公开路径先改 `enx-api-v1.yaml`，再改 Ingress，再改后端，最后改客户端。
2. **内外对照表不可省略**：任何 Ingress 变更必须更新 OpenAPI 的 `x-internal-path` 与 k8s README。
3. **与 Java 首版 Spec 解耦**：`TASK-SPEC-enx-api-java.md` 完成不等于本 Spec 完成；本 Spec 是后续独立里程碑。
