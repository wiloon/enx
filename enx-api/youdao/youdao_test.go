package youdao

import (
	log "github.com/wiloon/pingd-log/logconfig/zaplog"
	"testing"
)

func init() {
	log.Init()
}
func TestQuery0(t *testing.T) {

	Query("decentralized")

}
func TestQuery1(t *testing.T) {

	Query("a little")
}
