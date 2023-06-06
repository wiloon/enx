package youdao

import (
	"enx-server/utils/logger"
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
