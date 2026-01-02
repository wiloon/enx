package utils

import (
	"enx-api/utils/logger"
	"flag"
	"fmt"

	"github.com/joho/godotenv"
	jww "github.com/spf13/jwalterweatherman"
	"github.com/spf13/viper"
)

func ViperInit() {
	jww.SetLogThreshold(jww.LevelTrace)
	jww.SetStdoutThreshold(jww.LevelTrace)

	// Load .env file if exists (before flag parsing)
	if err := godotenv.Load(); err == nil {
		logger.Infof("📝 Loaded .env file")
	}

	// Add command-line flag for config file
	configFile := flag.String("c", "", "config file path (e.g., config-e2e.toml)")
	flag.Parse()

	if *configFile != "" {
		// Use specified config file
		viper.SetConfigFile(*configFile)
		logger.Infof("using specified config file: %s", *configFile)
	} else {
		// Use default config search paths
		viper.SetConfigName("config")
		viper.SetConfigType("toml")
		viper.AddConfigPath("/usr/local/etc/enx/")
		viper.AddConfigPath("$HOME/.enx")
		viper.AddConfigPath("C:\\workspace\\conf")
		viper.AddConfigPath(".")

		logger.Infof("viper config paths: /usr/local/etc/enx/, $HOME/.enx, C:\\workspace\\conf, .")
		logger.Infof("viper config name: config.toml")
	}

	err := viper.ReadInConfig()
	if err != nil {
		logger.Errorf("failed to read config file: %v", err)
		panic(fmt.Errorf("fatal error config file: %w", err))
	} else {
		logger.Infof("read config file success, used: %s", viper.ConfigFileUsed())
	}

	// Enable automatic environment variable reading
	viper.AutomaticEnv()

	// Override with environment variables if set
	// ENX_PORT will override enx.port from config.toml
	if port := viper.GetInt("ENX_PORT"); port > 0 {
		viper.Set("enx.port", port)
		logger.Infof("✅ Port overridden by environment variable ENX_PORT: %d", port)
	}
}
