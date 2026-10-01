package adapters

import (
	"context"
	"errors"
	"testing"

	"enx-api/aitranslate"
	"enx-api/aitranslate/worddef"
	"enx-api/billing/credit"
	"enx-api/dictionary"
	"enx-api/preferences"
	"enx-api/utils/sqlitex"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

type stubDefiner struct {
	res   worddef.Result
	usage aitranslate.Usage
	err   error
}

func (s stubDefiner) DefineWord(context.Context, string) (worddef.Result, aitranslate.Usage, error) {
	return s.res, s.usage, s.err
}

func TestAIDefinerMapsAnAnswer(t *testing.T) {
	d := AIDefiner{Definer: stubDefiner{
		res:   worddef.Result{IsWord: true, Quality: 9, Senses: []worddef.Sense{{Pos: "n.", Zh: "很有魅力的人"}, {Pos: "adj.", Zh: "有魅力的"}}},
		usage: aitranslate.Usage{PromptTokens: 150, CompletionTokens: 40},
	}}

	def, usage, err := d.DefineWord(context.Background(), "rizzler")
	if err != nil {
		t.Fatal(err)
	}
	if !def.IsWord || def.Quality != 9 || def.Chinese != "n. 很有魅力的人\nadj. 有魅力的" {
		t.Fatalf("definition = %+v", def)
	}
	if usage != (dictionary.AIUsage{PromptTokens: 150, CompletionTokens: 40}) {
		t.Fatalf("usage = %+v", usage)
	}
}

func TestAIDefinerTellsAnUnusableReplyFromAFailedCall(t *testing.T) {
	invalid := AIDefiner{Definer: stubDefiner{
		err:   errors.Join(worddef.ErrInvalidReply, errors.New("no JSON")),
		usage: aitranslate.Usage{PromptTokens: 150, CompletionTokens: 9},
	}}
	_, usage, err := invalid.DefineWord(context.Background(), "rizzler")
	if !errors.Is(err, dictionary.ErrInvalidAIReply) {
		t.Fatalf("err = %v, want ErrInvalidAIReply", err)
	}
	if usage.CompletionTokens != 9 {
		t.Fatalf("usage should survive an unusable reply: %+v", usage)
	}

	boom := errors.New("provider down")
	failed := AIDefiner{Definer: stubDefiner{err: boom}}
	if _, _, err := failed.DefineWord(context.Background(), "rizzler"); !errors.Is(err, boom) || errors.Is(err, dictionary.ErrInvalidAIReply) {
		t.Fatalf("err = %v, want the provider error, not ErrInvalidAIReply", err)
	}
}

func setupBillingDB(t *testing.T) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&sqlitex.CreditAccount{}, &sqlitex.CreditTransaction{}); err != nil {
		t.Fatal(err)
	}
	sqlitex.DB = db
}

func TestTokenBillingChargesTheLedgerByTokens(t *testing.T) {
	setupBillingDB(t)
	if err := sqlitex.DB.Create(&sqlitex.CreditAccount{UserId: "u1", TopupBalance: 10, UpdatedAt: 1}).Error; err != nil {
		t.Fatal(err)
	}
	billing := TokenBilling{Pricing: credit.TokenPricing{WeightIn: 1, WeightOut: 3, Divisor: 100}, Feature: "lookup_word_ai"}
	ctx := context.Background()

	if !billing.Priced() {
		t.Fatal("a priced feature should report Priced")
	}
	if balance, err := billing.Balance(ctx, "u1"); err != nil || balance != 10 {
		t.Fatalf("Balance = %d, %v", balance, err)
	}
	// ceil((150*1 + 40*3) / 100) = 3
	if err := billing.Settle(ctx, "u1", dictionary.AIUsage{PromptTokens: 150, CompletionTokens: 40}); err != nil {
		t.Fatal(err)
	}
	if balance, _ := billing.Balance(ctx, "u1"); balance != 7 {
		t.Fatalf("balance after settling = %d, want 7", balance)
	}
	var feature string
	if err := sqlitex.DB.Raw("SELECT feature FROM credit_transactions WHERE user_id = ?", "u1").Scan(&feature).Error; err != nil || feature != "lookup_word_ai" {
		t.Fatalf("ledger feature = %q, %v", feature, err)
	}
}

func TestTokenBillingUnpricedIsNotPriced(t *testing.T) {
	for name, pricing := range map[string]credit.TokenPricing{
		"no divisor": {WeightIn: 1, WeightOut: 3},
		"no weights": {Divisor: 3000},
		"all unset":  {},
	} {
		if (TokenBilling{Pricing: pricing}).Priced() {
			t.Errorf("%s: reported as priced, but the feature would run for free", name)
		}
	}
}

type aiService bool

func (a aiService) AIConfigured() bool { return bool(a) }

type stubEntitlements struct {
	can bool
	err error
}

func (s stubEntitlements) CanUseAI(context.Context, string) (bool, error) { return s.can, s.err }

type stubPrefs struct {
	on  bool
	err error
}

func (s stubPrefs) Effective(_ context.Context, _ string, key preferences.Key) (bool, error) {
	if key != preferences.AIWordFallback {
		return false, errors.New("asked for the wrong preference")
	}
	return s.on, s.err
}

func TestAIPolicyFallback(t *testing.T) {
	boom := errors.New("db down")
	for _, tc := range []struct {
		name         string
		policy       AIPolicy
		canUse, auto bool
	}{
		{"subscriber with it on", AIPolicy{aiService(true), stubEntitlements{can: true}, stubPrefs{on: true}}, true, true},
		{"top-up only, default off", AIPolicy{aiService(true), stubEntitlements{can: true}, stubPrefs{on: false}}, true, false},
		{"free user", AIPolicy{aiService(true), stubEntitlements{can: false}, stubPrefs{on: true}}, false, false},
		{"AI not configured", AIPolicy{aiService(false), stubEntitlements{can: true}, stubPrefs{on: true}}, false, false},
		// Fail closed: a failed check never starts an AI call the user did not ask for.
		{"entitlement check fails", AIPolicy{aiService(true), stubEntitlements{err: boom}, stubPrefs{on: true}}, false, false},
		{"preference read fails", AIPolicy{aiService(true), stubEntitlements{can: true}, stubPrefs{err: boom}}, true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			canUse, auto := tc.policy.Fallback(context.Background(), "u1")
			if canUse != tc.canUse || auto != tc.auto {
				t.Fatalf("Fallback = (%v, %v), want (%v, %v)", canUse, auto, tc.canUse, tc.auto)
			}
		})
	}
}

func TestAIPolicyDoesNotConsultTheUserWhenAIIsNotConfigured(t *testing.T) {
	policy := AIPolicy{aiService(false), stubEntitlements{err: errors.New("must not be called")}, stubPrefs{err: errors.New("must not be called")}}
	if canUse, auto := policy.Fallback(context.Background(), "u1"); canUse || auto {
		t.Fatalf("Fallback = (%v, %v), want nothing offered", canUse, auto)
	}
}

func TestWordsTableAddStoresAnAIDefinitionWithItsProvenance(t *testing.T) {
	setupWordsDB(t)
	ctx := context.Background()

	id, err := WordsTable{}.Add(ctx, dictionary.Entry{
		English: "rizzler", Chinese: "n. 很有魅力的人", Origin: dictionary.OriginAI, Quality: 9, PromptVersion: "v1",
	})
	if err != nil || id == "" {
		t.Fatalf("Add: %q, %v", id, err)
	}

	var row sqlitex.Word
	if err := sqlitex.DB.Where("id = ?", id).First(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.Source != "ai" || row.AdminEditedAt != nil || row.AIQuality == nil || *row.AIQuality != 9 ||
		row.AIPromptVersion == nil || *row.AIPromptVersion != "v1" {
		t.Fatalf("stored row = %+v", row)
	}
}

func TestWordsTableAddStoresAnECDICTEntryAsECDICT(t *testing.T) {
	setupWordsDB(t)

	id, err := WordsTable{}.Add(context.Background(), dictionary.Entry{English: "run", Chinese: "v. 跑"})
	if err != nil {
		t.Fatal(err)
	}
	var row sqlitex.Word
	if err := sqlitex.DB.Where("id = ?", id).First(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.Source != "ecdict" || row.AIQuality != nil || row.AIPromptVersion != nil {
		t.Fatalf("stored row = %+v, want a plain ECDICT row", row)
	}
}

// Two users defining the same new word at once: the second Add loses the
// UNIQUE race and must hand back the row that won, not fail.
func TestWordsTableAddReturnsTheWinnersRowWhenAnAIDefinitionRaces(t *testing.T) {
	setupWordsDB(t)
	ctx := context.Background()
	first, err := WordsTable{}.Add(ctx, dictionary.Entry{English: "rizzler", Chinese: "n. 第一个", Origin: dictionary.OriginAI, Quality: 9, PromptVersion: "v1"})
	if err != nil {
		t.Fatal(err)
	}

	second, err := WordsTable{}.Add(ctx, dictionary.Entry{English: "Rizzler", Chinese: "n. 第二个", Origin: dictionary.OriginAI, Quality: 9, PromptVersion: "v1"})
	if err != nil || second != first {
		t.Fatalf("second Add = %q, %v; want the first row %q", second, err, first)
	}
}
