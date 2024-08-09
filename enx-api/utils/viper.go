package utils

import (
	"fmt"
	jww "github.com/spf13/jwalterweatherman"
	"github.com/spf13/viper"
)

func ViperInit() {
	jww.SetLogThreshold(jww.LevelTrace)
	jww.SetStdoutThreshold(jww.LevelTrace)

	viper.SetConfigName("config.toml")
	viper.AddConfigPath("/usr/local/etc/enx/")
	viper.AddConfigPath("$HOME/.enx")
	viper.AddConfigPath("C:\\workspace\\conf")
	viper.AddConfigPath(".")
	err := viper.ReadInConfig()
	if err != nil {
		panic(fmt.Errorf("fatal error config file: %w", err))
	}
}
