# TASK-SPEC: ENX Java REST API 后端（与 Go 双栈并行）

| 字段 | 值 |
| --- | --- |
| **状态** | Draft — 2026-06-21 |
| **类型** | SDD Task Spec（Spec 驱动实现；实现前以本文为准，实现后同步更新状态与验收清单） |
| **目标** | 在 `enx` monorepo 新增 **Java + Spring Boot** REST API 子项目，与现有 **Go (`enx-api`)** 同时在 K8s 中运行（不同 Pod）；通过 **Kong Ingress** 按 URL 分流；首阶段完成 **1 个 API 从 Go 迁移至 Java**（`POST /api/log`） |
| **非目标** | 不重写全部 Go API；首阶段 **不**在 Java 实现 `/api/version`、`/ping`；不引入新数据库（Java 不访问 SQLite）；不修改 enx-chrome / enx-ui 的业务逻辑；不做 enx-sync 改造 |
| **触发原因** | 学习 Java / Spring Boot；验证 ENX 后端可渐进式多语言拆分 |

---

## 1. 背景与动机

ENX 当前后端为 Go（Gin + SQLite），部署在 homelab K8s `enx` namespace，Ingress 域名 `enx-lab.wiloon.com`，所有路径 `/` 指向单一 Service `enx-api:8091`。

本 Spec 定义 **最小可行双栈架构**：Go 继续承载核心业务 API 及健康/版本端点；Java 作为独立 Pod 接入同一 Ingress 域名，首阶段仅接管 **`POST /api/log`**。选 **无 SQLite 依赖** 的端点，降低数据层耦合风险。

---

## 2. 现状

### 2.1 Go 后端（`enx-api/`）

| 项 | 现状 |
| --- | --- |
| 框架 | Gin |
| 存储 | SQLite（PVC `/var/lib/enx-api/enx.db`） |
| 认证 | AWS Cognito JWT（`middleware/cognito_auth.go`），支持 ui + chrome 双 Client ID |
| 端口 | 8091（K8s）/ 8090（本地 dev） |
| 健康检查 | `GET /ping` |
| 版本 | `GET /version`（详细）、`GET /api/version`（简洁，enx-chrome E2E 依赖） |

路由注册见 `enx-api/enx-api.go`（节选）：

| 方法 | 路径 | 认证 | 依赖 SQLite | 说明 |
| --- | --- | --- | --- | --- |
| GET | `/ping` | 否 | 否 | 健康检查 |
| GET | `/version` | 否 | 否 | 详细版本信息 |
| GET | `/api/version` | 否 | 否 | 简洁版本（E2E 探活） |
| POST | `/api/log` | Cognito JWT | 否 | 前端事件日志 ← **首阶段迁移至 Java** |
| GET | `/api/me` | Cognito JWT | 是 | 当前用户 |
| GET | `/api/translate` 等 | Cognito JWT | 是 | 核心业务 |

### 2.2 K8s / Ingress（`w10n-config/infra/homelab/k8s/enx/`）

| 资源 | 现状 |
| --- | --- |
| Deployment | `enx-api` × 1，镜像 `docker-hosted.wiloon.com/enx-api:<commit>` |
| Service | `enx-api` ClusterIP :8091 |
| Ingress | `enx-lab.wiloon.com`，`path: /` → `enx-api`（单后端） |
| 构建 | Tekton `pipeline-build-enx-api.yaml` → Kaniko + Containerfile → 更新 `deployment.yaml` → ArgoCD sync |
| Secret | `enx-cognito`（Cognito 配置）、`enx-api-secret`（有道 API） |

### 2.3 客户端

| 客户端 | API Base URL | 相关调用 |
| --- | --- | --- |
| enx-chrome | 可配置（默认 `https://enx-lab.wiloon.com`） | `/api/me`；E2E 探活 `/api/version` |
| enx-ui | 同上 | `/api/me` |

首阶段 **不修改客户端 URL**；分流完全在 Kong Ingress 完成。`/api/version` 与 `/ping` **继续由 Go 处理**。

---

## 3. 目标架构

```text
                    enx-lab.wiloon.com (Kong Ingress)
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
            POST /api/log                    其余全部路径
            /log (legacy)              /ping, /api/version, /api/me, …
                    │                               │
                    ▼                               ▼
           Service: enx-api-java              Service: enx-api
           Pod: enx-api-java                  Pod: enx-api (Go)
           JDK 26 + Spring Boot               Gin + SQLite
```

**并行运行原则**

1. Go 与 Java 是 **两个 Deployment、两个 Service、两个镜像**。
2. 同一域名下，Kong 按 **路径最长匹配** 分流（更具体的路径规则写在前面）。
3. 「迁移 API」= Java 实现后，Kong **仅** 路由到 Java；Go **删除** 对应 handler 与路由。
4. 首阶段 **不在 Java 暴露** `/api/version`、`/ping`；版本与对外健康检查仍走 Go。

---

## 4. 技术选型与版本

> **版本基准日**：2026-06-21。Starter 与传递依赖版本由 **Spring Boot 4.1.0 BOM** 统一管理；`build.gradle.kts` 中 **仅** 对 Gradle 插件、Wrapper、Java Toolchain 显式写版本，业务依赖不写版本号（继承 BOM）。
>
> 权威来源：[Spring Boot 4.1.0 Managed Dependency Coordinates](https://docs.spring.io/spring-boot/4.1/appendix/dependency-versions/coordinates.html)

### 4.1 平台与构建工具链

| 组件 | 版本 | 说明 |
| --- | --- | --- |
| **JDK（编译 / 本地运行）** | **26** | `java.toolchain.languageVersion = JavaLanguageVersion.of(26)`；与 workstation `install-jdk.yml` 一致（Arch `jdk-openjdk` / macOS Homebrew `openjdk`） |
| **JDK（容器运行时）** | **26** | Paketo `BP_JVM_VERSION=26`；具体 Zulu/Corretto 小版本由 buildpack 发布决定 |
| **Spring Boot** | **4.1.0** | 应用框架 + BOM |
| **Gradle** | **9.6.0** | Wrapper 固定；`gradle wrapper --gradle-version=9.6.0` |
| **Gradle Plugin: `org.springframework.boot`** | **4.1.0** | 与 Spring Boot 同版本 |
| **Gradle Plugin: `io.spring.dependency-management`** | **1.1.7** | 导入 Spring Boot BOM（Initializr 默认） |
| **子项目路径** | **`enx-api-java/`** | monorepo 新目录 |

### 4.2 Spring 平台（BOM 传递，实现时仅作对照）

| 组件 | BOM 版本 | 说明 |
| --- | --- | --- |
| Spring Framework | **7.0.8** | `spring-core`、`spring-web`、`spring-webmvc` 等 |
| Spring Security | **7.1.0** | 含 OAuth2 Resource Server、JOSE |
| 内嵌 Servlet 容器 | **Tomcat 11.0.22** | `tomcat-embed-core`（`spring-boot-starter-web` 带入） |
| Jakarta Servlet API | **6.1.0** | Servlet 6.1 规范 |
| Jackson（JSON） | **2.21.4** | `jackson-databind`（`@RestController` 默认序列化） |
| Logback | **1.5.34** | `logback-classic`（默认日志实现） |
| Micrometer | **1.17.0** | `micrometer-core`（Actuator 指标） |

### 4.3 直接依赖（`build.gradle.kts` 显式声明）

首阶段 **仅** 下列 starter；**不** 引入 JPA、SQLite、Redis、WebFlux。

| Gradle 依赖（`implementation` / `testImplementation`） | Starter 版本 | 用途 |
| --- | --- | --- |
| `org.springframework.boot:spring-boot-starter-web` | **4.1.0** | REST API（内嵌 Tomcat + Spring MVC + Jackson） |
| `org.springframework.boot:spring-boot-starter-security` | **4.1.0** | 安全过滤器链、CORS 集成点 |
| `org.springframework.boot:spring-boot-starter-security-oauth2-resource-server` | **4.1.0** | Cognito JWT 校验（JWKS、`iss`、`aud`） |
| `org.springframework.boot:spring-boot-starter-actuator` | **4.1.0** | `/actuator/health` 供 K8s 探针 |
| `org.springframework.boot:spring-boot-starter-validation` | **4.1.0** | `POST /api/log` 请求体校验（`@Valid` / Bean Validation） |
| `org.springframework.boot:spring-boot-starter-test` | **4.1.0** | 单元 / 集成测试（test） |
| `org.springframework.security:spring-security-test` | **7.1.0** | MockMvc + Security 测试（test，可由 starter-test 传递，显式声明亦可） |

**首阶段明确不引入**

| 依赖 | 原因 |
| --- | --- |
| `spring-boot-starter-data-jpa` | 不访问 SQLite |
| `spring-boot-starter-webflux` | 首阶段用同步 MVC 即可 |
| `spring-boot-starter-oauth2-client` | 认证在 Cognito Hosted UI，后端只做 Resource Server |
| Lombok / MapStruct | 保持样板代码可见，利于学习 |

### 4.4 测试依赖（BOM 管理，对照用）

| 组件 | BOM 版本 | 用途 |
| --- | --- | --- |
| JUnit Jupiter | **6.0.3** | `@Test` |
| Mockito | **5.23.0** | `mockito-core`、`mockito-junit-jupiter` |
| AssertJ | **3.27.7** | 流式断言 |
| Spring Boot Test | **4.1.0** | `@SpringBootTest`、`MockMvc` |

### 4.5 容器镜像

| 组件 | 选型 | 说明 |
| --- | --- | --- |
| **CI（Tekton，当前）** | Kaniko + `enx-api-java/Containerfile` | 与 Go `enx-api` 一致；无 Docker daemon；见 §4.9 |
| **CI（Tekton，备选）** | `buildpacks-phases` + Paketo | 无 daemon、无 Containerfile；与本地 `bootBuildImage` 同源；**未落地**，见 §4.11 |
| **本地** | `./gradlew bootBuildImage`（Paketo） | 需本机 Docker；`BP_JVM_VERSION=26` |
| CI 基础镜像 | `eclipse-temurin:26-jdk-jammy` → `26-jre-jammy` | Containerfile 多阶段：Gradle `bootJar` + JRE 运行（仅当前 Kaniko 路径） |
| 镜像仓库 | `docker-hosted.wiloon.com/enx-api-java:<commit>` | 与 Go 镜像命名一致 |

**禁止（首阶段）**

- 不在 Java 中实现 `GET /api/version`、`GET /ping`
- 不在 Java 中引入 SQLite / JPA 访问 `enx.db`
- 不复制 Go 的 legacy 无前缀路由（`/translate` 等）

### 4.6 `build.gradle.kts` 插件与 Toolchain 示例

```kotlin
plugins {
    java
    id("org.springframework.boot") version "4.1.0"
    id("io.spring.dependency-management") version "1.1.7"
}

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(26)
    }
}

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-security")
    implementation("org.springframework.boot:spring-boot-starter-security-oauth2-resource-server")
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    implementation("org.springframework.boot:spring-boot-starter-validation")
    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("org.springframework.security:spring-security-test")
}

tasks.named<org.springframework.boot.gradle.tasks.bundling.BootBuildImage>("bootBuildImage") {
    imageName.set("docker-hosted.wiloon.com/enx-api-java:local")
    environment.put("BP_JVM_VERSION", "26")
}
```

### 4.7 Spring Web 与 Spring Boot 的关系

**不冲突。** `spring-boot-starter-webmvc` 在 Boot 启动时自动启用 **Spring Web MVC**（`@RestController`、JSON 序列化、内嵌 Tomcat）。首阶段用同步 MVC；以后若要响应式再考虑 `spring-boot-starter-webflux`。

### 4.8 架构：DDD 分层（与 Go `enx-api` 对齐）

与 [.ai/instructions.md](../../.ai/instructions.md) 中 Go 后端 DDD 约定一致，Java 侧按 **四层** 组织包结构：

| 层 | Java 包 | 职责 | Go 对应 |
| --- | --- | --- | --- |
| **API（接口）** | `api/` | HTTP Controller、请求/响应 DTO、全局异常处理 | `handlers/` |
| **Application（应用）** | `application/` | 用例编排，不含 HTTP 与基础设施细节 | `enx/` 中 service 编排 |
| **Domain（领域）** | `domain/` | 实体/值对象、领域服务、**端口接口** | `enx/` 实体 + repository 接口 |
| **Infrastructure（基础设施）** | `infrastructure/` | Security、CORS、日志/持久化实现 | `middleware/`、`repo/` |

**依赖方向（向内）**：`api` → `application` → `domain` ← `infrastructure`

**规则**

- Controller **只**处理 HTTP：解析请求、调用 Application Service、返回响应
- **禁止**在 Controller 中写业务逻辑或直接打日志
- Domain 层 **不依赖** Spring、Servlet、JWT 等框架类型
- 外部能力在 `domain/` 定义端口（如 `FrontendLogWriter`），在 `infrastructure/` 实现
- 引入 JPA/SQLite 时：`domain/` 放 repository 接口，`infrastructure/persistence/` 放实现

**`POST /api/log` 调用链**

```text
LogController (api/log)
    → FrontendLogService (application/log)
        → FrontendLog (domain/log)
        → FrontendLogWriter (domain/log 端口)
            → Slf4jFrontendLogWriter (infrastructure/logging)
```

### 4.9 容器构建操作

Go 侧 `enx-api` 与 Java 侧 **CI** 均使用 Kaniko + `Containerfile`；Java **本地**仍可用 Paketo。

**本地构建（Paketo）**

```bash
cd enx-api-java
./gradlew bootBuildImage --imageName=docker-hosted.wiloon.com/enx-api-java:local
```

**备选：pack CLI**

```bash
pack build docker-hosted.wiloon.com/enx-api-java:local \
  --path enx-api-java \
  --builder paketobuildpacks/builder-jammy-base \
  --env BP_JVM_VERSION=26
```

**Tekton CI（`w10n-config`）**

- Pipeline：`pipeline-build-enx-api-java.yaml` → `git-clone-ssh` → `kaniko-build` → `update-gitops`
- Containerfile：`enx-api-java/Containerfile`（Kaniko 在 build stage 内执行 `./gradlew bootJar`）
- 触发：`task java:deploy`（enx）或 `task tekton-build-enx-api-java`（`w10n-config/infra/homelab`）
- 首构建慢属预期（见 §4.10）；后续可通过 Nexus Maven 代理与构建拆分加速

**备选 CI（未落地）**：Tekton + `buildpacks-phases` + Paketo，见 §4.11。当前实现**暂不改动**。

**Gradle Wrapper 初始化**

```bash
gradle wrapper --gradle-version=9.6.0
```

### 4.10 Nexus Maven 依赖缓存与 CI 加速

homelab K8s 已部署 **Nexus Repository Manager**（`nexus` namespace，`https://nexus.wiloon.com`）。当前 Nexus 除 Docker 镜像代理（`docker-registry.wiloon.com` 等）外，**默认已含 Maven 仓库**（经 REST API 可列出）：

| 仓库名 | 类型 | 用途 |
| --- | --- | --- |
| `maven-central` | proxy | 代理 Maven Central（`https://repo1.maven.org/maven2/`） |
| `maven-public` | group | 聚合 releases / snapshots / central，**Gradle 推荐指向此 group** |
| `maven-releases` | hosted | 内部 release 构件（首阶段可不使用） |
| `maven-snapshots` | hosted | 内部 snapshot 构件（首阶段可不使用） |

**Gradle 依赖 URL（集群内 / CI）**

```text
https://nexus.wiloon.com/repository/maven-public/
```

**与 Docker 代理的关系**

| 缓存层 | 代理对象 | 当前状态 |
| --- | --- | --- |
| Nexus Docker proxy | 容器镜像（Temurin、Kaniko 等） | ✅ 已用（Kaniko `--registry-mirror=docker-registry.wiloon.com`） |
| Nexus Maven proxy | jar/aar（Spring Boot、JUnit 等） | ⚠️ 仓库已存在，**Gradle 尚未配置**，CI 仍直连 Maven Central |

**推荐：CI 走 Nexus Maven（待实现）**

在 Tekton 构建中注入仓库地址，**不强制改** `build.gradle.kts` 的默认 `mavenCentral()`，可用 `init.gradle` 或环境变量：

```groovy
// gradle/ci.init.gradle（已实现）
// 仅重定向项目依赖；插件仍走 gradlePluginPortal，避免 classpath 解析异常
def nexusMaven = System.getenv('NEXUS_MAVEN_URL') ?: 'https://nexus.wiloon.com/repository/maven-public/'

allprojects {
    repositories {
        maven { name = 'NexusMaven'; url = uri(nexusMaven) }
        mavenCentral()
    }
}
```

Tekton Task / Containerfile `RUN` 中：

```bash
export NEXUS_MAVEN_URL=https://nexus.wiloon.com/repository/maven-public/
./gradlew bootJar --no-daemon -x test -I gradle/ci.init.gradle
```

**效果**：首次构建 Nexus 从公网拉取并落盘；同集群后续 PipelineRun **共享同一份 jar 缓存**（优于单 Pod 临时 PVC）。

**Nexus REST API（Agent / 自动化）**

Nexus 提供 **REST API v1**，基路径：

```text
https://nexus.wiloon.com/service/rest/v1/
```

常用端点：

| 操作 | 方法 | 路径 |
| --- | --- | --- |
| 健康检查 | GET | `/service/rest/v1/status` |
| 列出仓库 | GET | `/service/rest/v1/repositories` |
| 查看仓库 | GET | `/service/rest/v1/repositories/{name}` |
| 创建 Docker proxy | POST | `/service/rest/v1/repositories/docker/proxy` |
| 创建 Maven proxy | POST | `/service/rest/v1/repositories/maven/proxy` |

**Agent 操作方式**（与 `w10n-config/infra/homelab/k8s/nexus/scripts/setup-k8s-registry-proxy.sh` 相同）：

1. `kubectl port-forward -n nexus deploy/nexus 18081:8081`
2. 使用 `infra/homelab/k8s/nexus/.env` 中的 `NEXUS_USER` / `NEXUS_PASS`（或 UI 密码）做 Basic Auth
3. `curl -u admin:*** http://127.0.0.1:18081/service/rest/v1/repositories`

Maven 代理仓库在 homelab **已存在**，通常**无需**再调 API 创建；实现 CI 加速时以 **配置 Gradle 仓库 URL** 为主。

**其他加速手段（可选，与 Nexus 正交）**

| 手段 | 说明 |
| --- | --- |
| **拆分 Gradle + Kaniko** | 独立 Tekton Task 用 Gradle 镜像 `bootJar`；Kaniko 仅 COPY jar 进 JRE 镜像（避免 Kaniko 内编译慢） |
| **Gradle 缓存 PVC** | Tekton workspace 持久化 `~/.gradle`，加速解析/编译缓存；可与 Nexus 叠加 |
| **Nexus 磁盘** | Maven 缓存占用 `nexus-data` PVC（现网 12Gi）；需定期 Cleanup，见 `nexus/AGENTS.md` |

**验收（§4.10 落地后）**

- [ ] Tekton 构建日志显示从 `nexus.wiloon.com/repository/maven-public` 解析依赖
- [ ] 第二次构建明显快于首次（jar 命中 Nexus 缓存）
- [ ] `nexus-data` 使用率未异常飙升（必要时配置 Maven cleanup policy）

### 4.11 CI 备选：Tekton + buildpacks-phases（Paketo，未落地）

**状态**：备选方案；**当前 CI 继续 Kaniko + Containerfile（§4.5）**，本节供后续迁移参考。

#### 动机

| 对比项 | 当前 Kaniko + Containerfile | 备选 buildpacks-phases + Paketo |
| --- | --- | --- |
| Docker daemon / `docker.sock` | 不需要 | 不需要 |
| Containerfile | 需要 | 不需要 |
| 与本地 `bootBuildImage` 一致 | 否（CI 手写 Temurin 多阶段） | 是（同一 Paketo builder / buildpack） |
| OCI 镜像分层 | 整包 `COPY *.jar` 单层 | Paketo Spring Boot buildpack 读 `layers.idx` 切多层 |
| PSA baseline 兼容 | 是 | 是（不 privileged、不挂 sock） |

`w10n-config` 中已有 `task-pack-build-java.yaml`（`pack` CLI + privileged + `docker.sock`），与 PSA baseline 冲突，**不可**作为 CI 方案。`buildpacks-phases` 是 CNB 官方给 Tekton 的无 daemon 集成方式：Platform 直接调 lifecycle（prepare → detect → build → export），镜像 push 到 registry。

#### 预期 Pipeline 形态

```text
git-clone-ssh
  → [可选] gradle-boot-jar（Nexus：`gradle/ci.init.gradle`）
  → buildpacks-phases（Paketo builder，push 镜像）
  → update-gitops
```

与 Kaniko 路径**并存**：Go 等项目继续 `kaniko-build`；仅 Java Pipeline 的 `build-image` Task 可替换为 `buildpacks-phases`。

典型 Task 参数（落地时需对照 [CNB Tekton 文档](https://buildpacks.io/docs/for-platform-operators/how-to/integrate-ci/tekton/) 与 Catalog 版本）：

```yaml
- name: build-image
  taskRef:
    name: buildpacks-phases
  params:
  - name: APP_IMAGE
    value: docker-hosted.wiloon.com/enx-api-java:$(tasks.fetch-source.results.commit)
  - name: CNB_BUILDER_IMAGE
    value: paketobuildpacks/builder-noble-java-tiny:latest
  - name: SOURCE_SUBPATH
    value: repo/enx-api-java
  - name: CNB_ENV_VARS
    value:
    - BP_JVM_VERSION=26
  workspaces:
  - name: source
    workspace: source-code
```

#### 落地前置条件

| 项 | 说明 |
| --- | --- |
| 安装 Catalog Task | 在 `tekton-pipelines` 安装 `buildpacks-phases`（及依赖 Task），纳入 `kustomization.yaml` |
| Nexus Maven | 若 Paketo Gradle buildpack 从源码编译，需等价于 `gradle/ci.init.gradle` 的仓库配置（`CNB_ENV_VARS` 或 binding）；或保留独立 Tekton step 先 `./gradlew bootJar -I gradle/ci.init.gradle`，再让 buildpack 只打镜像 |
| Registry 凭据 | 与 Kaniko 相同，复用 `nexus-docker-cred` workspace |
| Builder 拉取 | builder 镜像经 `docker-registry.wiloon.com` 代理（与现网 Kaniko `--registry-mirror` 一致） |
| JDK 26 | `BP_JVM_VERSION=26`；需验证 builder 内 Paketo JVM buildpack 对 26 的支持窗口 |

#### 与分层 JAR 的关系

Spring Boot `bootJar` 默认产出带 `BOOT-INF/layers.idx` 的可执行 jar。Paketo Spring Boot buildpack 读取该索引，将依赖层与应用层写入不同 OCI layer——与本地 `bootBuildImage` 行为一致，优于当前 Containerfile 的整包 `COPY`。

#### 迁移验收（落地后）

- [ ] Pipeline 不再引用 `enx-api-java/Containerfile`（可选删除 Containerfile）
- [ ] 构建日志可见 Paketo detect / `Creating slices from layers index`
- [ ] 镜像 push 至 `docker-hosted.wiloon.com/enx-api-java:<commit>`，ArgoCD 部署正常
- [ ] 依赖经 Nexus `maven-public` 解析（日志或 Nexus 浏览确认）
- [ ] 本地 `bootBuildImage` 与 CI 镜像分层策略一致（同为 Paketo）

#### 参考

- CNB + Tekton：[buildpacks-phases Task](https://buildpacks.io/docs/for-platform-operators/how-to/integrate-ci/tekton/)
- Spring Boot 容器打包（fat jar / 分层 JAR / Buildpacks / buildpacks-phases 对比）：blog `spring-boot-container-packaging`
- homelab 已有但未接入 Pipeline 的 `pack` Task：`w10n-config/infra/homelab/k8s/tekton/task-pack-build-java.yaml`（**勿用**，仅作历史参考）

---

## 5. API 选型与路由策略

### 5.1 选型结论

| 类别 | 选定 API | 理由 |
| --- | --- | --- |
| **从 Go 迁移**（Go 删除，仅 Java 处理） | `POST /api/log` | 无 DB；需 Cognito 认证（覆盖 Spring Security 学习面）；业务影响面小；Go 实现约 10 行 |
| **暂不实现（仍由 Go 处理）** | `GET /api/version`、`GET /ping` | 用户要求首阶段不在 Java 侧实现；E2E 与 K8s 探针继续依赖 Go |
| **双栈（后续 Spec）** | — | 原 `GET /api/version` 双栈方案推迟，见 §12 |

### 5.2 API 契约（必须与 Go 兼容）

#### `POST /api/log`（迁移至 Java）

Go 参考：`enx-api/enx-api.go` → `LogHandler`

**Request**

```json
{
  "event": "string",
  "message": "string",
  "timestamp": "string"
}
```

**Response 200**

```json
{
  "success": true
}
```

**Response 400**（非法 body）

```json
{
  "success": false,
  "message": "Invalid log request"
}
```

**认证**：`Authorization: Bearer <Cognito access_token>`（与 Go 相同；ui + chrome 双 client aud）

**行为**：记录结构化日志（等价 Go 的 `[FE-LOG] event: …`）；不落库

### 5.3 Kong Ingress 路由表

域名不变：`enx-lab.wiloon.com`

| 优先级 | 路径 | 方法 | 后端 Service | 模式 |
| --- | --- | --- | --- | --- |
| 1 | `/api/log` | POST | `enx-api-java` | **仅 Java**（迁移完成后） |
| 2 | `/ping` | GET | `enx-api` | **仅 Go** |
| 3 | `/api/version` | GET | `enx-api` | **仅 Go** |
| 4 | `/` | * | `enx-api` | **仅 Go**（默认兜底） |

**实现方式**：在 `ingress.yaml` 中为同一 host 配置 **多条 path**（Kong Ingress Controller 支持）；`/api/log` 规则必须排在 `/` 之前。

**CORS**：Java 需复制 Go 的 CORS 行为（`enx-api/enx-api.go` 中 allowed origins + `chrome-extension:`），否则 enx-chrome 预检失败。

---

## 6. 待实现内容

### 6.1 `enx` 仓库

#### 任务 A：脚手架 `enx-api-java/`

- [x] Spring Boot 4.1.0 + Java 26 + Gradle Wrapper **9.6.0**
- [x] DDD 四层包结构（见 §4.8）：

```text
enx-api-java/
├── build.gradle.kts
├── settings.gradle.kts
├── gradle/wrapper/
├── Taskfile.yml
├── src/main/java/com/wiloon/enx/
│   ├── EnxApiJavaApplication.java
│   ├── api/                              # 接口层（≈ Go handlers）
│   │   ├── common/ApiResponse.java
│   │   ├── common/GlobalExceptionHandler.java
│   │   └── log/LogController.java
│   │   └── log/LogRequest.java
│   ├── application/                      # 应用层
│   │   └── log/FrontendLogService.java
│   ├── domain/                           # 领域层
│   │   └── log/FrontendLog.java
│   │   └── log/FrontendLogWriter.java    # 端口接口
│   └── infrastructure/                   # 基础设施
│       ├── config/SecurityConfig.java
│       ├── config/CorsConfig.java
│       ├── config/CognitoProperties.java
│       └── logging/Slf4jFrontendLogWriter.java
├── src/main/resources/
│   ├── application.yml
│   └── application-k8s.yml
└── src/test/java/...                     # 测试包路径与 main 镜像
```

- [ ] **无** `Containerfile` / `Dockerfile`
- [ ] 环境变量（与 Go 对齐）：

| 变量 | 来源（K8s） | 用途 |
| --- | --- | --- |
| `COGNITO_REGION` | `enx-cognito` | JWT issuer |
| `COGNITO_USER_POOL_ID` | `enx-cognito` | JWT issuer |
| `COGNITO_CLIENT_ID` | `enx-cognito` | aud（ui） |
| `COGNITO_CHROME_CLIENT_ID` | `enx-cognito` | aud（chrome） |
| `SERVER_PORT` | 默认 `8092` | 与 Go 8091 区分 |

- [ ] 根目录 `Taskfile.yml` 增加 `java:*` 任务；`README.md` 项目表增加 `enx-api-java` 行

#### 任务 B：实现 `POST /api/log`（迁移）

- [x] Spring Security Resource Server 校验 Cognito JWT
- [x] DDD 分层实现：`LogController` → `FrontendLogService` → `FrontendLogWriter`
- [x] **Go 侧删除**：`apiGroup.POST("/log")`、`authGroup.POST("/log")`、`LogHandler` 及仅用于 log 的测试
- [ ] 确认无客户端硬编码依赖 Go 特有 log 格式（当前无专用客户端调用，仍建议 grep 全仓库）

#### 任务 C：测试

- [x] Java：`LogControllerTest`（MockMvc + Security 测试配置）
- [x] Java：`FrontendLogServiceTest`（Application 层单元测试）
- [x] Java：CORS preflight `OPTIONS /api/log` 测试
- [x] Go：删除 log 路由后现有 e2e / cognito 测试仍通过（`TestRegister_Success` 等为原有问题）
- [ ] 可选：enx 根目录增加 `task test-java`

#### 任务 D：镜像构建验证

- [ ] 本地 `./gradlew bootBuildImage` 成功产出镜像
- [ ] 容器内 Actuator health 可访问（`:8092/actuator/health`）

### 6.2 `w10n-config` 仓库

#### 任务 E：K8s 资源

新建 / 修改 `infra/homelab/k8s/enx/`：

| 文件 | 动作 |
| --- | --- |
| `deployment-java.yaml` | 新建 `enx-api-java` Deployment（port 8092，注入 Cognito env，**无** SQLite PVC） |
| `service-java.yaml` | 新建 ClusterIP `enx-api-java:8092` |
| `ingress.yaml` | 修改：拆分 path → `/api/log` → java；其余 → go |
| `kustomization.yaml` | 纳入新资源 |
| `README.md` | 补充 Java 双栈说明与验证命令 |

**探针建议**

| 容器 | Liveness | Readiness |
| --- | --- | --- |
| enx-api (Go) | `GET /ping:8091` | 同左 |
| enx-api-java | `GET /actuator/health/liveness:8092` | `GET /actuator/health/readiness:8092` |

#### 任务 F：CI / 构建

- [x] Tekton：`pipeline-build-enx-api-java.yaml` + `pipelinerun-enx-api-java.yaml`
- [x] Tekton Task：`kaniko-build` + `enx-api-java/Containerfile`（当前；Paketo 经 `pack`/sock 不可用，备选 `buildpacks-phases` 见 §4.11）
- [x] CI 配置 Nexus Maven 代理（§4.10：`gradle/ci.init.gradle` + Containerfile）
- [x] 镜像：`docker-hosted.wiloon.com/enx-api-java:<commit>`
- [x] GitOps：`update-gitops` 更新 `deployment-java.yaml` 镜像 tag
- [ ] ArgoCD：确认 `enx` Application 覆盖新 Deployment

### 6.3 本地开发

| 进程 | 地址 | 说明 |
| --- | --- | --- |
| Go | `http://localhost:8090` | 现有 `task api:start` |
| Java | `http://localhost:8092` | 新 `task java:run` |

本地无 Kong 时：直连 Java `:8092` 验证 `POST /api/log`；`/api/version` 仍走 Go `:8090`。

---

## 7. 实施顺序（推荐）

```text
1. enx-api-java 脚手架（Gradle 9.6.0 + Spring Boot 4.1.0 + Wrapper）
2. POST /api/log + Cognito Security + 单元测试
3. 本地 Java 8092 验证 /api/log；bootBuildImage 产出镜像
4. w10n-config：Deployment/Service/Ingress（/api/log → java）
5. Tekton Kaniko 构建流水线 + 部署 homelab（备选 Paketo：`buildpacks-phases`，§4.11）
6. 集群验证：curl -H "Authorization: …" POST /api/log → Java Pod 日志
7. Go 删除 /api/log 路由 + 测试
8. 确认 /api/version、/ping 仍由 Go 正常响应；enx-chrome E2E 通过
9. 更新本文档状态为 Done，勾选验收清单
```

---

## 8. 验收标准

### 8.1 功能

- [ ] `kubectl get pods -n enx` 同时存在 `enx-api` 与 `enx-api-java`，均为 Running
- [ ] `curl -X POST https://enx-lab.wiloon.com/api/log -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d '{"event":"test","message":"hi","timestamp":"2026-06-21T00:00:00Z"}'` → `{"success":true}`，且 **请求到达 Java Pod**（查 Java 日志）
- [ ] Go Pod **不再**注册 `/api/log`（误路由到 Go 应 404；仅 Java 处理）
- [ ] `curl https://enx-lab.wiloon.com/api/version` 与 `curl https://enx-lab.wiloon.com/ping` **仍由 Go 响应**（Java 无这两个端点）
- [ ] enx-chrome / enx-ui 现有登录与 `/api/me` 流程不受影响
- [ ] enx-chrome E2E（依赖 Go `/api/version` 探活）通过

### 8.2 契约

- [ ] Java `/api/log` 状态码与 error body 与 Go 删除前行为一致

### 8.3 运维

- [ ] 镜像经 Tekton（Kaniko + Containerfile）构建并推送到 `docker-hosted.wiloon.com/enx-api-java`
- [x] `enx-api-java/Containerfile` 存在（CI 用；本地仍可用 Paketo `bootBuildImage`）
- [ ] ArgoCD sync 成功；回滚：Ingress `/api/log` 指回 Go（需临时恢复 Go handler）+ scale Java 至 0

---

## 9. 风险与约束

| 风险 | 缓解 |
| --- | --- |
| Java 访问 SQLite 导致文件锁 | 首阶段 **禁止** Java 读 `enx.db` |
| Cognito aud 双 client | Spring Security 配置 **多个 allowed audience**（与 Go `ClientIDs` 一致） |
| CORS 预检失败 | 复制 Go allowed origins 列表；支持 `OPTIONS` |
| Ingress path 顺序错误 | `/api/log` 必须在 `/` 之前 |
| CI 首构建过慢 | Kaniko 内 `gradlew bootJar` + 直连 Maven Central；按 §4.10 配置 Nexus Maven 或拆分 Gradle Task |
| Paketo 对 JDK 26 支持滞后 | 本地 `bootBuildImage` 设置 `BP_JVM_VERSION=26`；CI 已改用 Temurin 26 Containerfile |
| Tekton `pack` 与 PSA 冲突 | 当前 Kaniko（§4.5）；备选 `buildpacks-phases`（§4.11）可无 sock 走 Paketo；勿对 `tekton-pipelines` 降为 privileged 除非明确接受风险 |

---

## 10. 相关文件索引

| 仓库 | 路径 | 说明 |
| --- | --- | --- |
| enx | `enx-api/enx-api.go` | Go 路由注册（迁移时改） |
| enx | `enx-api/middleware/cognito_auth.go` | JWT 校验参考 |
| enx | `enx-chrome/playwright.config.ts` | E2E 探活 Go `/api/version` |
| w10n-config | `infra/homelab/k8s/enx/ingress.yaml` | Kong 路由 |
| w10n-config | `infra/homelab/k8s/enx/deployment.yaml` | Go Deployment |
| w10n-config | `infra/homelab/k8s/tekton/pipeline-build-enx-api.yaml` | Go 构建流水线（Kaniko） |
| w10n-config | `infra/homelab/k8s/tekton/pipeline-build-enx-api-java.yaml` | Java 构建流水线（Kaniko，当前） |
| w10n-config | `infra/homelab/k8s/tekton/task-pack-build-java.yaml` | `pack` + docker.sock（与 PSA 冲突，勿用；备选见 §4.11） |
| CNB 官方 | [Tekton buildpacks-phases](https://buildpacks.io/docs/for-platform-operators/how-to/integrate-ci/tekton/) | CI 备选 Platform 集成（§4.11） |
| w10n-config | `infra/homelab/k8s/nexus/README.md` | Nexus Docker/Maven 代理 |
| w10n-config | `infra/homelab/k8s/nexus/scripts/setup-k8s-registry-proxy.sh` | Nexus REST API 创建仓库示例 |
| w10n-config | `infra/homelab/workstation/install-jdk.yml` | JDK 26 安装 |

---

## 11. SDD 工作方式（给 Agent / 开发者）

1. **实现前**：以本文 Spec 为唯一需求来源；若发现契约与代码不符，**先改 Spec** 再改代码。
2. **实现中**：按 §7 顺序提交；**Ingress 指向 Java 的 `/api/log` 必须与 Go 删除同批或之后**，避免 404。
3. **实现后**：勾选 §8 验收清单；将文首 **状态** 更新为 `Done — YYYY-MM-DD`；在 `enx/.ai/contributions.md` 追加简要记录（可选）。

---

## 12. 后续扩展（Out of Scope，供未来 Spec 引用）

- **API 网关分层与 `/api/v1` 公开契约**：见 [TASK-SPEC-enx-api-gateway-v1.md](./TASK-SPEC-enx-api-gateway-v1.md)（OpenAPI + Kong strip + 后端域内路径）
- Java 双栈实现 `GET /api/version`（与 Go 相同契约，Kong 可切换）
- Java 实现 `GET /ping` 或统一仅使用 Actuator 作为 Java 对外健康端点
- 将 `/api/me` 迁移至 Java（需解决 SQLite 只读副本或迁 PostgreSQL）
- Kong 金丝雀流量比例
- 统一 OpenAPI spec（`openapi.yaml`）生成 Go/Java 客户端
- EC2 生产环境（`enx.wiloon.com`）同步双栈 Ingress
