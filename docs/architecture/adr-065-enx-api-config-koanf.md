---
status: accepted
date: 2026-10-20
related: issue #45（配置收进 enx-api/config，类型化 Config）、issue #46（本 ADR）
---

# ADR-065：enx-api 的配置加载从 viper 换成 koanf

#45 之后，viper 只在 `enx-api/config` 一个包里出现，其他包拿到的都是类型化的 `Config`。换加载库因此成了这个包内部的事，由 `config_test.go` 里那套测试兜底（每个绑定的环境变量都能填到自己的字段、未知键报错、`$USER` 不会遮住 `user.*`、列表按空白切分……）。

viper 在这里的代价是具体的：

- 依赖重：afero、cast、pflag、gotenv、locafero、fsnotify、yaml 都跟着进来，我们一个也不用；
- 键名强制小写：config.toml 里写成 `Port` 也会被悄悄当成 `port`；
- `AutomaticEnv()` 的坑已经踩过一次（`$USER` 遮住 `user.last-login-update-interval`），我们本来就只用显式绑定。

我们决定：**用 `knadh/koanf/v2` 加载配置，只引入 TOML 解析器和 confmap provider。来源和优先级不变：`defaults()` → 可选的 config.toml → `envBindings` 里列出的环境变量。解码仍走 `go-viper/mapstructure/v2`，结构体标签保持 `mapstructure`。**

## Decision

1. **三层都是普通 map，按顺序 `Load` 进同一个 koanf 实例。** 默认值是 `defaults()` 返回的扁平 map；环境变量由 `envValues()` 按 `envBindings` 逐个读取，没有任何自动的 `KEY_NAME → key.name` 映射。
2. **空环境变量等于没设**，与 viper 的默认行为一致（manifest 和 .env 模板里的空占位不覆盖默认值）。
3. **config.toml 的查找自己写**：不传 `-c` 时依次找 `/usr/local/etc/enx/config.toml`、`$HOME/.enx/config.toml`、`./config.toml`，第一个存在的胜出，`Config.File` 记绝对路径；都没有就只用默认值和环境变量。传了 `-c` 文件必须存在且能解析，内容一律按 TOML 解析。
4. **解码严格**：`ErrorUnused` 让未知键报错，`WeaklyTypedInput` 让环境变量的字符串能填进数字和布尔字段，decode hook 只有字符串转 `time.Duration` 和按空白切分列表两个。
5. **键名区分大小写**：config.toml 里 `Port` 不再等于 `port`，而是未知键，启动失败。这是唯一有意的行为变化，仓库自带的 config.toml 全是小写，生产和 homelab 不带配置文件。
6. depguard 规则改为只允许 `enx-api/config` 引用 `github.com/knadh/koanf`。

## Considered Options

- **留着 viper。** 能用，但上面的代价都在，而且 #45 已经把替换成本降到一个包。
- **`caarlos0/env`，只读环境变量。** 要先决定放弃 config.toml；本地开发（`task dev`、air、enx-chrome e2e）都靠它，不在本次范围。
- **koanf 的 file / env provider。** file provider 会带进 fsnotify（我们不需要热加载）；env provider 的前缀加转换函数表达不了 `KIMI_API_KEY → sentence-translate.kimi.api-key` 这种不规则映射。直接 `os.ReadFile` 加 TOML 解析器、confmap 装环境变量更短也更直白。

## Consequences

- go.mod 去掉 viper 及其 7 个间接依赖，新增 koanf 的 3 个直接依赖和 3 个间接依赖；构建图从 595 个包降到 576 个，二进制小约 0.8 MB（55.1 MB → 54.3 MB，`-tags nomsgpack`）。
- 已有配置测试全部原样通过；新增测试固定了空环境变量保留默认值、查找到的文件记绝对路径、大小写不同的键被拒绝。
