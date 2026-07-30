//go:build integration

package dictionary

import (
	"errors"
	"testing"

	"enx-api/ecdict"
	"enx-api/utils"
	"enx-api/utils/logger"
	"enx-api/utils/sqlitex"

	"github.com/spf13/viper"
)

func TestMain(m *testing.M) {
	logger.Init("CONSOLE", "debug", "enx-api-test")
	utils.ViperInit()
	sqlitex.Init()
	ecdict.Init(viper.GetString("ecdict.db_path"))
	m.Run()
}

func TestLookupUnavailableWithoutEcdictConfig(t *testing.T) {
	ecdict.Init("")
	_, err := Lookup("not-in-local-db-xyz")
	if !errors.Is(err, ErrEcdictUnavailable) {
		t.Fatalf("expected ErrEcdictUnavailable, got %v", err)
	}
}
