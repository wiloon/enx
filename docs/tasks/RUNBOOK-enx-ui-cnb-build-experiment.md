---
status: draft（待 review）
date: 2026-10-11
related: adr-031（生产部署拓扑：同一镜像跑 homelab 和生产）
---

# RUNBOOK：在 homelab 用 Cloud Native Buildpacks 构建 enx-ui（实验）

## 目标

验证 CNB 能不能替代 `enx-ui/Containerfile` + Kaniko 构建 enx-ui 镜像，并拿到能做决定的数据。

这是**实验**，不是决定：现有 `build-enx-ui` 流水线和 `enx-ui/Containerfile` 一行不改，生产（GitHub Actions `deploy-prod.yml`，buildx + Containerfile）也不动。实验通过、决定采用时再写 ADR-055，并同时改生产流水线（ADR-031 要求 homelab 和生产跑同一个构建方式产出的镜像）。

## 背景

- 现状：Kaniko v1.23.0（上游 2025-06 已归档），最近一次 `build-enx-ui-manual-ckr9d` 5 分 19 秒，其中解压缓存的 node_modules 层 78 秒、`next build` 约 1 分 35 秒（编译 54 秒、tsc 32 秒），流水线开销约 1 分钟。
- CNB 2026-08-11 从 CNCF 毕业；lifecycle 以非 root 用户运行，不需要 privileged，也不需要常驻进程。
- enx-ui **不是纯前端**：它是 Next.js standalone 服务端（`node server.js`，有 middleware `src/proxy.ts` 和大量 `ƒ` 动态路由），运行时需要 Node。所以只出静态文件的 buildpack（如 Paketo web-servers）不适用。

## Builder 选型：`heroku/builder:24`

| builder | pnpm | 结论 |
|---|---|---|
| **Heroku** `heroku/builder:24` | 通过 Corepack 安装，读 `packageManager`（我们是 `pnpm@12.6.0`）；install、build、裁剪 devDependencies 都用 pnpm | **选它**。Heroku Fir（K8s 上的新一代平台）生产在用 |
| Google `gcr.io/buildpacks/builder` | 支持 pnpm，但版本只读 `engines.pnpm`，文档没提 `packageManager` | 要在 `package.json` 再写一份 pnpm 版本，两处会漂移 |
| Paketo | 没查到官方 pnpm 支持 | 不选 |

## 待验证的风险（实验要回答的问题）

1. **pnpm 12.6.0 能不能装上**：Corepack 下载 pnpm 走 npm registry，需要把 `COREPACK_NPM_REGISTRY` 指到 Nexus。
2. **Node.js 下载**：Heroku buildpack 从它自己的源下载 Node，homelab 出网走 xray，可能慢或失败。看能否换成 Nexus 的 raw proxy；不能的话记录耗时和失败率。
3. **npm 源**：`.npmrc` 里是 `https://nexus.wiloon.com`（内网 CA，builder 不信任）。用环境变量 `npm_config_registry` 覆盖成集群内 `http://nexus.nexus.svc.cluster.local:8081/repository/npm-group/`，与 Containerfile 的 `NPM_REGISTRY` 同一个地址。
4. **`minimumReleaseAge` / `allowBuilds`**：pnpm 读 `pnpm-workspace.yaml`，理论上照常生效，在构建日志里确认。
5. **standalone 产物**：Heroku 默认用 `npm start`（`next start`），与 `output: 'standalone'` 不兼容。需要：
   - `Procfile`：`web: node .next/standalone/server.js`
   - 构建后把 `.next/static` 和 `public` 复制进 `.next/standalone`（用 `heroku-postbuild` 脚本，或 `project.toml` 里的 inline buildpack；以实测可用的为准）。
6. **镜像大小**：buildpack 会把裁剪后的整个 `node_modules` 留在镜像里，standalone 自己又带一份追踪后的 `node_modules`，镜像会比现在大。记录大小，判断能否接受。
7. **运行时基础镜像**：从 `node:24-alpine`（musl）换成 Ubuntu 24.04（glibc），`sharp` 的原生二进制会变；`smoke-runtime.sh` 和手动页面检查覆盖。
8. **监听地址**：Next standalone 按 `HOSTNAME`/`PORT` 监听。现镜像不设这两个变量、监听 3000；CNB 镜像要保持 3000（必要时在 `project.toml` 或 deployment 里显式设 `PORT=3000`、`HOSTNAME=0.0.0.0`）。
9. **构建时环境变量**：Containerfile 里的 `NEXT_PUBLIC_CLERK_*` 四个路由、占位 `CLERK_SECRET_KEY`、`NEXT_TELEMETRY_DISABLED=1`，在 `project.toml` 的 `[[io.buildpacks.build.env]]` 里给出。

## 要改的文件

**enx 仓库**（分支 `feat/enx-ui-cnb-build-experiment`，只新增，不改现有构建）：

- `enx-ui/project.toml`：builder 无关的 CNB 配置（构建时环境变量、排除文件，排除列表对应 `.dockerignore`）。
- `enx-ui/Procfile`：`web: node .next/standalone/server.js`。
- `enx-ui/package.json`：如果需要，加 `heroku-postbuild` 复制 static/public（只有 buildpack 会执行它，本地 `pnpm build` 不受影响）。

**w10n-config 仓库**（单独 worktree，不碰主 checkout 里未提交的审计改动）：

- `task-cnb-build.yaml`：一个 Task 内完成 clone 和构建，源码放 emptyDir（顺便验证去掉 RWX PVC 能省多少）。
  - step 镜像用 `heroku/builder:24`，执行 `/cnb/lifecycle/creator`：
    `-app=<repo>/enx-ui -cache-image=nexus.nexus.svc.cluster.local:8086/enx-ui-cnb-cache -insecure-registry=nexus.nexus.svc.cluster.local:8086 <image>`
  - `securityContext`：`runAsUser: 1000`、`runAsGroup: 1000`（CNB 用户）、`fsGroup` 保证 emptyDir 可写，**不加 privileged**。
  - registry 凭证：`CNB_REGISTRY_AUTH`，或把 `nexus-docker-cred` 挂到 `~/.docker/config.json`。
- `pipeline-build-enx-ui-cnb.yaml`：clone+build → `update-gitops`（复用现有 Task），`deploy` 参数默认 `"false"`。
- `pipelinerun-enx-ui-cnb.yaml`：手动触发用（不进 kustomization，与现有 pipelinerun 一致）。
- 镜像 tag 加后缀区分：`enx-ui:<sha>-cnb`，不覆盖 Kaniko 产出的 `enx-ui:<sha>`。

## 步骤

1. **本地预演**：`pack build enx-ui:cnb --builder heroku/builder:24 --path enx-ui`（本机有 Docker/Podman 时），先把第 1、5、8、9 项跑通，减少在集群里试错。
2. **集群构建，不部署**：`deploy=false` 跑 `build-enx-ui-cnb`，同一 commit 再跑一次现有 `build-enx-ui` 做对照。
3. **镜像检查**：
   - `SMOKE_IMAGE=docker-hosted.wiloon.com/enx-ui:<sha>-cnb enx-ui/scripts/smoke-runtime.sh`
   - 记录镜像大小，与 Kaniko 产出对比。
4. **测三种缓存场景的耗时**（每种至少两次）：
   - 冷构建（删掉 `enx-ui-cnb-cache`）；
   - 只改代码（lockfile 不变）；
   - 改 `pnpm-lock.yaml`。
5. **部署到 homelab**：`deploy=true` 跑一次，手动检查首页、登录、`/reader`、`/stats`、图片（sharp）、`/api/*` 代理。
6. **回滚**：再跑一次现有 `build-enx-ui`（或在 w10n-config revert gitops commit），ArgoCD 会换回 Kaniko 镜像。

## 判定标准

采用 CNB（进入 ADR-055），需要**全部**满足：

| 指标 | 门槛 |
|---|---|
| smoke-runtime.sh + 手动检查 | 全部通过 |
| 只改代码时的总耗时 | 不比现在的 5 分 19 秒慢；目标 ≤ 4 分钟 |
| 改 lockfile 时的总耗时 | ≤ 10 分钟 |
| 镜像大小 | ≤ 现在的 2 倍 |
| 权限 | 不需要 privileged，不挂 hostPath |
| 供应链设置 | 构建日志能证明 `minimumReleaseAge`、`allowBuilds` 生效 |
| 稳定性 | 连续 5 次构建无网络类失败（Node/pnpm 下载） |

任何一项不满足，就按原计划迁 BuildKit，本实验的 Tekton 文件删掉，`project.toml`/`Procfile` 不合入 main。

## 结果记录

2026-10-12，`heroku/builder:24`（lifecycle 0.21.22，heroku/nodejs 5.8.2），Task `cnb-build` 用 `kubectl apply` 直接部署、未进 kustomization。本机没有 Docker/Podman，跳过了本地预演。

| PipelineRun | commit | 结果 | 总耗时 | 说明 |
| --- | --- | --- | --- | --- |
| `build-enx-ui-cnb-2bpdz` | — | ❌ | — | Task 没写 namespace，建到了 default（其他 Task 由 kustomization 统一设 namespace） |
| `build-enx-ui-cnb-st49k` | `5ec2d7f` | ❌ | ~2 分钟 | `next build` 报 `Could not find the Next.js package`，见问题 1 |
| `build-enx-ui-cnb-br5sn` | `29bbe35` | ✅ | 5 分 26 秒 | 冷缓存 |
| `build-enx-ui-cnb-jb5w8` | `29bbe35` | ✅ | 3 分 02 秒 | 热缓存（同一 commit，`next build` 照样全量跑，等同于只改代码） |

对照：Kaniko `build-enx-ui-manual-ckr9d`（`aec923b`）5 分 19 秒，其中 update-gitops 约 30 秒，只算构建约 4 分 50 秒。

热缓存构建的耗时分布：

| 阶段 | 耗时 |
| --- | --- |
| clone（emptyDir，没有 PVC） | ~10s |
| 恢复缓存（pnpm store、Node） | 19s |
| `pnpm install`（store 命中，只建链接 + supply-chain 校验） | 45s |
| `next build`（编译 24s + tsc 17s） | 45s |
| 导出镜像 + 缓存（层大多复用） | 60s |

### 问题 1：Heroku 的 pnpm 虚拟 store 在项目外，Turbopack 不跟随

Heroku Node.js buildpack 把 pnpm 虚拟 store 放在 launch layer `/layers/heroku_nodejs/virtual`，位置用 `ModificationBehavior::Override` 写死（`src/package_managers/pnpm.rs`），`node_modules/*` 是指过去的符号链接。Turbopack（Next 16 默认）不解析项目根目录外的文件。同类问题见 pnpm #14972、next.js #93556。

处理：升级 Next 16.3.6 → 16.4.0（`a23af6e`），用 16.4 新增的 `experimental.turbopackAdditionalRoots` 声明这个目录，`ignoreIfMissing: true` 让本地开发和 Containerfile 构建不受影响（`29bbe35`）。本地 tsc、eslint、282 个单元测试、`next build`、`smoke-runtime.sh` 均通过。

### 镜像大小：565 MB，Kaniko 镜像 77 MB（压缩后，7.3 倍）

| 层 | 大小 | 来源 |
| --- | --- | --- |
| run image `heroku/heroku:24`（3 层） | 166 MB | Ubuntu 24.04；Kaniko 镜像用 `node:24-alpine` |
| `heroku/nodejs:virtual` | 201 MB | pnpm 虚拟 store（裁剪 devDependencies 后的生产依赖）。standalone 输出里已经带了追踪后的依赖，这一层在运行时是重复的 |
| app 层 | 97 MB | 项目目录全部内容：源码、`.next`（含 standalone 和其中复制的依赖） |
| `heroku/nodejs:dist` | 70 MB | Node.js 24.21.0 |
| `heroku/nodejs:pnpm` | 29 MB | pnpm 可执行文件，运行时用不到 |
| 其他（launcher、SBOM 等） | ~2 MB | |

即使把虚拟 store 和 pnpm 两层去掉（要和 buildpack 对着干），也有约 330 MB，仍是现在的 4 倍多。

### 对照判定标准

| 指标 | 门槛 | 结果 |
| --- | --- | --- |
| 只改代码时的总耗时 | ≤ 4 分钟 | ✅ 3 分 02 秒（只构建） |
| 镜像大小 | ≤ 现在的 2 倍 | ❌ 7.3 倍 |
| 权限 | 不需要 privileged，不挂 hostPath | ✅ uid 1000，无 privileged |
| 供应链设置 | `minimumReleaseAge`、`allowBuilds` 生效 | ✅ 日志有 `✓ Lockfile passes supply-chain policies`；只有白名单里的 `unrs-resolver` 跑了 postinstall |
| smoke-runtime.sh + 手动检查 | 全部通过 | 未做（镜像大小已不达标；本机没有容器运行时跑 smoke） |
| 改 lockfile 的耗时、连续 5 次稳定性 | | 未做 |

## 方案 2：自写 buildpack + glibc tiny run image

Heroku 方案体积不达标的原因：buildpack 决定哪些 layer 进镜像（launch 标记），Heroku 的 Node buildpack 按通用 Node 应用设计，把 pnpm 虚拟 store、pnpm、整个项目目录都放进镜像，run image 也只有完整的 Ubuntu 一种。方案 2 两头都换掉：

- **build image**：仍用 `heroku/builder:24`（Ubuntu 24.04），只借用它的构建环境和 lifecycle。
- **buildpack**：仓库里的 `enx-ui/cnb/nextjs-standalone`（`bin/detect` + `bin/build`，`d3dc045`、`50283bd`、`36b991b`）。完整 Node 和 pnpm 只放在构建期 layer；pnpm store 只做缓存；launch layer 只有 `node` 可执行文件；构建完应用目录里只留 standalone。`node_modules` 在项目内，不需要 `turbopackAdditionalRoots`。
- **run image**：`paketobuildpacks/ubuntu-noble-run-tiny`（Ubuntu 24.04，glibc，10.8 MB，有 `libstdc++`/`libssl`/`libz`，没有 shell，用户 1002:1001）。
- **Tekton**：`cnb-build` 新增参数 `BUILDPACK_PATH`，用 lifecycle 的 `-buildpacks`/`-order` 换掉 builder 自带的 buildpack；Pipeline 新增 `run-image`、`cache-image`、`buildpack-path` 参数（默认值仍是 Heroku 方案）。

| PipelineRun | commit | 结果 | 总耗时 | 说明 |
| --- | --- | --- | --- | --- |
| `build-enx-ui-cnb2-hkwhg` | `d3dc045` | ❌ | — | Corepack 装的 pnpm 12 启动器从 Nexus 取平台二进制时读不到 `integrity`；改成和 Containerfile 一样 `npm install -g` |
| `build-enx-ui-cnb2-tghpr` | `50283bd` | ✅ | 3 分 52 秒 | 冷缓存 |
| `build-enx-ui-cnb2-4cp8z` | `50283bd` | ✅ | 22 分钟 | 缓存命中判断有 bug（lifecycle 恢复的 layer TOML 带缩进），Node 重新下载并卡了 17 分钟（curl 没设超时） |
| `build-enx-ui-cnb2-rm8xw` | `36b991b` | ✅ | **3 分 04 秒** | 热缓存，修复后 Node、pnpm、runtime layer 全部复用 |

热缓存耗时分布：恢复缓存 6s，`pnpm install` 50s，`next build` 34s（编译 24s + tsc 16s），整理 standalone 3s，导出 70s。

镜像：**79.9 MB**（Kaniko 76.9 MB）。各层：run image 10.8 MB、`node` 52.4 MB、standalone 15.3 MB、launcher 1.4 MB。

运行验证（集群里的临时 pod，只给 smoke-runtime.sh 的假运行时变量）：`GET /` 200，运行时的 Clerk key 和扩展 ID 都在页面里；CSS、`/icon.svg`、`/apple-icon.png`、`/pricing` 都 200；`/api/*` 转发到运行时的 `API_BASE_URL`（假域名，`ENOTFOUND`，与 smoke 预期一致）。测试 pod 额外设了 `HOSTNAME=0.0.0.0`，因为 `kubectl port-forward` 连的是 localhost，Next standalone 默认只监听 `HOSTNAME`（K8s 里是 pod 名对应的 pod IP）；现在 homelab 里的 Kaniko 镜像也是这样，Service 走 pod IP 不受影响。

### 对照判定标准

| 指标 | 门槛 | 结果 |
| --- | --- | --- |
| 只改代码时的总耗时 | ≤ 4 分钟 | ✅ 3 分 04 秒（只构建） |
| 镜像大小 | ≤ 现在的 2 倍 | ✅ 1.04 倍 |
| 权限 | 不需要 privileged，不挂 hostPath | ✅ |
| 供应链设置 | 生效 | ✅ 同方案 1（pnpm 读同一个 `pnpm-workspace.yaml`） |
| smoke + 手动检查 | 全部通过 | 部分：上面的运行验证通过；未部署到 homelab 做登录、`/reader`、`/stats` 等手动检查 |
| 改 lockfile 的耗时、连续 5 次稳定性 | | 未做 |

### 代价

这个方案的 buildpack 是自己维护的：Node 下载、pnpm 安装、standalone 整理都写在 `bin/build` 里，本质上是把 Containerfile 的多阶段逻辑换成 buildpack 格式。调试中就遇到了 Containerfile 方案里不会有的问题：layer 缓存元数据的格式、Corepack 与 Nexus 的兼容性。Heroku 方案里"由 buildpack 维护者负责 Node 生态细节"的好处，在这里没有了。
