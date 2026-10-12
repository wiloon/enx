---
status: proposed
date: 2026-10-12
related: adr-055（enx-ui 改用 CNB：一个构建脚本、版本固定在一处，本 ADR 沿用同一套做法）、adr-031（生产部署拓扑：同一镜像跑 homelab 和生产，§6a 版本号规则）、adr-040（服务指标，9091 端口）
---

# ADR-056：enx-api 镜像改用 ko 构建，homelab 与生产共用一个构建脚本

enx-api 镜像现在由 `enx-api/Containerfile` 构建：homelab 用 Tekton + Kaniko，生产用 GitHub Actions + buildx。homelab 一次构建约 10 分钟，大部分时间都是浪费（2026-10-12 `build-enx-api-sh2zh` 的日志）：

- **真正的编译只有约 2 分 15 秒**，其中 2 分钟是预编译依赖。其余约 6 分钟是 Kaniko 自身的开销：golang 根文件系统解压了 3 次（每个 stage 一次），全文件系统快照做了 5 次，还要推缓存层。
- **预编译依赖的缓存从来没命中过。** Containerfile 的 `deplist` 技巧本来是想让"依赖不变时这一层一直命中缓存"，但最近 4 次构建这一层的缓存 key 每次都不同。`bbbd3f7..aec923b` 之间 `go.mod`/`go.sum` 一点没变，照样重新编译了约 120 秒。原因应该是 Kaniko 在给跨 stage 的 `COPY --from` 算 key 时，把源 stage 也算进去了；这一点是从结果推断的，没有在源码里核实。
- **每次都要新建 Longhorn RWX 卷**，挂载约 40 秒。
- Kaniko 上游已归档（ADR-055）。

我们决定：**enx-api 镜像改用 ko 构建。和 ADR-055 一样，构建逻辑只有一份 `enx-api/build/build.sh`，版本只固定在 `enx-api/build/build.conf` 一处，homelab 的 Tekton 和生产的 GitHub Actions 都在同一个固定版本的 golang 镜像里执行它。**

## 为什么是 ko

ko 是专门把 Go 程序打成镜像的工具：在本机直接 `go build`，再把二进制作为一层叠到基础镜像上，直接推到 registry。不需要 Dockerfile、不需要 Docker daemon、不需要特权，也不解压根文件系统、不做快照。Go 自己的构建缓存（`GOCACHE`）和模块缓存（`GOMODCACHE`）照常生效，只改代码时只重新编译 enx-api 自己的包。

enx-api 满足 ko 的前提：`CGO_ENABLED=0`（SQLite 用的是纯 Go 的 modernc），产物是静态二进制；运行时不需要 shell。

## Considered Options

- **继续用 Kaniko + Containerfile**：上游已归档，且慢。否决。
- **Containerfile + BuildKit**：用 `RUN --mount=type=cache` 缓存 Go 的构建缓存，速度能接近 ko。但要在 homelab 常驻 `buildkitd`，还要维护多阶段 Containerfile 和 `deplist` 这类绕缓存的技巧。否决。
- **CNB（Paketo Go buildpack）**：能构建，但要维护 builder、run image 和 buildpack 三样东西，换来的东西 ko 也能给（非 root、无特权）。对 Go 来说 ko 更直接。否决。
- **ko 用默认基础镜像 `cgr.dev/chainguard/static`**：homelab 的 Nexus 没有 cgr.dev 的代理（ko 自己拉基础镜像，节点上的 containerd 镜像加速对它不起作用），要走公网。否决，改用 Paketo 的 `ubuntu-noble-run-static`：和 enx-ui 的 run image 同一系列，能通过现有的 Nexus Docker Hub 代理拉取。
- **生产直接用 `ko-build/setup-ko` action**：ko 和 Go 的版本会由 action 和 runner 决定，与 homelab 不一致。否决，两边都在 `build.conf` 固定的 golang 镜像里运行同一个脚本。

## Decision

1. **构建方式**：在固定版本的 golang 镜像里执行 `go run github.com/google/ko@<版本> build`。ko 自己作为 Go 模块下载，homelab 走 Nexus 的 Go 代理、生产走 proxy.golang.org，版本和校验和由 Go 模块机制保证，不再额外引入下载来源。

2. **基础镜像**：`paketobuildpacks/ubuntu-noble-run-static`。0.48 MB，Ubuntu 24.04，带 CA 证书（`/etc/ssl/certs/ca-certificates.crt`）、时区数据和 `/tmp`，没有 shell 和 libc，运行用户 `1002:1001`（和 enx-ui 的镜像相同）。

3. **版本固定在一处**：`enx-api/build/build.conf`，按 digest 写：
   - `ENX_GO_IMAGE`：golang 镜像，版本和 `go.mod` 的 `go` 指令一致（现在是 1.27.x）；
   - `ENX_KO_VERSION`：ko 的模块版本；
   - `ENX_BASE_IMAGE`：上面的基础镜像。

   Tekton 用一个小 Task 从仓库读出 `ENX_GO_IMAGE` 作为 step 镜像（和 ADR-055 的 `cnb-resolve-builder` 同一个做法，实现时把它泛化成按键名读取）。GitHub Actions 直接读这个文件。

4. **构建参数**放在 `enx-api/.ko.yaml`：`-trimpath`、`-tags nomsgpack`、`-ldflags "-s -w -X enx-api/version.*"`，版本信息从环境变量（`VERSION`、`GIT_COMMIT`、`GIT_BRANCH`、`BUILD_TIME`）读取，和现在的 Containerfile 一致。只构建 `linux/amd64`。

5. **两个环境只允许这些参数不同**：

   | 参数 | homelab（Tekton） | 生产（GitHub Actions） |
   | --- | --- | --- |
   | Go 模块代理 `GOPROXY` | 集群内 Nexus go-group，回退 goproxy.cn（同现在） | `https://proxy.golang.org,direct`（同现在） |
   | 推送仓库 | Nexus `enx-api`（不变） | ECR `enx-api`（不变，`IMMUTABLE`） |
   | Go 构建缓存 | 专用的 Longhorn PVC（RWO），挂到 `GOCACHE`/`GOMODCACHE` | `actions/cache`，按 `go.sum` 和 golang 镜像 digest 做 key |
   | 基础镜像来源 | 集群内 Nexus Docker Hub 代理 | Docker Hub |

   ko 直接推镜像，不需要单独的缓存镜像，所以生产不用新建 ECR 仓库。镜像 tag 规则不变：homelab 是 commit SHA，生产是 release tag（ADR-031 §6a）。

6. **运行用户从 root 换成 1002:1001**，数据目录的属主要跟着迁移。enx-api 运行时只写 `/var/lib/enx-api`（SQLite `enx.db` 及其 WAL 文件），ECDICT 以只读方式挂载：
   - **homelab**：Deployment 加 `securityContext`：`runAsUser: 1002`、`runAsGroup: 1001`、`fsGroup: 1001`、`fsGroupChangePolicy: OnRootMismatch`，由 kubelet 在挂载 `enx-api-data` 时修正属主。
   - **生产**：Ansible（`install-enx-prod.yml`）在首次 ko 发布前把 `/var/lib/enx-api` 改为 `1002:1001`。备份脚本以 root 读取数据库，不受影响。
   - 两边都要确认 ECDICT 文件对 1002 可读。

7. **验证**：homelab 先 `deploy=false` 构建，再部署，检查 `/ping`、登录、查词、`/metrics`（9091）。GitHub 上加一个 PR CI：用同一个脚本 `--push=false` 构建，确认生产这条路径能走通。

8. **切换顺序**：homelab 的 `build-enx-api` Pipeline 直接换成 ko，`task deploy:homelab:api` 用法不变。`enx-api/Containerfile` 保留到生产第一次用 ko 发布成功之后再删除。

9. **范围**：只管 enx-api。enx-api-java 和 homelab 上其他还在用 Kaniko 的项目不在此列。

## Consequences

- **预计好处**（估算，未实测）：homelab 只改代码时构建从约 10 分钟降到 2 分钟以内（clone 约 10 秒、ko 构建 30–60 秒、推送约 10 秒、gitops 约 25 秒）；镜像比现在的 alpine 版小约 4 MB；不需要特权，以非 root 运行；homelab 和生产的构建定义完全相同。
- **代价**：
  - 运行用户和数据目录属主的迁移，两边各要改一处，生产只有第一次需要；
  - 镜像里没有 shell，排查问题要用 `kubectl debug` 或临时 pod。`cmd/reset-password` 现在本来就不在镜像里，不受影响；
  - homelab 多一个长期存在的 Go 缓存 PVC。它是 RWO 的，同一时间只能有一个 enx-api 构建；现在也是串行构建，影响不大。
- **升级流程**：
  - Go：改 `go.mod` 的同时改 `build.conf` 的 `ENX_GO_IMAGE`；
  - ko：改 `ENX_KO_VERSION`；
  - 基础镜像：查新 digest，改 `ENX_BASE_IMAGE`。
