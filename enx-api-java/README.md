# enx-api-java

Java REST API for ENX (dual-stack with Go `enx-api`).

## Stack

- Java 26, Spring Boot 4.1.0, Gradle 9.6.0
- DDD layering: `api` / `application` / `domain` / `infrastructure`
- Cognito JWT (OAuth2 Resource Server)
- CI: Kaniko + `Containerfile` (Tekton); local: Paketo via `bootBuildImage`

## Package layout (DDD)

```text
com.wiloon.enx/
├── api/              # Controllers, API DTOs
├── application/      # Use cases (FrontendLogService)
├── domain/           # Entities, value objects, port interfaces
└── infrastructure/   # Security, Cognito, Slf4j logging adapter
```

## Endpoints (phase 1)

| Method | Path | Auth |
| --- | --- | --- |
| POST | `/api/log` | Cognito JWT |

Health: `GET /actuator/health` (cluster internal / K8s probes)

## Local development

```bash
export COGNITO_REGION=us-east-1
export COGNITO_USER_POOL_ID=...
export COGNITO_CLIENT_ID=...
export COGNITO_CHROME_CLIENT_ID=...
export SERVER_PORT=8092

task test
task run
```

From repo root: `task java:test`, `task java:run`.

## Build image

**CI (Tekton):** Kaniko builds `Containerfile` (multi-stage Gradle + Temurin JRE). Gradle dependencies resolve via Nexus `maven-public` (`gradle/ci.init.gradle`).

**Local (Paketo):**

```bash
task image
# or: ./gradlew bootBuildImage --imageName=docker-hosted.wiloon.com/enx-api-java:local
```

Requires Docker for `bootBuildImage`.

**CI dependency cache:** Tekton passes `-I gradle/ci.init.gradle` so jar/aar resolve from `https://nexus.wiloon.com/repository/maven-public/` (Nexus proxies Maven Central). Gradle distribution zip still downloads from `services.gradle.org`.

## Spec

See [docs/tasks/TASK-SPEC-enx-api-java.md](../docs/tasks/TASK-SPEC-enx-api-java.md).
