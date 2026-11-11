//go:build integration

package adapters

import (
	"context"
	"reflect"
	"sort"
	"testing"

	"enx-api/utils/sqlitex"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func TestLookedUpWordsIncludesKnownButExcludesDeletedUnqueriedAndOtherUsers(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	old := sqlitex.DB
	sqlitex.DB = db
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		sqlitex.DB = old
		if err := sqlDB.Close(); err != nil {
			t.Error(err)
		}
	})
	if err := db.AutoMigrate(&sqlitex.Word{}, &sqlitex.UserDict{}); err != nil {
		t.Fatal(err)
	}
	deleted := int64(1)
	words := []sqlitex.Word{
		{Id: "w1", English: "Run"}, {Id: "w2", English: "hello"},
		{Id: "w3", English: "deleted", DeletedAt: &deleted},
		{Id: "w4", English: "unqueried"}, {Id: "w5", English: "other"},
	}
	if err := db.Create(&words).Error; err != nil {
		t.Fatal(err)
	}
	rows := []sqlitex.UserDict{
		{UserId: "u1", WordId: "w1", QueryCount: 1},
		{UserId: "u1", WordId: "w2", QueryCount: 2, Known: true},
		{UserId: "u1", WordId: "w3", QueryCount: 1},
		{UserId: "u1", WordId: "w4", QueryCount: 0},
		{UserId: "u2", WordId: "w5", QueryCount: 1},
	}
	if err := db.Create(&rows).Error; err != nil {
		t.Fatal(err)
	}
	got, err := (LookedUpWords{}).LookedUpWords(context.Background(), "u1")
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(got)
	if !reflect.DeepEqual(got, []string{"Run", "hello"}) {
		t.Fatalf("words %v, want [Run hello]", got)
	}
}
