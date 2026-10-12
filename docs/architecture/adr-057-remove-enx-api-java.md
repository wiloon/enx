---
status: accepted
date: 2026-10-12
related: adr-015（Cognito → Clerk，enx-api-java 因此下线）、adr-056（enx-api 改用 ko，范围里特意排除了 enx-api-java）
---

# ADR-057：移除 Java 后端 enx-api-java

enx-api-java 是 2026-06 为熟悉 Java / Spring Boot 加进来的（`TASK-SPEC-enx-api-java.md`），和 Go 的 enx-api 并行，只接管了 `POST /api/log` 一个接口，共 16 个 Java 文件。加它的直接动机是一次 Java 职位面试，这件事已经结束。

它现在的状态：

- **已经不在线上。** ADR-015 切到 Clerk 时，它校验的仍是 Cognito JWT，homelab Ingress 里 `/api/log` 的分流随之删除，请求全部回到 Go。之后没人再迁它。
- **它和上线目标无关**，但每次横跨全局的改动都要单独考虑它：ADR-015 要处理它的路由，ADR-018 排查死接口要查它，ADR-056 要写明不管它，homelab 曾因它的镜像拉取失败（`ImagePullBackOff`）专门排查节点 DNS。

我们决定：**把 enx-api-java 移出仓库，后端只保留 Go。** 代码和历史保留在两处：

- tag `archive/enx-api-java-final`：仍包含 `enx-api-java/` 的最后一个 main commit。恢复：`git checkout archive/enx-api-java-final -- enx-api-java`。
- 公开仓库 [wiloon/enx-api-java](https://github.com/wiloon/enx-api-java)：用 `git filter-repo --subdirectory-filter` 带历史拆出，已设为 archived。

一起删除的：根 `Taskfile.yml` 的 `java:*` 与 `tekton:build:java-api` 任务、README 里的条目；w10n-config 里 enx-api-java 的 Tekton Pipeline / PipelineRun / Task 和 homelab Taskfile 任务。`TASK-SPEC-enx-api-java.md` 标为 Superseded；`TASK-SPEC-enx-api-gateway-v1.md` 的触发原因是「Go + Java 多后端共存」，标为 Shelved。历史 ADR 和交接文档里对 enx-api-java 的提及保持原样。

## Considered Options

- **保留，作为技术探索**：要先把认证迁到 Clerk 才能重新上线，之后每次全局改动还要多维护一个后端，占用上线前的时间。否决。以后想练 Java，另起一个和 ENX 无关的仓库，不拖主线。
- **保留目录但不维护**：代码会继续腐化（已经停在 Cognito），且仍会出现在全局搜索和改动范围里。否决。
- **直接删除，不另建仓库**：tag 已足够恢复，但单独的归档仓库更容易被找到和浏览，成本很低。选了两者都留。

## Consequences

- 后端只有 Go 一种语言，DDD、测试、构建（ko）、部署规则都只针对 enx-api。
- 若将来重新引入第二个后端语言，需要新的 ADR，并重写网关 Spec。
