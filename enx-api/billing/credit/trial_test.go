package credit

import (
	"context"
	"sync"
	"testing"
	"time"

	"enx-api/utils/sqlitex"

	"gorm.io/gorm"
)

// The trial pool (ADR-048): a one-off grant at sign-up that counts toward
// Balance until it expires, and is drawn down before the paid pools.

func TestGrantTrialCountsTowardBalance(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	seedCreditUser(t, userID)

	granted, err := grantTrialInTx(t, userID, "email-"+userID, 100, 7*24*time.Hour)
	if err != nil {
		t.Fatalf("GrantTrialTx: %v", err)
	}
	if !granted {
		t.Fatal("granted = false, want true for a first grant")
	}

	got, err := Balance(ctx, userID)
	if err != nil {
		t.Fatalf("Balance: %v", err)
	}
	if got != 100 {
		t.Fatalf("Balance = %d, want 100", got)
	}
}

func TestGrantTrialOnlyOncePerAccount(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	seedCreditUser(t, userID)
	mustGrantTrial(t, userID, 100, time.Hour)
	if err := Settle(ctx, userID, "translate_sentence", 40); err != nil {
		t.Fatalf("Settle: %v", err)
	}

	granted, err := grantTrialInTx(t, userID, "email-"+userID, 100, time.Hour)
	if err != nil {
		t.Fatalf("second GrantTrialTx: %v", err)
	}
	if granted {
		t.Fatal("granted = true on a second call, want false")
	}
	got, err := Balance(ctx, userID)
	if err != nil {
		t.Fatalf("Balance: %v", err)
	}
	if got != 60 {
		t.Fatalf("Balance = %d, want 60 (the spent trial is not topped back up)", got)
	}
}

// ADR-062 Decision 3: one trial per email, across deleted accounts.
func TestGrantTrialRecordsTheEmailAndSkipsItForAnotherAccount(t *testing.T) {
	ctx := context.Background()
	first, second := "u-"+t.Name()+"-1", "u-"+t.Name()+"-2"
	seedCreditUser(t, first)
	seedCreditUser(t, second)
	email := "hmac-" + t.Name()

	if granted, err := grantTrialInTx(t, first, email, 100, time.Hour); err != nil || !granted {
		t.Fatalf("first GrantTrialTx = %v, %v; want true", granted, err)
	}
	var grant sqlitex.TrialGrant
	if err := sqlitex.DB.Where("email_hmac = ?", email).First(&grant).Error; err != nil || grant.UserId != first {
		t.Fatalf("trial grant record = %+v, %v; want one for %s", grant, err, first)
	}

	granted, err := grantTrialInTx(t, second, email, 100, time.Hour)
	if err != nil || granted {
		t.Fatalf("GrantTrialTx for the same email = %v, %v; want false, nil", granted, err)
	}
	got, err := Balance(ctx, second)
	if err != nil {
		t.Fatalf("Balance: %v", err)
	}
	if got != 0 {
		t.Fatalf("Balance = %d, want 0 for an email that already had a trial", got)
	}
}

// The migration backfills a record for every existing user, including one
// whose sign-up trial failed: that account still gets its own trial.
func TestGrantTrialGrantsWhenTheRecordIsTheAccountsOwn(t *testing.T) {
	userID := "u-" + t.Name()
	seedCreditUser(t, userID)
	email := "hmac-" + t.Name()
	if err := sqlitex.DB.Create(&sqlitex.TrialGrant{EmailHmac: email, UserId: userID, GrantedAt: 1}).Error; err != nil {
		t.Fatalf("seed trial_grants: %v", err)
	}

	if granted, err := grantTrialInTx(t, userID, email, 100, time.Hour); err != nil || !granted {
		t.Fatalf("GrantTrialTx = %v, %v; want true for the record's own account", granted, err)
	}
}

func TestGrantTrialWithoutAnEmailGrantsNothing(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	seedCreditUser(t, userID)
	granted, err := grantTrialInTx(t, userID, "", 100, time.Hour)
	if err != nil || granted {
		t.Fatalf("GrantTrialTx without an email = %v, %v; want false, nil", granted, err)
	}
	got, err := Balance(ctx, userID)
	if err != nil {
		t.Fatalf("Balance: %v", err)
	}
	if got != 0 {
		t.Fatalf("Balance = %d, want 0", got)
	}
}

func TestGrantTrialZeroAmountIsOff(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	seedCreditUser(t, userID)

	granted, err := grantTrialInTx(t, userID, "email-"+userID, 0, time.Hour)
	if err != nil || granted {
		t.Fatalf("GrantTrialTx(0) = %v, %v; want false, nil", granted, err)
	}
	got, err := Balance(ctx, userID)
	if err != nil {
		t.Fatalf("Balance: %v", err)
	}
	if got != 0 {
		t.Fatalf("Balance = %d, want 0", got)
	}
}

// A referral bonus can land in the trial pool while the trial itself was
// skipped (no email HMAC then); the later trial grant adds to that bonus and
// keeps its later expiry (ADR-051 Decision 4).
func TestGrantTrialAddsToABonusAlreadyInTheTrialPool(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	seedCreditUser(t, userID)
	mustGrantSubscription(t, userID, 5, 0)
	start := time.Now().Truncate(time.Second)
	setClock(t, start)
	bonusExpiry := start.Add(14 * 24 * time.Hour)
	if _, err := GrantReferralBonus(ctx, userID, ReferralBonus{
		Amount: 50, ExpiresAt: bonusExpiry,
		TrialAmount: 100, TrialTTL: 7 * 24 * time.Hour, EmailHMAC: "",
	}); err != nil {
		t.Fatalf("GrantReferralBonus: %v", err)
	}

	if granted, err := grantTrialInTx(t, userID, "email-"+userID, 100, 7*24*time.Hour); err != nil || !granted {
		t.Fatalf("GrantTrialTx = %v, %v; want true", granted, err)
	}

	acc := loadAccount(t, userID)
	if acc.TrialBalance != 150 || acc.TrialExpiresAt == nil || *acc.TrialExpiresAt != bonusExpiry.Unix() {
		t.Fatalf("got trial=%d expires=%v, want 150 / %d (the bonus's expiry)", acc.TrialBalance, acc.TrialExpiresAt, bonusExpiry.Unix())
	}
	total, err := Balance(ctx, userID)
	if err != nil {
		t.Fatalf("Balance: %v", err)
	}
	var rows []sqlitex.CreditTransaction
	if err := sqlitex.DB.Where("user_id = ? AND type = ?", userID, TypeGrantTrial).Find(&rows).Error; err != nil {
		t.Fatalf("load GRANT_TRIAL rows: %v", err)
	}
	if len(rows) != 1 || rows[0].Amount != 100 || rows[0].BalanceAfter != 150 ||
		rows[0].TotalBalanceAfter == nil || *rows[0].TotalBalanceAfter != total {
		t.Fatalf("GRANT_TRIAL rows = %+v, want one row of 100 with balance 150 and total %d", rows, total)
	}
}

// A bonus that expired with a leftover is forfeited first, so the trial pool
// then holds exactly the trial, on the trial's own expiry.
func TestGrantTrialForfeitsAnExpiredBonusFirst(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	seedCreditUser(t, userID)
	start := time.Now().Truncate(time.Second)
	setClock(t, start)
	if _, err := GrantReferralBonus(ctx, userID, ReferralBonus{Amount: 50, ExpiresAt: start.Add(time.Hour)}); err != nil {
		t.Fatalf("GrantReferralBonus: %v", err)
	}
	at := start.Add(2 * time.Hour)
	setClock(t, at)

	if granted, err := grantTrialInTx(t, userID, "email-"+userID, 100, 7*24*time.Hour); err != nil || !granted {
		t.Fatalf("GrantTrialTx = %v, %v; want true", granted, err)
	}

	acc := loadAccount(t, userID)
	if want := at.Add(7 * 24 * time.Hour).Unix(); acc.TrialBalance != 100 || acc.TrialExpiresAt == nil || *acc.TrialExpiresAt != want {
		t.Fatalf("got trial=%d expires=%v, want 100 / %d", acc.TrialBalance, acc.TrialExpiresAt, want)
	}
	var rows []sqlitex.CreditTransaction
	if err := sqlitex.DB.Where("user_id = ? AND type IN ?", userID, []string{TypeExpire, TypeGrantTrial}).
		Order("rowid").Find(&rows).Error; err != nil {
		t.Fatalf("load ledger rows: %v", err)
	}
	if len(rows) != 2 ||
		rows[0].Type != TypeExpire || rows[0].Amount != -50 || rows[0].BalanceAfter != 0 ||
		rows[1].Type != TypeGrantTrial || rows[1].Amount != 100 || rows[1].BalanceAfter != 100 {
		t.Fatalf("ledger rows = %+v, want EXPIRE -50 then GRANT_TRIAL 100 with balance 100", rows)
	}
}

func TestBalanceIgnoresExpiredTrial(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	seedCreditUser(t, userID)
	mustGrantSubscription(t, userID, 5, 0)
	mustGrantTrial(t, userID, 100, time.Hour)

	setClock(t, time.Now().Add(time.Hour+time.Second))

	got, err := Balance(ctx, userID)
	if err != nil {
		t.Fatalf("Balance: %v", err)
	}
	if got != 5 {
		t.Fatalf("Balance = %d, want 5 (expired trial not counted)", got)
	}
}

func TestSettleAfterExpiryForfeitsTrialAndRecordsExpire(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	seedCreditUser(t, userID)
	mustGrantSubscription(t, userID, 10, 0)
	mustGrantTrial(t, userID, 30, time.Hour)
	setClock(t, time.Now().Add(2*time.Hour))

	if err := Settle(ctx, userID, "translate_sentence", 4); err != nil {
		t.Fatalf("Settle: %v", err)
	}

	acc := loadAccount(t, userID)
	if acc.TrialBalance != 0 || acc.SubscriptionBalance != 6 {
		t.Fatalf("got trial=%d subscription=%d, want 0/6 (expired trial not spent)", acc.TrialBalance, acc.SubscriptionBalance)
	}
	var rows []sqlitex.CreditTransaction
	if err := sqlitex.DB.Where("user_id = ? AND type = ?", userID, TypeExpire).Find(&rows).Error; err != nil {
		t.Fatalf("load EXPIRE rows: %v", err)
	}
	if len(rows) != 1 || rows[0].Amount != -30 {
		t.Fatalf("EXPIRE rows = %+v, want one row of -30", rows)
	}

	if err := Settle(ctx, userID, "translate_sentence", 1); err != nil {
		t.Fatalf("second Settle: %v", err)
	}
	var count int64
	if err := sqlitex.DB.Model(&sqlitex.CreditTransaction{}).Where("user_id = ? AND type = ?", userID, TypeExpire).Count(&count).Error; err != nil {
		t.Fatalf("count EXPIRE rows: %v", err)
	}
	if count != 1 {
		t.Fatalf("EXPIRE rows after a second Settle = %d, want still 1", count)
	}
}

func TestSettleConcurrentKeepsTrialNonNegativeAndLosesNothing(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	seedCreditUser(t, userID)
	mustGrantSubscription(t, userID, 10, 100)
	mustGrantTrial(t, userID, 20, time.Hour)

	const goroutines, costEach = 50, 3
	var wg sync.WaitGroup
	errs := make(chan error, goroutines)
	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := Settle(ctx, userID, "translate_sentence", costEach); err != nil {
				errs <- err
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatalf("Settle: %v", err)
	}

	acc := loadAccount(t, userID)
	if acc.TrialBalance != 0 || acc.SubscriptionBalance != 0 {
		t.Fatalf("got trial=%d subscription=%d, want both drained to exactly 0", acc.TrialBalance, acc.SubscriptionBalance)
	}
	if want := int64(130 - goroutines*costEach); acc.TopupBalance != want {
		t.Fatalf("topup = %d, want %d (a lost write)", acc.TopupBalance, want)
	}
}

func mustGrantTrial(t *testing.T, userID string, amount int64, ttl time.Duration) {
	t.Helper()
	if _, err := grantTrialInTx(t, userID, "email-"+userID, amount, ttl); err != nil {
		t.Fatalf("setup GrantTrialTx: %v", err)
	}
}

// grantTrialInTx grants the trial the way the sign-up hook does: through
// GrantTrialTx inside a transaction of its own.
func grantTrialInTx(t *testing.T, userID, emailHMAC string, amount int64, ttl time.Duration) (granted bool, err error) {
	t.Helper()
	err = sqlitex.DB.Transaction(func(tx *gorm.DB) error {
		granted, err = GrantTrialTx(tx, userID, emailHMAC, amount, ttl)
		return err
	})
	return granted, err
}

// setClock moves the ledger's trial clock to at for the rest of the test.
func setClock(t *testing.T, at time.Time) {
	t.Helper()
	prev := now
	now = func() time.Time { return at }
	t.Cleanup(func() { now = prev })
}

func TestSettleDrawsTrialBeforeSubscriptionAndTopup(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	seedCreditUser(t, userID)
	mustGrantSubscription(t, userID, 10, 10)
	mustGrantTrial(t, userID, 5, time.Hour)

	if err := Settle(ctx, userID, "translate_sentence", 8); err != nil {
		t.Fatalf("Settle: %v", err)
	}

	acc := loadAccount(t, userID)
	if acc.TrialBalance != 0 || acc.SubscriptionBalance != 7 || acc.TopupBalance != 10 {
		t.Fatalf("got trial=%d subscription=%d topup=%d, want 0/7/10",
			acc.TrialBalance, acc.SubscriptionBalance, acc.TopupBalance)
	}
}

func TestSettleOverrunSpillsFromTrialThroughToTopup(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	seedCreditUser(t, userID)
	mustGrantSubscription(t, userID, 2, 1)
	mustGrantTrial(t, userID, 3, time.Hour)

	if err := Settle(ctx, userID, "translate_sentence", 10); err != nil {
		t.Fatalf("Settle: %v", err)
	}

	acc := loadAccount(t, userID)
	if acc.TrialBalance != 0 || acc.SubscriptionBalance != 0 || acc.TopupBalance != -4 {
		t.Fatalf("got trial=%d subscription=%d topup=%d, want 0/0/-4",
			acc.TrialBalance, acc.SubscriptionBalance, acc.TopupBalance)
	}
}

// A user whose AI access comes from the trial alone never goes into debt:
// the part of a charge the trial can't cover is written off, so top-up stays
// at zero and the ledger records only what was actually taken.
func TestSettleWritesOffTrialOnlyOverrun(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	seedCreditUser(t, userID)
	mustGrantTrial(t, userID, 3, time.Hour)

	if err := Settle(ctx, userID, "translate_sentence", 10); err != nil {
		t.Fatalf("Settle: %v", err)
	}

	acc := loadAccount(t, userID)
	if acc.TrialBalance != 0 || acc.SubscriptionBalance != 0 || acc.TopupBalance != 0 {
		t.Fatalf("got trial=%d subscription=%d topup=%d, want 0/0/0",
			acc.TrialBalance, acc.SubscriptionBalance, acc.TopupBalance)
	}
	var rows []sqlitex.CreditTransaction
	if err := sqlitex.DB.Where("user_id = ? AND type = ?", userID, TypeSettle).Find(&rows).Error; err != nil {
		t.Fatalf("load SETTLE rows: %v", err)
	}
	if len(rows) != 1 || rows[0].Amount != -3 || rows[0].BalanceAfter != 0 {
		t.Fatalf("SETTLE rows = %+v, want one row of -3 with balance 0", rows)
	}
}
