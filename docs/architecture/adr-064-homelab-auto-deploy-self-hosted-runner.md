---
status: proposed
date: 2026-10-19
related: adr-055（enx-ui 用 CNB 构建）、adr-056（enx-api 用 ko 构建）、adr-031（生产部署拓扑）
---

# ADR-064：main 合并后自动部署 homelab，用集群里的 GitHub Actions 自托管 runner 触发

现在 homelab 只能手动部署：在本机跑 `task deploy:homelab`，它调用 w10n-config 的 `tekton-deploy-enx`，比对集群正在运行的镜像 tag（就是 commit SHA）和 origin 上的目标 commit，不一致就创建 Tekton PipelineRun。PipelineRun 构建镜像，`update-gitops` 把新 tag 提交进 w10n-config，再由 ArgoCD 同步上线。ser8 上的 agent 已经在自动合并 PR（2026-10-19 起 `AUTO_MERGE=1`），合并之后 homelab 却要等人去部署。

我们决定：**enx 的 main 分支每次 push（也就是每次 PR 合并）后，触发一个 GitHub Actions workflow，在 homelab 集群里的自托管 runner 上运行。这个 runner 只做一件事：按现有的规则创建 PipelineRun，并等它跑完。构建、推镜像、改 GitOps、ArgoCD 同步这一整条链路都不变。**

难点在于：enx 是公开仓库。GitHub 不建议公开仓库使用自托管 runner，因为任何人都能 fork 仓库提 PR，并在 PR 里改写 workflow，让它跑在你的 runner 上（`pull_request` 事件执行的是 PR 里的 workflow 文件，不是 main 上的）。下面的「安全模型」一节说明怎么保证 runner 只执行 main 上的那一个 workflow。

## 现状要点（2026-10-19 核实）

- homelab 只能从内网访问：`tekton.wiloon.com` 在公网 DNS 上解析为 `192.168.50.101`，GitHub 的 webhook 打不进来。
- 集群已经装了 Tekton Triggers（controller、interceptors 都在运行），但没有任何 EventListener。
- 集群里还没有 actions-runner-controller。
- enx 的 fork PR 审批策略是默认值 `first_time_contributors`：只有首次贡献者的 PR 需要批准。
- w10n-config 是私有仓库，集群里的 Secret 都是手动 `kubectl create secret` 创建的，没有 sealed-secrets 之类的工具。

## Considered Options

- **A. 集群里放一个 CronJob，每 2–3 分钟轮询一次 main**：只有出站流量，完全不运行仓库里的代码，安全上最简单。代价是 1–3 分钟延迟，失败了也没有现成的通知渠道。没有选它，是因为想要合并后立即触发，并且让 commit 上直接显示部署结果（✅/❌）。如果 C 的维护成本太高，A 是退路。
- **B. Tekton Triggers EventListener + GitHub webhook**：秒级触发，组件已经装好。但要通过 Cloudflare Tunnel 之类的方式把 EventListener 暴露到公网，多一个入站入口要维护。否决。
- **C. 集群里的自托管 runner（选它）**：runner 主动连 GitHub 拉 job，只有出站流量，秒级触发。部署结果直接显示在 commit 和 Actions 页面上，失败时 GitHub 会发邮件。
- **GitHub 托管的 runner 远程调用集群**：需要把 k8s API 暴露到公网。否决。
- **在 runner 上直接构建镜像**：会和 Tekton 重复一套构建逻辑，runner 还得有构建权限。否决，runner 只负责触发。

## Decision

1. **workflow**：在 enx 新增 `.github/workflows/deploy-homelab.yml`，只由 `on: push: branches: [main]` 触发，`runs-on` 用一个专用 label（暂定 `homelab-deploy`）。设置 `concurrency: homelab-deploy`、`cancel-in-progress: false`：同一时间只部署一次。短时间内连着合并几个 PR 时，GitHub 只保留最新的那一个排队 run，相当于自动合并成一次部署。`permissions` 只给 `contents: read`。

2. **runner**：用 actions-runner-controller 的 runner scale set（`gha-runner-scale-set`），由 w10n-config 里的 ArgoCD Application 管理。
   - **注册在仓库级**，只服务 `wiloon/enx`。
   - **一次性（ephemeral）runner**：每个 job 新建一个 Pod，跑完就销毁。`minRunners: 0`、`maxRunners: 1`。
   - **认证用 GitHub App**：这个 App 只安装在 `wiloon/enx` 一个仓库上。凭据由用户手动创建成 Secret，不经过 AI，也不进 git。

3. **runner 不 checkout 代码，也不执行 workflow 文件里的逻辑**。workflow 里只有一个 step：调用部署脚本。脚本由 w10n-config 维护，以 ConfigMap 的形式挂进 runner Pod。部署规则仍然放在基础设施仓库里，enx 的 workflow 文件只是一个触发器。

4. **部署脚本的规则**（和 `tekton-deploy-enx` 一致，另外加一条按路径过滤）：
   - 读出 `enx-api`、`enx-ui` 两个 Deployment 正在运行的镜像 SHA；
   - 用 GitHub compare API（`GITHUB_TOKEN` 鉴权，不需要 checkout）判断这个 SHA 到 `GITHUB_SHA` 之间有没有改到 `enx-api/` 或 `enx-ui/`。没改到的服务跳过，比如只改了文档的合并，两个服务都不构建；
   - 如果正在运行的 SHA 不是 main 的祖先（比如之前手动部署过一个 feature 分支），就无论改了哪些路径都重新构建，让 homelab 回到 main；
   - 用和现在相同的 PipelineRun 模板创建 PipelineRun，等它结束，PipelineRun 失败则 job 失败。

5. **最小权限**：runner Pod 的 ServiceAccount 只有两项权限：在 `tekton-pipelines` 命名空间里创建和读取 PipelineRun，在 `enx` 命名空间里读取 Deployment。runner 所在的命名空间加 NetworkPolicy，出站只放行 DNS、k8s API 和访问 GitHub 必经的地址，不能访问内网其他地址。

6. **手动入口保留**：`task deploy:homelab REV=<分支>` 继续用来部署 feature 分支；Chrome 扩展照旧在本机构建（`chrome:build:homelab`），不进这条自动流程。

## 安全模型

目标：**fork PR 里的任何代码都不能在 runner 上执行。** 从内到外有四层：

1. **job-started hook（主防线）**。runner 的环境变量 `ACTIONS_RUNNER_HOOK_JOB_STARTED` 指向一个脚本，脚本同样以 ConfigMap 挂入。runner 接到 job 以后、执行任何 step 之前，会先跑这个脚本；脚本退出码非 0 时，job 不会运行，直接标记为失败（GitHub 官方文档的行为）。脚本只放行同时满足以下条件的 job：
   - `GITHUB_REPOSITORY` = `wiloon/enx`
   - `GITHUB_EVENT_NAME` = `push`
   - `GITHUB_REF` = `refs/heads/main`
   - `GITHUB_WORKFLOW_REF` = `wiloon/enx/.github/workflows/deploy-homelab.yml@refs/heads/main`

   这几个变量由 GitHub 服务端根据真实事件填写，workflow 里的 `env:` 不能覆盖 `GITHUB_` 开头的默认变量。fork PR 的事件是 `pull_request`、ref 是 `refs/pull/N/merge`，一定会被拒绝。能往 main 推代码的只有用户和 ser8 上的 agent，所以 main 上的 `deploy-homelab.yml` 一定是我们自己写的。

2. **一次性 runner + 最小权限 + NetworkPolicy**：就算第 1 层被绕过，Pod 跑完即销毁，没法留后门；能做的最多是创建一次 PipelineRun，而 PipelineRun 构建的仍然是 GitHub 上的 commit；Pod 也没法访问内网其他机器。

3. **fork PR 审批策略改为 `all_external_contributors`**：所有外部贡献者的 PR 都要用户手动批准，workflow 才会运行。这一层靠人，作为补充。

4. **专用 label**：enx 现有的 CI 都用 `ubuntu-latest`，正常的 PR 根本不会被调度到这个 runner。

第 1 层和第 2 层全部写在 w10n-config 里，由 ArgoCD 管理，不依赖手动配置。剩下的风险是 main 本身被污染（比如合进了一个恶意依赖），这一点和怎么触发部署无关。

## 上线步骤

| # | 谁做 | 内容 |
|---|------|------|
| 1 | 用户 | 创建 GitHub App（仓库权限：Administration 读写、Metadata 只读），只安装到 `wiloon/enx`；把 App ID、Installation ID、私钥手动创建成集群里的 Secret |
| 2 | AI | w10n-config：ARC controller 和 runner scale set 的 ArgoCD Application，hook 脚本和部署脚本的 ConfigMap，RBAC，NetworkPolicy |
| 3 | AI | enx：`deploy-homelab.yml` |
| 4 | AI | `gh api` 把 fork PR 审批策略改为 `all_external_contributors` |
| 5 | 用户 + AI | 按下面的「验证」逐条确认 |

## 验证

- **hook 拒绝非 main 的 job**：从 fork 或者临时分支提一个 PR，里面带一个 `runs-on: [self-hosted, homelab-deploy]` 的 workflow，并由用户批准运行。预期结果：job 在 "Set up runner" 这一步失败，日志里能看到 hook 的拒绝信息，PR 里的任何 step 都没有执行。验证完删掉这个分支。
- **只改文档的合并**：两个服务都跳过，job 成功。
- **只改 `enx-api/` 的合并**：只构建 enx-api；ArgoCD 同步之后，Deployment 的镜像 tag 等于这次合并的 SHA。
- **连续合并两个 PR**：只部署最后一个。
- **构建失败**：job 失败，commit 显示 ❌，用户收到 GitHub 的邮件。

## 待定问题

- **runner 怎么访问 GitHub**：w10n-config 的 `task-update-gitops` 提到过 homelab 通过 xray 访问 github.com。runner 的 listener 要和 GitHub 保持长连接，可能需要配 `HTTPS_PROXY`；具体要放行哪些地址，实现时实测确定。
- **手动部署的 feature 分支会被覆盖**：按 Decision 4，main 一有合并，homelab 就回到 main。如果用户正在 homelab 上测一个 feature 分支，同时 agent 合并了别的 PR，测试环境会被换掉。是接受这个行为，还是加一个"暂停自动部署"的开关（比如在集群里放一个 annotation 或 ConfigMap），待用户决定。
- **kubectl 从哪来**：官方 runner 镜像里没有 kubectl。可以用 initContainer 从固定版本的 `registry.k8s.io/kubectl` 镜像里复制，也可以自己构建一个 runner 镜像。倾向前者，不用多维护一个镜像。
