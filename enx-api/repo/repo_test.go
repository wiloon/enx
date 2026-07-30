//go:build integration
// +build integration

package repo

import (
	"enx-api/utils"
	"enx-api/utils/sqlitex"
	"fmt"
	"testing"
)

func Test0(t *testing.T) {
	// GetWordByEnglish("foo")
	// GetUserWordQueryCount(1, 1)
	// Translate("foo")
	utils.ViperInit()
	sqlitex.Init()
	fmt.Println("db initialized")
}
