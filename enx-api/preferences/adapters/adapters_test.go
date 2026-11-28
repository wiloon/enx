package adapters

import (
	"context"
	"testing"

	"enx-api/preferences"
	"enx-api/utils/sqlitex"
	"enx-api/utils/sqlitex/sqlitextest"

	"gorm.io/gorm"
)

func TestTableSaveLoadClear(t *testing.T) {
	ctx := context.Background()
	tbl := NewTable(sqlitextest.Open(t))

	if got, err := tbl.Load(ctx, "u1"); err != nil || len(got) != 0 {
		t.Fatalf("empty Load = %v, %v", got, err)
	}
	if err := tbl.Save(ctx, "u1", preferences.AIWordFallback, true); err != nil {
		t.Fatal(err)
	}
	// Saving again overwrites rather than failing on the primary key.
	if err := tbl.Save(ctx, "u1", preferences.AIWordFallback, false); err != nil {
		t.Fatal(err)
	}
	if err := tbl.Save(ctx, "u2", preferences.AIWordFallback, true); err != nil {
		t.Fatal(err)
	}

	got, err := tbl.Load(ctx, "u1")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[preferences.AIWordFallback] != false {
		t.Fatalf("u1 Load = %v, want only an explicit false", got)
	}

	if err := tbl.Clear(ctx, "u1", preferences.AIWordFallback); err != nil {
		t.Fatal(err)
	}
	if got, _ := tbl.Load(ctx, "u1"); len(got) != 0 {
		t.Fatalf("Load after Clear = %v, want empty", got)
	}
	if got, _ := tbl.Load(ctx, "u2"); got[preferences.AIWordFallback] != true {
		t.Fatal("clearing u1 must not touch u2")
	}
	if err := tbl.Clear(ctx, "u1", preferences.AIWordFallback); err != nil {
		t.Fatalf("clearing a missing key: %v", err)
	}
}

func TestTableSavesAStringValue(t *testing.T) {
	ctx := context.Background()
	tbl := NewTable(sqlitextest.Open(t))

	if err := tbl.Save(ctx, "u1", preferences.ExplanationLanguage, "en"); err != nil {
		t.Fatal(err)
	}
	got, err := tbl.Load(ctx, "u1")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[preferences.ExplanationLanguage] != "en" {
		t.Fatalf("Load = %v, want explanationLanguage en", got)
	}
	if err := tbl.Clear(ctx, "u1", preferences.ExplanationLanguage); err != nil {
		t.Fatal(err)
	}
	if got, _ := tbl.Load(ctx, "u1"); len(got) != 0 {
		t.Fatalf("Load after Clear = %v, want empty", got)
	}
}

func TestTableLoadSkipsRowsThatAreNotJSON(t *testing.T) {
	db := sqlitextest.Open(t)
	for key, value := range map[string]string{"aiWordFallback": `yes`, "explanationLanguage": `"en"`} {
		if err := db.Create(&sqlitex.UserPreference{
			UserId: "u1", Key: key, Value: value, UpdatedAt: 1,
		}).Error; err != nil {
			t.Fatal(err)
		}
	}
	got, err := NewTable(db).Load(context.Background(), "u1")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[preferences.ExplanationLanguage] != "en" {
		t.Fatalf("Load = %v, want only the JSON row", got)
	}
}

func TestTableUsesTheHandleItWasBuiltOn(t *testing.T) {
	first := sqlitextest.Open(t)
	// Open points the global at the handle it opened last.
	second := sqlitextest.Open(t)
	ctx := context.Background()
	tbl := NewTable(first)
	count := func(db *gorm.DB) (rows int64) {
		t.Helper()
		if err := db.Model(&sqlitex.UserPreference{}).Count(&rows).Error; err != nil {
			t.Fatal(err)
		}
		return rows
	}

	if err := tbl.Save(ctx, "u1", preferences.AIWordFallback, true); err != nil {
		t.Fatal(err)
	}
	if a, b := count(first), count(second); a != 1 || b != 0 {
		t.Errorf("after Save: %d rows in the first database and %d in the second, want 1 and 0", a, b)
	}
	got, err := tbl.Load(ctx, "u1")
	if err != nil {
		t.Fatal(err)
	}
	if got[preferences.AIWordFallback] != true {
		t.Errorf("Load = %v, want the first database's value", got)
	}
	if err := tbl.Clear(ctx, "u1", preferences.AIWordFallback); err != nil {
		t.Fatal(err)
	}
	if rows := count(first); rows != 0 {
		t.Errorf("after Clear: %d rows in the first database, want 0", rows)
	}
}
