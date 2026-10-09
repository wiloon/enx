//go:build integration
// +build integration

package repo

import (
	"enx-api/config"
	"enx-api/utils/sqlitex"
	"fmt"
	"testing"
)

func Test0(t *testing.T) {
	// GetWordByEnglish("foo")
	// GetUserWordQueryCount(1, 1)
	// Translate("foo")
	cfg, err := config.Load("")
	if err != nil {
		t.Fatal(err)
	}
	sqlitex.Init(cfg.DB.Path)
	fmt.Println("db initialized")
}
