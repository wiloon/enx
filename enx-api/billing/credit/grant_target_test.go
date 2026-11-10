package credit

import (
	"context"
	"errors"
	"testing"
	"time"

	"enx-api/utils/sqlitex"
)

// grantWriters are the ledger's four grant paths, each granting to userID.
func grantWriters(t *testing.T) map[string]func(userID string) error {
	return map[string]func(userID string) error{
		"admin": func(userID string) error {
			return GrantAdmin(context.Background(), userID, 10, "support")
		},
		"trial": func(userID string) error {
			_, err := grantTrialInTx(t, userID, "h:"+userID, 10, time.Hour)
			return err
		},
		"referral bonus with trial backfill": func(userID string) error {
			_, err := GrantReferralBonus(context.Background(), userID, ReferralBonus{
				Amount: 10, ExpiresAt: time.Now().Add(time.Hour),
				TrialAmount: 10, TrialTTL: time.Hour, EmailHMAC: "h:" + userID,
			})
			return err
		},
		"referral reward": func(userID string) error {
			return GrantReferralReward(context.Background(), userID, 10, "referral-reward:invitee-of-"+userID)
		},
	}
}

func setDeletionGate(t *testing.T, userID, state string) {
	t.Helper()
	if err := sqlitex.DB.Exec("INSERT INTO account_deletion_gates (user_id, state, started_at, updated_at) VALUES (?, ?, 1, 1)", userID, state).Error; err != nil {
		t.Fatalf("set deletion gate: %v", err)
	}
}

func countGrantEffects(t *testing.T, userID string) (accounts, transactions, trialGrants int64) {
	t.Helper()
	for table, n := range map[string]*int64{"credit_accounts": &accounts, "credit_transactions": &transactions, "trial_grants": &trialGrants} {
		if err := sqlitex.DB.Raw("SELECT count(*) FROM "+table+" WHERE user_id = ?", userID).Scan(n).Error; err != nil {
			t.Fatalf("count %s: %v", table, err)
		}
	}
	return accounts, transactions, trialGrants
}

func TestEveryGrantWriterHonoursTheDeletionGate(t *testing.T) {
	cases := []struct {
		gate     string
		userRow  bool
		want     error
		scenario string
	}{
		{gate: "in_progress", userRow: true, want: ErrDeletionInProgress, scenario: "deletion in progress"},
		{gate: "deleted", userRow: true, want: ErrNoUser, scenario: "deleted gate"},
		{userRow: false, want: ErrNoUser, scenario: "no users row"},
	}
	for name, grant := range grantWriters(t) {
		for _, c := range cases {
			t.Run(name+"/"+c.scenario, func(t *testing.T) {
				userID := "u-" + t.Name()
				if c.userRow {
					seedCreditUser(t, userID)
				}
				if c.gate != "" {
					setDeletionGate(t, userID, c.gate)
				}

				if err := grant(userID); !errors.Is(err, c.want) {
					t.Fatalf("grant = %v, want %v", err, c.want)
				}
				if a, tx, tg := countGrantEffects(t, userID); a+tx+tg != 0 {
					t.Errorf("credit_accounts=%d credit_transactions=%d trial_grants=%d, want nothing written", a, tx, tg)
				}
			})
		}
	}
}

func TestTrialAndBonusReplayedAfterDeletionRecreateNoBalance(t *testing.T) {
	writers := grantWriters(t)
	for _, c := range []struct {
		name string
		rows int64
	}{
		{name: "trial", rows: 1},
		{name: "referral bonus with trial backfill", rows: 2},
	} {
		t.Run(c.name, func(t *testing.T) {
			userID := "u-" + t.Name()
			seedCreditUser(t, userID)
			if err := writers[c.name](userID); err != nil {
				t.Fatalf("grant: %v", err)
			}
			for _, table := range []string{"credit_accounts WHERE user_id", "users WHERE id"} {
				if err := sqlitex.DB.Exec("DELETE FROM "+table+" = ?", userID).Error; err != nil {
					t.Fatalf("delete the account: %v", err)
				}
			}
			setDeletionGate(t, userID, "deleted")

			if err := writers[c.name](userID); err != nil {
				t.Fatalf("replay = %v, want the processed key to be a no-op", err)
			}
			if a, tx, _ := countGrantEffects(t, userID); a != 0 || tx != c.rows {
				t.Errorf("credit_accounts=%d credit_transactions=%d, want 0 and the %d retained", a, tx, c.rows)
			}
		})
	}
}
