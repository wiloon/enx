package utils

import (
	"enx-server/utils/logger"
	"flag"
	"fmt"

	jww "github.com/spf13/jwalterweatherman"
	"github.com/spf13/viper"
)

func ViperInit() {
	jww.SetLogThreshold(jww.LevelTrace)
	jww.SetStdoutThreshold(jww.LevelTrace)

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
}
