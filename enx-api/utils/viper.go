package utils

import (
	"enx-api/utils/logger"
	"flag"
	"strings"

	"github.com/joho/godotenv"
	jww "github.com/spf13/jwalterweatherman"
	"github.com/spf13/viper"
)

func ViperInit() {
	jww.SetLogThreshold(jww.LevelTrace)
	jww.SetStdoutThreshold(jww.LevelTrace)

	// Set defaults so the app works without any config file
	viper.SetDefault("enx.port", 8091)
	viper.SetDefault("enx.dev-mode", false)
	viper.SetDefault("youdao.url", "https://openapi.youdao.com/api")

	// Bind each config key to an explicit environment variable
	_ = viper.BindEnv("enx.port", "ENX_PORT")
	_ = viper.BindEnv("enx.dev-mode", "ENX_DEV_MODE")
	_ = viper.BindEnv("mysql.address", "MYSQL_ADDRESS")
	_ = viper.BindEnv("mysql.user", "MYSQL_USER")
	_ = viper.BindEnv("mysql.password", "MYSQL_PASSWORD")
	_ = viper.BindEnv("redis.address", "REDIS_ADDRESS")
	_ = viper.BindEnv("youdao.url", "YOUDAO_URL")
	_ = viper.BindEnv("youdao.app-key", "YOUDAO_APP_KEY")
	_ = viper.BindEnv("youdao.app-secret", "YOUDAO_APP_SECRET")

	// Also support automatic env var lookup (e.g. ENX_PORT for enx.port)
	viper.SetEnvKeyReplacer(strings.NewReplacer(".", "_", "-", "_"))
	viper.AutomaticEnv()

	// Load .env file if present (useful for local development)
	if err := godotenv.Load(); err == nil {
		logger.Infof("loaded .env file")
	}

	// Optionally load a TOML config file — not required in k8s
	configFile := flag.String("c", "", "config file path (e.g., config-e2e.toml)")
	flag.Parse()

	if *configFile != "" {
		viper.SetConfigFile(*configFile)
		if err := viper.ReadInConfig(); err != nil {
			logger.Errorf("failed to read config file %s: %v", *configFile, err)
		} else {
			logger.Infof("loaded config file: %s", viper.ConfigFileUsed())
		}
	} else {
		viper.SetConfigName("config")
		viper.SetConfigType("toml")
		viper.AddConfigPath("/usr/local/etc/enx/")
		viper.AddConfigPath("$HOME/.enx")
		viper.AddConfigPath(".")

		if err := viper.ReadInConfig(); err != nil {
			logger.Infof("no config file found, using environment variables and defaults")
		} else {
			logger.Infof("loaded config file: %s", viper.ConfigFileUsed())
		}
	}
}
