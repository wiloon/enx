---
status: accepted
date: 2026-10-12
related: adr-031（生产部署拓扑：同一镜像跑 homelab 和生产，§6a 版本号规则）、adr-019（enx-ui 运行时配置，镜像与环境无关）
---

# ADR-055：enx-ui 镜像改用 Cloud Native Buildpacks 构建，homelab 与生产共用一个构建脚本

enx-ui 镜像一直由 `enx-ui/Containerfile` 构建：homelab 用 Tekton + Kaniko，生产用 GitHub Actions + buildx。两个问题：

- Kaniko 上游（GoogleContainerTools/kaniko）2025-06 已归档，`gcr.io/kaniko-project/executor:v1.23.0` 不再有安全更新。
- homelab 一次 enx-ui 构建约 5 分 20 秒，其中解压缓存的 `node_modules` 层 78 秒，每次新建、挂载 Longhorn RWX 卷约 40 秒。

我们决定：**enx-ui 镜像改用 Cloud Native Buildpacks（CNB）构建。构建逻辑只有一份：仓库里的 `enx-ui/cnb/build.sh`，homelab 的 Tekton 和生产的 GitHub Actions 都在同一个固定版本的 builder 镜像里执行它。**

过程和数据见 [RUNBOOK-enx-ui-cnb-build-experiment](../tasks/RUNBOOK-enx-ui-cnb-build-experiment.md)。

## Considered Options

- **继续用 Kaniko**：上游已归档。否决。
- **Containerfile + BuildKit**：Containerfile 现成、生产的 buildx 本来就是 BuildKit，改动最小。但 homelab 要常驻一个 `buildkitd`，rootless 模式也要放宽 seccomp/AppArmor（否则就是 privileged）。CNB 的 lifecycle 以普通用户运行，不需要任何特权，还支持 rebase。选 CNB，BuildKit 作为备选。
- **CNB + builder 自带的 buildpack（实测 `heroku/builder:24`）**：能构建，但镜像 565 MB（现在 77 MB，7.3 倍）。Heroku 的 Node buildpack 按通用 Node 应用设计，把 pnpm 虚拟 store、pnpm、整个项目目录都放进镜像，run image 也只有完整的 Ubuntu 一种；它的 pnpm 虚拟 store 在项目外，还需要 Next 16.4 的 `experimental.turbopackAdditionalRoots` 才能让 Turbopack 构建通过。否决。
- **CNB + Paketo / Google builder**：Paketo 官方不支持 pnpm（RFC 未落地）；Google 支持 pnpm，但同样是通用 Node buildpack 加 Ubuntu run image，体积问题一样。否决。
- **alpine 作为 run image**：musl。Node 和 `sharp` 的原生二进制要准备 glibc（构建期）和 musl（运行期）两套。否决，改用 glibc 的 tiny 镜像。
- **生产用 `pack build`**：pack 会自己解释 `project.toml`，而 Tekton 里没有 pack，要另写一套同样的逻辑，两边会慢慢走样。否决，两边都直接调 lifecycle，并且通过同一个 `build.sh` 调用。

## Decision

1. **三个组件**：
   - **builder**：`heroku/builder:24`，只用它的 Ubuntu 24.04 构建环境和 lifecycle，**不用它自带的 buildpack**。
   - **buildpack**：仓库里的 `enx-ui/cnb/nextjs-standalone`（`bin/detect` + `bin/build`）。完整 Node.js 和 pnpm 只放在构建期 layer；pnpm store 只做缓存；launch layer 只有 `node` 可执行文件；构建结束后应用目录只留 `.next/standalone`（加 `.next/static`、`public`）。`node_modules` 在项目目录内，不需要 `turbopackAdditionalRoots`。
   - **run image**：`paketobuildpacks/ubuntu-noble-run-tiny`。Ubuntu 24.04、glibc，约 11 MB，带 `libstdc++`、`libssl`、`libz`，没有 shell，运行用户 `1002:1001`。

2. **版本固定在一个地方**：builder 和 run image 按 digest 写在 `enx-ui/cnb/images.conf`，只此一处。Tekton 先用 `cnb-resolve-builder` 从仓库读出 builder 作为 step 镜像，GitHub Actions 直接读这个文件。升级时只改这个文件。

   文件名不叫 `images.env`：仓库根 `.gitignore` 的 `*.env` 是防止密钥误提交的，不为它破例。

3. **构建脚本只有一个**：`enx-ui/cnb/build.sh`，在 builder 镜像里运行：把 `project.toml` 的 `[[io.buildpacks.build.env]]` 转成 lifecycle 的 platform env，布置仓库 buildpack，调用 `/cnb/lifecycle/creator`。

4. **两个环境只允许这些参数不同**：

   | 参数 | homelab（Tekton） | 生产（GitHub Actions） |
   | --- | --- | --- |
   | npm 源 `ENX_NPM_REGISTRY` | 集群内 Nexus npm-group（HTTP） | `https://registry.npmjs.org/` |
   | 推送仓库 | Nexus `enx-ui`（不变） | ECR `enx-ui`（不变） |
   | 缓存镜像 `ENX_CACHE_IMAGE` | Nexus `enx-ui-cnb-cache:latest` | ECR `enx-ui-cnb-cache:latest`（新建，tag 可变） |
   | run image 来源 `ENX_RUN_IMAGE_MIRROR` | 集群内 Nexus Docker Hub 代理 | Docker Hub |
   | 输出方式 | 直接推 registry，`cnb-latest` 作为 previous image 复用 layer | `ENX_DAEMON=1` 写入本地 Docker，smoke test 通过后再推 ECR |

   镜像 tag 规则不变：homelab 是 commit SHA，生产是 release tag（ADR-031 §6a）。ECR `enx-ui` 仍是 `IMMUTABLE`；缓存每次构建都要覆盖同一个 tag，所以单独一个可变的仓库 `enx-ui-cnb-cache`，未打 tag 的清单 1 天后过期。

5. **运行时不变**：镜像仍与环境无关，所有部署相关的值在运行时读取（ADR-019）。生产主机的 systemd 单元和 homelab 的 Deployment 都没有覆盖启动命令、没有挂载目录，所以入口换成 CNB launcher、运行用户从 root 换成 1002 都不需要改它们。监听地址仍由 `HOSTNAME`/`PORT` 决定，和 Containerfile 镜像相同。

6. **切换顺序**：homelab 的 `build-enx-ui` Pipeline 直接换成 CNB（w10n-config `task-cnb-build.yaml`、`pipeline-build-enx-ui.yaml`），`task deploy:homelab:ui` 用法不变。`enx-ui/Containerfile` 和 `enx-ui/.dockerignore` 暂时保留，生产第一次用 CNB 镜像发布成功之后再删除。

7. **范围**：只管 enx-ui。enx-api 改用 ko 另议。

## Consequences

- **好处**：镜像大小不变（实测 79.9 MB，Containerfile 镜像 76.9 MB）；homelab 只改代码时构建约 3 分钟（Kaniko 约 4 分 50 秒）；构建不需要 privileged，以非 root 运行；系统层出补丁时可以 rebase，不必重新构建；homelab 和生产的构建定义完全相同。
- **代价**：buildpack 是自己维护的。Node 下载、pnpm 安装、standalone 整理这些原本写在 Containerfile 里的逻辑，现在写在 `bin/build` 里，CNB 特有的细节也要自己处理。实验中遇到的：
  - lifecycle 恢复缓存时会重新格式化 layer 的 TOML（键前有缩进），读版本号要容忍缩进；
  - Corepack 安装的 pnpm 12 启动器从 Nexus 拉平台二进制时读不到 `integrity`，改为和 Containerfile 一样 `npm install -g`；
  - 下载必须设超时，否则一次卡住的 nodejs.org 下载拖了 17 分钟。
- **run image 没有 shell**：无法 `kubectl exec ... sh` 进容器排查，要用 `kubectl debug` 或临时 pod。
- **升级流程**：
  - Node：改 `.node-version`；
  - pnpm：改 `package.json` 的 `packageManager`；
  - builder / run image：查新 digest，改 `images.conf`。run image 必须和 builder 是同一个 Ubuntu 版本。
