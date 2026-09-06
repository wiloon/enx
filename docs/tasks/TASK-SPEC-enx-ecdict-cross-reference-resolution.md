# TASK-SPEC: ECDICT 拼写变体交叉引用解析（消除弹窗里的 `<主英>=X` 原始占位符）

| 字段 | 值 |
| --- | --- |
| **状态** | Draft — 2026-07-31（未开始实现） |
| **类型** | SDD Task Spec（Spec 驱动实现；实现前以本文为准，实现后同步更新状态与验收清单） |
| **目标** | 用户查询 `modernisation` 这类英式/美式拼写变体单词时，`enx-api` 返回的中文释义不应是 ECDICT 原始的交叉引用占位符（如 `n. <主英>=modernization`），而应解析出目标词条的真实中文释义并展示给用户 |
| **非目标** | 不重新生成/清洗 ECDICT 源数据文件本身（不做离线批处理改写 `stardict` 表）；不引入新的外部词典 API 作为兜底数据源（沿用 [ADR-0001](../adr/0001-integrate-ecdict-dictionary.md) 确定的"仅 ECDICT，无外部 API"策略）；不处理 `translation` 字段里其它类型的缩写标注（如 `<医>`、`<化>`学科标签），仅处理"跨词条重定向"这一类（形如 `<区域标签>=目标词` 或 `=目标词`） |
| **触发原因** | 用户反馈：查词弹窗里 `modernisation` 显示 `n. <主英>=modernization`，看起来"翻译很奇怪"——截图见对话记录。排查确认这是 ECDICT 对拼写变体词条的标准存储方式（不重复存释义，只存"见 XX"式引用），`enx-api`/`enx-chrome` 从未解析过这个引用，原样透传给了用户 |
| **关联背景** | [`docs/adr/0001-integrate-ecdict-dictionary.md`](../adr/0001-integrate-ecdict-dictionary.md)（ECDICT 选型 ADR，未提及此交叉引用问题，是本次排查中发现的未记录缺口） |
| **关联 ADR** | 无新增 ADR；本次是对已选定数据源（ECDICT）的一处解析缺口的补丁，不涉及架构级选型变更 |

---

## 1. 背景与动机

`enx-api` 用 ECDICT（一个开源英汉词典 SQLite 数据集）做单词查询的数据源（`enx-api/ecdict/ecdict.go`，见 ADR-0001）。ECDICT 对于纯拼写差异的词条（英式 vs 美式拼写、单复数的次要变体等）不会重复存一份完整释义，而是存一条"重定向"记录，例如：

```
word:        modernisation
phonetic:    ,mɔdənai'zeiʃən;-ni'z-
translation: n. <主英>=modernization
```

`<主英>=modernization` 的语义是"主要英式拼写；释义同 modernization"——真正的中文释义"现代化"存在 `modernization` 这个独立词条下，`modernisation` 词条本身并不包含它。

`enx-api/ecdict/ecdict.go:112-127` 的 `Query()` 拿到词条后直接把 `Translation` 字段原样塞进 `enx.Dictionary.Chinese` 返回，`enx-chrome/src/components/WordPopup.tsx:114-118` 又原样渲染到弹窗里——中间没有任何一层识别并解析这种重定向格式，用户看到的就是未加工的 ECDICT 内部标注，而不是"现代化"这个实际释义。

---

## 2. 现状调查

### 2.1 数据源

- ECDICT SQLite 数据库路径由 `ECDICT_DB_PATH` 环境变量 / `enx-api/config.toml` 的 `ecdict.db_path` 配置项提供，`enx-api/utils/viper.go:59-60` 读取。数据库文件本身不在仓库内，按 ADR-0001 单独部署。
- 表结构 `enx-api/ecdict/ecdict.go:25-31`（`stardict` 表）：`word` / `sw` / `phonetic` / `translation` / `exchange`。
- 已直接查询确认 `modernisation` 词条的 `translation` 字段原始值为 `n. <主英>=modernization`（`exchange` 字段为 `s:modernisations`，与本次问题无关）。这是 ECDICT 上游数据本身的格式，不是导入过程引入的损坏。

### 2.2 代码路径：从查询到渲染，全程原样透传

- `enx-api/ecdict/ecdict.go:131-168` `lookupEntry()`：exact → 大小写不敏感 → `sw` → `exchange` 四级回退查找,返回命中的 `stardict` 行。
- `enx-api/ecdict/ecdict.go:112-127` `Query()`：拿到 `lookupEntry` 结果后，直接用 `res.entry.Translation`（L121）构造 `enx.Dictionary.Chinese`,**没有对 `Translation` 内容做任何解析**。
- `enx-api/dictionary/lookup.go:19-24` `Lookup()`：仅做"ECDICT 是否可用"判断，透传 `ecdict.Query()` 的结果，同样不介入内容。
- `enx-chrome/src/components/WordPopup.tsx:114-118`：`{currentWord.Chinese}` 原样渲染，前端也没有任何解析/兜底逻辑。
- 全仓库搜索 `主英`、`crossRef`、`redirect`、`resolveRedirect` 均无命中——这是一个未被实现过的功能缺口，不是某处逻辑的 bug。

### 2.3 Youdao 链接不是数据源

`WordPopup.tsx:40-42, 132-139` 的"📚 Youdao"只是一个跳转到 `youdao.com/result?word=...` 网页的外部链接（新标签页打开），不参与任何数据获取。按 ADR-0001，有道 API 已被否决作为数据源，这里只是给用户提供的"手动去别处查一下"的便利入口，不在本次改动范围内。

### 2.4 影响面（数据层面的初步估计）

ECDICT 里采用 `<区域标签>=目标词` 或 `=目标词` 这种重定向格式的词条不止 `modernisation` 一例，常见于英式/美式拼写对（`colour`/`color`、`organisation`/`organization`、`analyse`/`analyze` 等）。具体受影响词条数量未做全量统计，不阻塞本次实现——解析逻辑是通用的正则匹配 + 二次查询，天然覆盖所有同形式条目，不需要为每个词单独处理。

---

## 3. 目标设计

### 3.1 策略：查询命中后，在 `ecdict.Query()` 内做一次有界的重定向解析

| 选项 | 说明 | 结论 |
| --- | --- | --- |
| **A. 后端解析**：在 `enx-api/ecdict/ecdict.go` 的 `Query()` 内识别 `Translation` 是否为重定向格式，命中则对目标词做一次额外的精确查询，用解析后的结果替换/拼接原始释义 | 解析逻辑离数据源最近，`enx-chrome`/`enx-ui`/未来任何客户端都直接受益，无需各端重复实现；额外查询限定为"仅精确匹配"，代价可控（不复用 `lookupEntry` 的 sw/exchange 模糊回退，避免二次查询本身再触发一次重定向链之外的意外匹配） | **本 Spec 采用** |
| B. 前端解析：在 `enx-chrome`/`enx-ui` 渲染层用正则识别并提示 | 需要每个客户端各实现一遍；前端拿不到"目标词的真实释义"，只能识别格式做提示性展示（如"这是拼写变体，请查 XX"），无法真正显示中文释义 | 不采用——达不到"显示正确释义"的目标 |
| C. 离线预处理：导入 ECDICT 时批量解析所有重定向词条，展开写回数据库 | 需要维护一条独立的数据导入/清洗流程，且原始 ECDICT 库更新后要重新跑；超出本次"修复查询返回值"的最小改动范围 | 列入 §9，不在本次做 |

### 3.2 识别格式

ECDICT `translation` 字段可能包含多行（不同词性各占一行，以 `\n` 分隔），重定向仅出现在单行内，格式为：

```
{词性前缀}{可选区域标签}={目标词}
```

例：
- `n. <主英>=modernization` → 词性前缀 `n. `，区域标签 `<主英>`，目标词 `modernization`
- `=color`（部分词条无词性前缀、无区域标签，纯重定向）
- `v. <美>=colorize`

用正则 `^([a-zA-Z]+\.\s*)?(<[^>]+>)?=(\S+)$` 逐行匹配（Go `regexp` 包语法一致，无需额外依赖）。

### 3.3 解析逻辑（`enx-api/ecdict/ecdict.go` 新增）

```go
var crossRefPattern = regexp.MustCompile(`^([a-zA-Z]+\.\s*)?(<[^>]+>)?=(\S+)$`)

const maxRedirectDepth = 2 // 防止目标词本身还是重定向词条时无限递归

// resolveTranslation expands ECDICT's cross-reference shorthand
// ("<主英>=modernization") into the target headword's real translation.
// Lines that don't match the shorthand are returned unchanged.
func resolveTranslation(ctx context.Context, dbc *gorm.DB, translation string, depth int) string {
	if depth >= maxRedirectDepth {
		return translation
	}
	lines := strings.Split(translation, "\n")
	for i, line := range lines {
		m := crossRefPattern.FindStringSubmatch(strings.TrimSpace(line))
		if m == nil {
			continue
		}
		posPrefix, regionTag, target := m[1], m[2], m[3]

		var targetEntry stardict
		if err := dbc.Where("word = ?", target).First(&targetEntry).Error; err != nil {
			if err := dbc.Where("LOWER(word) = LOWER(?)", target).First(&targetEntry).Error; err != nil {
				continue // 目标词也查不到，保留原始占位符
			}
		}

		resolved := resolveTranslation(ctx, dbc, targetEntry.Translation, depth+1)
		resolvedLine := pickMatchingPosLine(resolved, posPrefix)
		if regionTag != "" {
			resolvedLine = resolvedLine + " " + regionTag
		}
		lines[i] = resolvedLine
	}
	return strings.Join(lines, "\n")
}

// pickMatchingPosLine returns the target translation's line matching
// posPrefix (e.g. "n. ") if present, else the first line, else the
// full (possibly multi-line) translation as-is.
func pickMatchingPosLine(translation, posPrefix string) string {
	lines := strings.Split(translation, "\n")
	if posPrefix != "" {
		for _, l := range lines {
			if strings.HasPrefix(l, posPrefix) {
				return l
			}
		}
	}
	if len(lines) > 0 {
		return lines[0]
	}
	return translation
}
```

`Query()`（L112-127）在拿到 `res.entry` 后，改为：

```go
resolvedTranslation := resolveTranslation(ctx, db.WithContext(ctx), res.entry.Translation, 0)
return &enx.Dictionary{
	English:       res.entry.Word,
	Chinese:       resolvedTranslation,
	Pronunciation: res.entry.Phonetic,
}
```

**效果**：`modernisation` 最终返回 `Chinese: "n. 现代化 <主英>"`——用户能看到真实释义"现代化"，区域标签 `<主英>` 保留在末尾作为"这是英式拼写"的提示，不再是一个无法理解的占位符。

### 3.4 边界情况

- **目标词也查不到**：保留原始占位符不变（不静默丢弃信息），行为退化为当前状态，不引入新的空结果。
- **目标词本身还是重定向**（如 A→B→C 链）：`maxRedirectDepth=2` 允许最多两跳解析；超过后停止递归，返回当时已解析到的内容（可能仍含占位符）。ECDICT 实际数据中链式重定向极少见，2 跳已覆盖绝大多数场景。
- **无词性前缀的纯重定向**（`=color`）：`posPrefix` 为空，直接取目标词条第一行译文。
- **额外查询的超时预算**：复用 `Query()` 已有的 `queryTimeout`（3s）和外层 `ctx`，`resolveTranslation` 内的二次查询共享同一个 `ctx`，不单独开新的 timeout；`dbc` 已经是 `db.WithContext(ctx)`，超时会被 gorm 自然中断。

---

## 4. 验收标准

- [ ] 单测：`ecdict_test.go` 新增用例，构造一个"`modernisation` → `<主英>=modernization`"+"`modernization` → `n. 现代化`"的双词条测试库，断言 `Query(ctx, "modernisation")` 返回 `Chinese == "n. 现代化 <主英>"`
- [ ] 单测：目标词查不到时（重定向指向一个不存在的词），断言返回值保持原始 `Translation` 不变（不 panic、不返回空）
- [ ] 单测：无区域标签的纯重定向（`=color` 格式）能正确解析出目标词译文
- [ ] 单测：链式重定向（A→B→C，B 本身也是重定向）在 `maxRedirectDepth=2` 内能解析到 C 的真实译文；超过深度限制时不死循环、不 panic
- [ ] 回归：现有 `ecdict_test.go` 全部用例（`TestQueryExactThenCaseInsensitive` 等）在改动后仍全部通过——非重定向词条的 `Translation` 必须原样返回，不受新逻辑影响
- [ ] 手工验证：`enx-chrome` 查询 `modernisation`，弹窗显示解析后的中文释义（含 `<主英>` 标签），不再是原始 `=modernization` 占位符

---

## 5. 风险与约束

| 风险 | 缓解 |
| --- | --- |
| 正则误匹配非重定向的合法译文（如某词条译文恰好是 `= something` 字面意思，理论上极少见） | ECDICT 译文格式里 `=` 开头且紧跟单个词、无空格，是重定向的强特征，误判概率极低；若发现误判，可在 §9 后续补充更严格的词性前缀白名单校验 |
| 二次查询增加每次命中重定向词条时的数据库往返（额外一次 exact/CI 查询） | 仅在 `Translation` 命中重定向正则时才触发，绝大多数词条（无重定向）零额外开销；重定向词条本身占比不高，且额外查询是索引友好的精确匹配，不是全表扫描 |
| `resolveTranslation` 递归可能因数据异常（自引用 `modernisation`→`modernisation`）无限循环 | `maxRedirectDepth` 硬性限制递归深度为 2，不依赖"数据不会自引用"这个假设 |

---

## 6. 相关文件索引

| 文件 | 说明 |
| --- | --- |
| `enx-api/ecdict/ecdict.go` | 新增 `crossRefPattern` / `resolveTranslation()` / `pickMatchingPosLine()`；`Query()`（L112-127）接入解析逻辑 |
| `enx-api/ecdict/ecdict_test.go` | 新增 §4 全部单测用例，参照现有 `createTestDBWithSw` 等 helper 写法新增 `createTestDBWithCrossRef` |
| `enx-api/dictionary/lookup.go` | 无需改动，仅透传 `ecdict.Query()` 结果 |
| `enx-chrome/src/components/WordPopup.tsx` | 无需改动，`{currentWord.Chinese}` 直接受益于后端返回值的变化 |
| `docs/adr/0001-integrate-ecdict-dictionary.md` | 背景参考，无需改动 |

---

## 7. 实施顺序（建议）

```text
1. [ ] enx-api: ecdict.go 新增 crossRefPattern / resolveTranslation / pickMatchingPosLine
2. [ ] enx-api: Query() 接入 resolveTranslation，补 §4 全部单测
3. [ ] go test ./enx-api/ecdict/... 全量通过（含既有用例回归）
4. [ ] 手工验证：本地起 enx-api + enx-chrome，查询 modernisation 确认弹窗释义正确
5. [ ] 勾选 §4 全部验收项，文首状态更新为 Done — YYYY-MM-DD
```

---

## 8. SDD 工作方式（给 Agent / 开发者）

1. **实现前**：以本文 Spec 为唯一需求来源；§3.1 已明确选择"后端一次性解析"而非前端识别或离线预处理，不要在实现时改用其它方案。
2. **实现中**：解析逻辑只处理 §3.2 定义的"跨词条重定向"格式，不要顺手扩展到其它缩写标签（如学科标签 `<医>`、`<化>`）的处理——那不是本次问题的根因。
3. **实现后**：勾选 §4 验收清单；将文首**状态**更新为 `Done — YYYY-MM-DD`。

---

## 9. 后续扩展（Out of Scope，供未来 Spec 引用）

- 离线批处理：导入 ECDICT 时预先展开所有重定向词条并写回数据库，省去运行时的二次查询开销
- 更严格的重定向正则校验（词性前缀白名单），进一步降低误判概率
- 对 `<医>`、`<化>`等学科/领域缩写标签做中文全称映射，提升弹窗可读性（与本次的"跨词条重定向"是不同类别的问题）
