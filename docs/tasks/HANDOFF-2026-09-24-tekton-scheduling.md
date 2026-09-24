# 交接文档:Homelab Tekton CI/CD 排障 + 调度架构讨论(2026-09-24)

本文档是临时交接笔记,给重启电脑后接手的 agent 用。**主线部署问题已经解决**,还剩一个本机网络故障排查(阻塞了一个非关键的验证步骤)和一项尚未实施的架构改进讨论。

## 1. 已完成:两次 CI/CD 失败都已修复,homelab 已对齐 main

触发原因:用户跑了一次 `task deploy:homelab`(同时构建 enx-api + enx-ui),两条 Tekton PipelineRun 都失败了。

### enx-api:`build-enx-api-xsbfk` 失败 → 已重跑修复

- 根因:`update-gitops` 这个 task 里 `git clone git@github.com:wiloon/w10n-config.git` 超时(`context deadline exceeded`,该 step 5 分钟超时),`fetch-source`/`build-image` 都成功了,镜像已建好推送,只是 gitops 仓库没更新成功。判断是当时到 GitHub 的网络抖动,非持续性故障。
- 处理:重跑 `task deploy:homelab:api`(单独跑,没有并发),新 PipelineRun `build-enx-api-c59w5` 三个 task 全部成功。
- 结果:`w10n-config` origin/main commit `54b30b1`(`deployment.yaml` → `enx-api:bb3840f...`),ArgoCD 已同步,`enx-api` Deployment 已 rollout 完成,Pod Running。

### enx-ui:两次历史失败 + 一次新失败 → 已重跑修复

- `build-enx-ui-manual-954q4`(昨天):`build-image` 失败,kaniko 拉 `node:22-alpine` 基础镜像时 `docker-registry.wiloon.com` 返回 503。同时有个 warning:推 kaniko layer cache 到 `nexus.nexus.svc.cluster.local:8086` 时 `connection refused`。判断是 Nexus/内网镜像服务当时的临时故障,之后 `zh9xt` 那次自己就跑成功了,现在测 registry 和 nexus 端口都正常(返回 401 而不是 503/拒绝连接),已自愈,不用管。
- `build-enx-ui-manual-htgrq`(昨天):`Cancelled`,没深查,大概率是被后面手动重跑覆盖/取消的,不重要。
- `build-enx-ui-manual-mb275`(今天,和上面 API 那次 `xsbfk` 是同一批 `task deploy:homelab` 触发的):**PipelineRunTimeout**(30分钟超时被取消)。根因见下面第 2 节的调度分析。
- 处理:**单独**(不与 api 并发)重跑 `task deploy:homelab:ui`,新 PipelineRun `build-enx-ui-manual-g7wzr` 三个 task 全部成功。
- 结果:`w10n-config` origin/main commit `279bc69`(`deployment-ui.yaml` → `enx-ui:bb3840f...`),ArgoCD 已同步,`enx-ui` Deployment 已 rollout 完成,Pod Running。

**当前状态:enx-api 和 enx-ui 都跑在 main 分支最新提交 `bb3840f3283867ba0991e9c29f156e0ebdaeb17c` 上,homelab 已完全对齐。这部分工作已经做完,不需要接手人再处理。**

## 2. 已查明:为什么 UI 那次会排不上节点(`mb275` 的 FailedScheduling 分析)

`kubectl get events` 显示 `build-enx-ui-manual-mb275-build-image-pod` 卡在 `Pending` 整整 30 分钟,报错:

```
0/7 nodes are available: 1 Insufficient cpu, 1 node(s) didn't match Pod's node affinity/selector,
2 node(s) didn't match pod affinity rules, 3 node(s) had untolerated taint(s)
```

结论(已和用户逐层讨论确认):

- 集群 7 个节点里 3 个是 control-plane(`k8s-38`/`k8s-51`/`k8s-67`),默认打了 `node-role.kubernetes.io/control-plane` taint,CI Pod 没配 toleration,只能用剩下 4 台 worker(`k8s-21`/`k8s-39`/`k8s-50`/`k8s-71`)。
- **不是 API 和 UI 共用同一个 PVC**——每条 PipelineRun 通过 `volumeClaimTemplate` 各自动态现造一个全新的 `source-code` PVC(在 `w10n-config/infra/homelab/k8s/tekton/pipelinerun-enx-ui.yaml` 里确认过),互不相干。
- 但 `source-code` workspace 背后的 StorageClass 是**本地盘 provisioner**(注释写的"single local replica"),卷一旦建好就物理焊在某一台节点上(PV 带 `nodeAffinity`)。加上 Tekton 的 Affinity Assistant(PipelineRun 的 `provenance.featureFlags.coschedule = "workspaces"`)强制同一条 PipelineRun 里共享这个 workspace 的 task(`fetch-source`、`build-image`)必须同节点。
- 结果:**每条 PipelineRun 各自独立地被钉死在一个节点上,而且两条 PipelineRun 之间完全不协调**。UI 这次(`mb275`)的 `fetch-source` 被钉在了 `k8s-71`(有 event 证据:`Successfully assigned ... build-enx-ui-manual-mb275-fetch-source-pod to k8s-71`),后面 `build-image` 想在 `k8s-71` 上跑但资源不够,又没法溢出到其他 3 台空闲节点上,只能一直 Pending 直到 pipeline 级 30 分钟超时被取消。
- **验证已完成(2026-09-24 重启后)**:kubectl 连接恢复后查了 `build-enx-api-xsbfk-fetch-source-pod` 和 `build-enx-api-xsbfk-build-image-pod` 的 `spec.nodeName`,两个都落在 **`k8s-50`**,不是 `k8s-71`。结论:API 和 UI 这两条 PipelineRun **没有真撞在同一台节点上**——UI 卡在 `k8s-71` 排不上,是它自己选中的那台节点当时资源紧张(不排除是 API 抢了 `k8s-50` 之后,调度器把 UI 分到了另一台更紧张的节点),不是两边抢同一台机器。这进一步支持第 3 节的根治方向:问题根源是"每条 PipelineRun 被人为收窄到单节点调度"这个机制本身,资源紧张时就容易卡死,不需要两条 pipeline 真的选中同一台节点才会触发。

## 3. 讨论中、尚未实施的架构改进

跟用户讨论了一个可能的根治方案,**还没有动手改任何 YAML**:

**思路**:把 `fetch-source` 和 `build-image` 合并成同一个 Tekton Task 里的多个 Step(同一个 Pod 内的多个 container),而不是现在这样拆成两个独立 Task(两个独立 Pod)靠一个共享 PVC workspace 传文件。这样 `source-code` workspace 就不再需要跨 Pod 共享,不用 PVC,也就不会触发 Affinity Assistant 把 PipelineRun 钉死在一个节点上,四台 worker 都能自由调度。

**已确认的点**:
- 现在这个 `source-code` PVC 是每次运行动态现造(`volumeClaimTemplate`),**不存在跨批次(不同次触发之间)的文件复用**,合并方案不会损失这块。
- 真正跨批次复用的是 kaniko 自己的 layer 缓存(`--cache=true --cache-ttl=336h`,推到 `nexus.nexus.svc.cluster.local:8086/enx-*-cache`),这是完全独立的 registry 机制,和 workspace PVC 无关,合并方案不影响它。

**指出的代价/风险,接手人如果要动手实施需要考虑**:
1. `fetch-source` 大概率是 `build-enx-api`、`build-enx-api-java`、`build-enx-ui` 三条 Pipeline 共用的通用 Task(workspace 命名规律像),合并后 clone 逻辑要在每条 Pipeline 里各自重复一份,以后改 clone 逻辑要改三处。
2. 排障时的可见性变粗——现在能直接从 taskrun 列表一眼看出是 clone 挂了还是 build 挂了,合并后要看 Task 内的 step 级状态。
3. **理论上** Tekton 的 `coschedule: "workspaces"` 应该是"只对被 ≥2 个 Task 共享的 PVC workspace 才建 Affinity Assistant",`gitops-code`(只有 `update-gitops` 一个 Task 用)本来就不该触发。这个理论**没有在这个 Tekton 版本上实测验证过**——改完之后必须手动同时触发 api+ui 两条 pipeline,看 `kubectl get events` 里还有没有 `FailedScheduling`/`PodAffinityOverwrite`,不能只信文档。
4. 合并后 Task 内部的文件系统(git clone 出来的代码 + `node_modules` + `.next` 构建产物 + kaniko 快照)会用 Tekton 默认的 `emptyDir`,本质还是落节点本地盘,但计入节点的 `ephemeral-storage` 配额而不是独立 PVC 配额,建议显式设 `sizeLimit` 并确认节点本地盘余量够用,否则可能从"调度失败"变成新的"Pod 因 ephemeral-storage 超限被 Evicted"故障模式。
5. 这个改动只是消除"人为把 4 台节点收窄成 1 台"的假性资源紧张,**不解决集群真实总容量紧张**的问题——建议继续保留"别同时并发触发 api+ui 构建"这个操作习惯作为补充,不是二选一。

**下一步(如果用户要继续推进)**:改 `w10n-config` 里 `infra/homelab/k8s/tekton/` 下 `build-enx-ui`(以及 `build-enx-api`、`build-enx-api-java`,如果一起改的话)对应的 Pipeline/Task 定义,把 `fetch-source` 的 clone 逻辑内联成 `build-image` Task 的第一个 Step。改完按上面第 3 点验证。

## 4. 已解决:本机(这台 Mac)到 homelab 集群的 kubectl 连接故障

**2026-09-24 重启后已确认恢复**:`kubectl get nodes` 正常返回 7 个节点,连接故障消失。此前"当前假设(未验证):需要一次完整重启"这条已验证为真——重启解决了问题,印证了 Cisco AnyConnect Socket Filter Extension 残留内核态过滤状态的假设。不需要再往下查 `scutil --nc list` / 代理设置 / MDM 描述文件那几条。

这是纯本机网络问题,**和上面两节的实际工作无关**,只是恰好阻塞了第 2 节里"确认 API 落在哪个节点"这个非关键验证(该验证已在恢复后完成,见第 2 节)。

**现象**:
- `kubectl get nodes` / `curl https://192.168.50.100:6443/` 稳定复现:**立即失败(0ms)**,报 `no route to host`(curl 显示 `Immediate connect fail`)。
- 但 `ping 192.168.50.100` 和 `nc -zv 192.168.50.100 6443`(纯 TCP connect,不含 TLS)**一直连得上**,连续测多次都成功。
- 用户反馈浏览器访问 Grafana 是通的——集群本身健康,问题局限在这台机器上、且只影响特定进程(`kubectl`/`curl`,不影响 `nc`/`ping`)。

**已排除的原因**:
- macOS 应用防火墙:确认是关闭状态(`Firewall is disabled. (State = 0)`)。
- 路由表:`192.168.50.100` 走 `en0`,是正常的 host route,没有异常。
- 显式 `curl --interface en0` 绑定接口:结果和不绑定完全一样,不是接口选择的问题。
- 重启 WireGuard:没用,现象完全没变。

**已发现但没解决的线索**:
- `systemextensionsctl list` 一开始发现一个卡在异常状态的网络扩展:`com.cisco.anyconnect.macos.acsockext`(Cisco AnyConnect Socket Filter Extension),状态是 `[activated waiting for user]`(不是正常激活状态)。这类扩展工作原理是在内核态的 socket 层逐个拦截/放行 `connect()` 调用,能解释"某些进程能连、某些不能连、且是 0ms 立即失败"这种精确复现的症状。
- 用户已经在系统设置里把这个扩展删除了(`systemextensionsctl list` 确认变成 `0 extension(s)`),**但删除后现象完全没变**,说明要么不是它导致的,要么是它在内核网络栈里注册的过滤状态没有随删除立刻清空(这类扩展常见的坑是要重启才能彻底释放内核态钩子)。

**当前假设(未验证)**:需要一次完整重启,把可能残留的内核态过滤状态彻底清掉。这就是用户现在要重启电脑的原因。

**接手人重启后的下一步**:
1. 先跑 `kubectl get nodes` 验证是否恢复。
2. **如果恢复了**:回到第 2 节,尝试查一下 API 那次(`build-enx-api-xsbfk`)的 `build-image` 落在哪个节点(`kubectl get events -n tekton-pipelines | grep xsbfk` 或者直接查 pod 的 `spec.nodeName`,如果 pod 还没被 GC 的话)。这只是锦上添花,查不到也不影响什么。
3. **如果没恢复**:说明重启也没解决,Cisco AnyConnect 扩展的假设是错的,需要往下查:
   - `scutil --nc list` 看有没有其他配置好的 VPN profile。
   - 系统设置 → 网络 → Wi-Fi/以太网 → 详细信息 → 代理,看是不是配了 HTTP/HTTPS/SOCKS 代理(尤其是残留的公司代理配置)。
   - `profiles list`(可能需要 sudo)看有没有 MDM 配置描述文件里配了 per-app VPN / 内容过滤规则。
   - 这台机器是否有多个网卡/多路由(`ifconfig` 显示了不少接口:`en0`~`en4`、`bridge0`、多个 `utun`),怀疑是否有路由冲突,但目前看 `route -n get` 解出来的路径是正常的 `en0`,优先级应该没问题。

这部分和 CI/CD 修复本身无关,是次要的排障分支,不着急,处理不完也不影响用户当前的工作(enx-api/enx-ui 已经部署成功)。
