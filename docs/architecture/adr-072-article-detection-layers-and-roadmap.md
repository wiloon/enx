---
status: accepted
date: 2026-11-07
related: adr-034（正文只认 selector）、adr-070（站点清单与评估工具）、adr-071（adapter 未命中退回整页）、adr-073（用户手动指定正文）、adr-074（用阅读器打开）、adr-075（评估工具的站点清单与参照答案）
---

# ADR-072：正文识别分层，按固定顺序逐层尝试；新增「平台级 selector」一层；定下分阶段路线图

ADR-070 定了「主流英文站点的文章页，单击查词落在正确的正文节点上」这个目标，以及先量化再修改的做法。#702 的评估工具第一次全量运行（PR #706，81 页）之后，所有者和 Claude 讨论了接下来怎么补。本 ADR 记下讨论的结论：识别分哪几层、按什么顺序试，以及各层分几个阶段做。

## 决定 1：识别分层，按顺序逐层尝试

页面启用学习模式时，从上往下逐层尝试，第一层命中就停：

| 顺序 | 层 | 状态 | 命中时 | 未命中时 |
|---|---|---|---|---|
| 1 | 用户手动指定的正文（ADR-073） | 待做 | 用户选的节点是正文 | 往下 |
| 2 | 服务端下发的规则（#710） | 讨论中，位置待 #710 定 | 规则的 selector 是正文 | 往下 |
| 3 | 站点 adapter | 已有 | adapter 的 `contentSelector` 是正文 | `no-article-node`；设了 `wholePageOnMiss` 的退回整页（ADR-010、ADR-071，不变） |
| 4 | 平台级 selector（决定 2） | 待做 | 该平台的 selector 是正文 | 往下 |
| 5 | 内置 selector（`BUILT_IN_SELECTORS`） | 已有 | 选中的节点是正文 | 往下 |
| 6 | 更严格的启发式兜底（ADR-070 第二阶段） | 待做，另写 ADR | 启发式选中的节点是正文 | 往下 |
| 7 | 整页 | 已有 | 只能划词查词（ADR-034 修订） | — |

越靠上的层越具体、越可信：用户自己选的最准，站点 adapter 是为某个站点专门写的，平台级 selector 只在认出平台时才试，内置 selector 是对所有站点的猜测。

「用阅读器打开」（ADR-074）不在这张表里。它不在原页面上找正文，是另一条阅读路径，用户随时可以选。

**修的顺序和试的顺序不同。** ADR-070 决定 3 说的「先通用 selector，再站点 adapter」是改进时的先后：能用一条通用规则修好的，就不为单个站点写 adapter。页面运行时则是 adapter 先试，因为它更具体。

## 决定 2：平台级 selector = 平台信号 + selector

很多站点由同一个 CMS 或文档生成器产出，正文节点的类名相同：WordPress、Ghost、Substack、Blogger、Sphinx、Docusaurus、MkDocs Material，以及使用 microformats（`h-entry`）的个人站。一条平台规则能覆盖一整类站点。

一条平台规则包含两部分：

- **平台信号**：确认这页是该平台产出的，例如 `meta[name="generator"]` 的内容（`WordPress`、`Ghost`、`Docusaurus`、`Sphinx`、`MkDocs`），或者一个该平台特有的元素。
- **正文 selector**：只有在信号成立时才试。

初始候选（每条都要用评估工具量过才能加，见 ADR-070 决定 3）：

| 平台 | 信号（候选） | 正文 selector（候选） |
|---|---|---|
| WordPress | generator 含 `WordPress` | `.entry-content` |
| Ghost | generator 含 `Ghost` | `.gh-content` |
| Substack | Substack 特有元素 | `.available-content` |
| Blogger | generator 含 `Blogger` | `.post-body` |
| Sphinx（Python 文档等） | generator 含 `Sphinx` | `[role="main"]`、`div.body` |
| Docusaurus | generator 含 `Docusaurus` | `.theme-doc-markdown` |
| MkDocs Material | generator 含 `MkDocs` | `.md-content` |
| microformats | 页面有 `.h-entry` | `.h-entry .e-content` |

内置列表里现有的 `.entry-content`、`.post-body` 也可以挪进平台层，要看挪过去之后分数会不会变差。

**为什么要信号：** 不看信号直接匹配类名，会在不相干的站点上选错。例如内置的宽泛 selector `.content` 在 AWS 文档上选中了不是正文的节点（覆盖率 0，#709）。generator meta 读一次就能确认平台，代价很小。

**没选的方案：**

- **直接把这些类名加进 `BUILT_IN_SELECTORS`**：没有信号，和 `.content` 一样容易误中。
- **每个站点写一个 adapter**：WordPress、Ghost 上的站点成千上万，写不过来。

## 决定 3：分阶段路线图

| 阶段 | 内容 | 决定 | 依赖 |
|---|---|---|---|
| 已完成 | 评估工具、81 页站点清单、基线（#702）；Standard Ebooks adapter（#700） | ADR-070、ADR-071 | — |
| 1：修现有规则 | 修内置 selector（#709）；加平台级 selector 这一层；用流量排名扩充站点清单 | 本 ADR、ADR-075 | 评估工具 |
| 2：启发式兜底 + 更安全的单击 | 先接入人工标注评测集，用它定启发式的门槛；然后写第二阶段 ADR，再实现 | ADR-075；第二阶段 ADR 待写 | 阶段 1 的数据 |
| 3：用户能自己兜底 | 手动指定正文；选择可回传（用户同意时）；用阅读器打开 | ADR-073、ADR-074 | 不依赖阶段 2，可以并行 |
| 4：服务端下发规则 | 规则不随扩展发版，从 enx-api 下发 | #710 讨论后另写 ADR | 评估工具（发布前检查规则）、阶段 3 的回传（规则来源之一） |

阶段 3 不依赖评估数据，又直接给用户一条出路，所以可以和阶段 1、2 同时做。

## 后果

- 识别的层次和顺序有了一处定义；`docs/agents/article-detection.md` 在每一层落地时同步更新。
- 平台级 selector 要靠信号才生效：平台改了 generator 写法，规则会悄悄失效，要靠评估工具发现。
- 用户手动指定排在最前面，即使自动识别是对的，用户也能覆盖。代价是用户选错了也会生效，所以弹窗要能「恢复自动」（ADR-073）。
