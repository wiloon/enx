# ADR-005: 查词弹窗垂直定位——优先显示在词上方，间距按行高动态计算

| 字段 | 值 |
| --- | --- |
| **状态** | Accepted — 2026-07-31 |
| **日期** | 2026-07-31 |
| **关联 Spec** | 无（本次为线上问题修复，未创建独立 Task Spec） |
| **关联 ADR** | [`adr-002-word-popup-react-shadow-dom.md`](adr-002-word-popup-react-shadow-dom.md)（弹窗必须继续用 CSS Anchor Positioning，不能退回手写定位算法，这是本决策的硬约束） |

---

## Context

用户反馈：点击网页正文中的单词弹出释义后，弹窗**底部边框会挡住被点击词所在行的上一行文字**（见反馈截图：弹窗覆盖了文章标题的最后一行）。

排查发现，`enx-chrome/src/content/content.tsx` 里的弹窗用 CSS Anchor Positioning 定位（`position-anchor` + `position-area: top` + 固定 `margin: 16px`）。被点击的单词是行内一个 `<span>`，它的 anchor 顶部就是该行文字的顶部；固定 16px 的间距在多数页面的行高（通常 20~28px）面前不够用，于是弹窗底边会切进上一行。

排查过程中还发现了一段**未被文档化的历史决策**：项目早期形态 `chrome-enx`（`enx-chrome` 重命名前的目录）的 commit `b889875`（"popout window position"）里，`calculateOptimalPosition()` 函数的注释明确写着：

> `// Smart vertical positioning - prioritize above for better reading experience`
> `// Prioritize showing above the word for better reading flow (top to bottom)`

也就是说，"弹窗优先显示在词的**上方**（而不是下方）"是有意识的设计决策，理由是：人类阅读从上到下，弹窗挡住下方会遮住**尚未读到**的句子，比挡住上方**已经读过**的内容对阅读体验的伤害更大。

这条理由在项目从手写 JS 定位算法迁移到 CSS Anchor Positioning（见 ADR-002）时**没有被记录下来**，只是隐含在 `position-area: top` 这一行 CSS 里。修这次 bug 时，曾一度把 `position-area` 直接改成 `bottom` 来"根治"遮挡问题——这个改法确实能消除遮挡（下方一般有更多空间），但违背了上面这条未文档化的阅读体验原则，属于在不知情的情况下推翻了一个已经验证过的设计决策。

---

## Options Considered

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| **A. 维持固定 margin（原状）** | `position-area: top` + 固定 `margin: 16px` | 改动量为零 | 间距与宿主页面实际行高无关，字号/行距稍大的页面就会切入上一行；这正是本次 bug 的成因 |
| **B. 改为默认显示在词下方** | `position-area: bottom` | 实现最简单，天然不会遮挡"上方"内容 | 违背 `chrome-enx` 时期已验证的阅读体验原则——挡住下方未读句子，打断阅读流；且这个原则没有文档记录，容易被后人（包括未来的我）无意中再次推翻 |
| **C.（采用）保持显示在上方，间距按锚点行高动态计算** | 保留 `position-area: top`；创建弹窗前读一次 `getComputedStyle(anchor).lineHeight`（`normal` 时退化为 `fontSize * 1.2`），以此作为 `margin-top`/`margin-bottom`，取代写死的 16px | 保留阅读体验原则；间距随宿主页面实际字号/行距自适应，不是针对某个页面调出来的魔法数字；仍然是声明式 CSS Anchor Positioning 定位，只多了一次 computed style 读取，不算"手写定位算法” | 只读了锚点元素自身的行高，不是真正测量"上一行"的实际几何位置；极少数上下文行高差异很大的页面（如紧邻标题/图片）间距仍可能不够精确 |
| **D. JS 精确测量上一行的位置** | 用 `Range`/`getClientRects()` 等 API 找到锚点所在行前一行的实际底边，据此计算精确偏移 | 理论上最精确 | 直接违反 ADR-002 "不能倒退成需要手写定位算法" 的约束；实现复杂度和脆弱性（各种宿主页面 DOM 结构不可控）都明显更高，收益不成比例 |

---

## Decision

**选择方案 C**：`enx-chrome/src/content/content.tsx` 的 `showWordPopup()` 保持 `position-area: top`（弹窗优先显示在被点击单词的上方），但不再使用固定 `margin: 16px`，改为：

```ts
const anchorStyle = window.getComputedStyle(anchor)
let anchorLineHeight = parseFloat(anchorStyle.lineHeight)
if (Number.isNaN(anchorLineHeight)) {
  anchorLineHeight = parseFloat(anchorStyle.fontSize) * 1.2
}
const verticalMargin = Math.ceil(anchorLineHeight)
```

`verticalMargin` 同时用作 `margin-top` 与 `margin-bottom`（水平方向仍固定 16px），这样无论 `position-try-fallbacks: flip-block` 把弹窗翻转到上方还是下方，间距都足够跳过锚点所在行相邻的完整一行文字。

---

## Rationale

1. **阅读体验原则是有历史依据的既定决策，不是随手写的默认值**：`chrome-enx` 时期已经做过这个权衡（挡上方 vs 挡下方）并选择了"优先上方"，本次修复应该修间距计算方式，而不是推翻方向。
2. **固定像素间距在"任意第三方网页"这个场景下天然不可靠**：弹窗要适配的是别人的网站，字号、行高完全不可控，间距理应从宿主页面的实际样式派生，而不是一个针对某次测试页面调出来的常量。
3. **不违反 ADR-002 的定位模型约束**：仍然是 `position-anchor`/`position-area`/`position-try-fallbacks` 声明式定位，视口边缘的翻转逻辑完全交给浏览器；新增的只是一次性的 `getComputedStyle` 读取，不是逐帧或逐像素的手写坐标计算。

---

## Consequences

### Positive

- 弹窗遮挡上一行文字的问题在任意字号/行距的页面上都能得到通用性的缓解，而不是针对某个页面调参数。
- "优先显示在上方"这条阅读体验原则第一次被写进本仓库的架构文档，后续改动前会先看到这份 ADR，不会再无意中改成默认显示在下方。

### Negative

- `verticalMargin` 只读了锚点自身的 `line-height`，不是真正测量"上一行"的几何边界；如果被点击的词紧邻一个行高明显不同的相邻块（例如标题、图片说明），间距仍可能不够精确。

### Mitigation

- 如果后续在真实页面上仍能复现遮挡问题，再考虑方案 D（精确测量上一行位置），或探索 CSS `anchor()` 函数配合 `calc()` 的声明式写法作为折中。
- 任何想把默认方向从"上方"改成"下方"的改动，都应该先回来看这份 ADR，并给出新的阅读体验论证，而不是当作一次孤立的 bug 修复顺手改掉。

---

## Revisit Trigger

- 真实用户反馈里出现"间距仍不够，遮挡上一行"的案例（说明动态行高近似不够精确）。
- 需要支持横向阅读（如竖排文字、RTL 语言）等场景，"上方优先"这条假设本身需要重新评估。
- CSS Anchor Positioning 规范新增了基于 `anchor-size()`/`anchor()` 的更精确的相邻行测量能力，届时可以用声明式写法替代当前的 JS 行高读取。
