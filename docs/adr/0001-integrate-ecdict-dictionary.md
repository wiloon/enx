# ADR-0001: 集成ECDICT开源词典替换有道翻译API

## Status

Accepted

## Context

当前词典项目(enx)使用有道翻译API进行单词查询，存在以下问题：

1. **功能限制**: 有道只提供基础翻译API，不提供词典API，缺少词性、词频、考试标签等词典特性
2. **网络依赖**: 每次查词都需要网络请求，延迟200-500ms，且无法离线使用
3. **API限制**: 有API调用频率限制，大规模使用需要付费
4. **数据不可控**: 依赖第三方服务，服务稳定性不可控

[ECDICT](https://github.com/skywind3000/ECDICT) 是一个开源的英汉词典数据库：

- 180,000+ 词条
- 包含音标、词性、柯林斯星级、牛津3000词标记、考试标签（四六级等）
- 支持词形变化（时态、复数等，`exchange` 字段）
- SQLite格式，支持离线查询，延迟<50ms
- 完全免费开源

## Decision

将第三方词典查询从有道API切换到ECDICT：

1. **部署方式**:
   - ECDICT数据库文件独立于应用镜像，避免镜像过大(~500MB)
   - 本地开发：直接读取本地文件，通过环境变量 `ECDICT_DB_PATH` 指定路径
   - 生产部署(homelab)：通过 Volume 挂载数据库文件
2. **查询策略（本地 `words` 表与 ECDICT 一致）**:
   - 先 **精确匹配** `english` / `word`
   - 未命中再 **忽略大小写** 匹配
   - ECDICT 额外通过 `sw`（strip-word）与 `exchange` 字段做 **词形变化** 回查
3. **数据存储**: ECDICT 查询结果保存到现有 `words` 表，不修改现有表结构
4. **有道集成**: 完全移除（代码、配置、`youdao` 表迁移、mock 端点）；Chrome 扩展内「打开有道网页」外链保留，不属于 API 依赖
5. **句子翻译**: 暂不提供；请求含空格时 HTTP 200，在 `Chinese` 字段返回固定提示文案（功能暂未开放，将在未来版本提供）
6. **ECDICT 未配置或无法打开**: 需要走 ECDICT 的查词请求返回 **HTTP 503**，JSON 含 `success: false` 与 `message`，不得静默返回空释义
7. **词形变化**: 必须实现（通过 ECDICT `exchange` / `sw` 回查），与精确/忽略大小写查询同属词典查询能力

## Alternatives Considered

### 方案A: 继续使用有道API

- 优点: 无需改动
- 缺点: 功能受限、网络依赖、API限制
- 结论: 不满足需求

### 方案B: ECDICT独立服务

- 优点: 可被多个服务共享、易于独立更新
- 缺点: 增加部署复杂度、网络延迟
- 结论: 对于单用户桌面应用过度设计

### 方案C: 保留有道作为fallback

- 优点: 某些专业词汇可能查不到时有兜底
- 缺点: 增加代码复杂度、仍需维护有道API配置
- 结论: 不需要，ECDICT词条已足够丰富(180,000+)

## Consequences

### Positive

- 查词延迟从200-500ms降至<50ms
- 支持离线查词（配置 ECDICT 后）
- 无API调用限制
- 获得更丰富的词典信息（词频、考试标签等，可逐步暴露给前端）
- 节省API费用
- 移除第三方 API 依赖，代码更简洁

### Negative

- 应用内存占用增加约50MB
- 部署 homelab 时需挂载 ECDICT 数据库文件
- 需要定期更新 ECDICT 数据库
- 句子翻译需后续单独方案；当前仅返回明确提示

## Implementation

| 项 | 说明 |
|----|------|
| 模块 | `enx-api/ecdict/` — 初始化、只读打开、可用性检查、`Query`（精确→忽略大小写→sw→exchange） |
| 统一查词 | `enx-api/dictionary/` — 本地 `words` 回退 ECDICT，503 响应辅助函数 |
| 翻译 API | `enx-api/translate/service.go` — 句子提示、经 `dictionary.Lookup` 查词 |
| 本地词库 | `enx-api/repo/ecp.go` — `GetWordByEnglish` 精确后忽略大小写 |
| 配置 | `ECDICT_DB_PATH` / `[ecdict] db_path` |
| 路由 | `GET /ecdict`、`GET /api/ecdict`（原 `/third-party` 已移除） |
| 清理 | 删除 `youdao` 包、`sqlitex.Youdao` 迁移、`schema.sql` 中 `youdao` 表定义 |
| 文档 | `enx-api/TESTING.md`、`enx-chrome/E2E_TESTING.md` 等（见仓库，无需写入本 ADR 正文） |

### 验证（测试）

- 单元测试：`ecdict` 包（精确/忽略大小写/不可用状态）
- 集成测试：配置 `ECDICT_DB_PATH` 后查词；未配置时断言 503
- 测试说明维护在 `enx-api/TESTING.md`，不在此 ADR 重复步骤

## References

- [ECDICT](https://github.com/skywind3000/ECDICT)
