package youdao

import (
	"enx-api/utils"
	"enx-api/utils/logger"
	"enx-api/utils/sqlitex"
	"fmt"
	"github.com/spf13/viper"
	"testing"
)

func init() {
	logger.Init("CONSOLE", "debug", "rssx-api")
}
func TestQuery0(t *testing.T) {

	Query("decentralized")

}
func TestQuery1(t *testing.T) {

	Query("a little")
}

func TestQuery2(t *testing.T) {
	utils.ViperInit()
	sqlitex.Init()

	devMode := viper.GetBool("enx.dev-mode")
	fmt.Println("devMode:", devMode)
	r := Translate("test")
	fmt.Printf("r: %+v", r)
}
