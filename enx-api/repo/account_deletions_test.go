package repo

import (
	"context"
	"testing"
	"time"

	"enx-api/account"
	"enx-api/utils/sqlitex"
)

func gateStates(t *testing.T, userID string) []string {
	t.Helper()
	var states []string
	if err := sqlitex.DB.Raw("SELECT state FROM account_deletion_gates WHERE user_id = ?", userID).Scan(&states).Error; err != nil {
		t.Fatal(err)
	}
	return states
}

func TestAccountDeletionsReleaseLiftsTheGateAndLeavesTheAccountAndTrialGrant(t *testing.T) {
	newAccountDB(t)
	seedAccount(t, "alice", "alice@example.com")
	grant := sqlitex.TrialGrant{EmailHmac: "hmac_alice", UserId: "alice", GrantedAt: 123}
	if err := sqlitex.DB.Create(&grant).Error; err != nil {
		t.Fatal(err)
	}
	ctx, now := context.Background(), time.Now()
	deletions := AccountDeletions{}

	a, err := deletions.Acquire(ctx, account.User{ID: "alice"}, account.DeleteOptions{ResetTrial: true}, now)
	if err != nil {
		t.Fatalf("Acquire: %v", err)
	}
	if err := deletions.Release(ctx, a, now); err != nil {
		t.Fatalf("Release: %v", err)
	}

	if states := gateStates(t, "alice"); len(states) != 0 {
		t.Errorf("gate states = %v, want the gate lifted", states)
	}
	if n := countRows(t, "account_deletion_attempts", "user_id", "alice"); n != 0 {
		t.Errorf("account_deletion_attempts: %d row(s), want none", n)
	}
	if n := countRows(t, "users", "id", "alice"); n != 1 {
		t.Errorf("users: %d row(s) of alice, want the account kept", n)
	}
	var after sqlitex.TrialGrant
	if err := sqlitex.DB.First(&after, "email_hmac = ?", grant.EmailHmac).Error; err != nil || after != grant {
		t.Errorf("trial grant = %+v, %v; want %+v unchanged", after, err, grant)
	}
}

func TestAccountDeletionsCompleteDeletesTheAccountAndKeepsADeletedGate(t *testing.T) {
	newAccountDB(t)
	seedAccount(t, "alice", "alice@example.com")
	ctx, now := context.Background(), time.Now()
	deletions := AccountDeletions{}

	a, err := deletions.Acquire(ctx, account.User{ID: "alice"}, account.DeleteOptions{}, now)
	if err != nil {
		t.Fatalf("Acquire: %v", err)
	}
	if err := deletions.Prepare(ctx, a, "hmac_alice", now); err != nil {
		t.Fatalf("Prepare: %v", err)
	}
	if err := deletions.Complete(ctx, a, now); err != nil {
		t.Fatalf("Complete: %v", err)
	}

	if states := gateStates(t, "alice"); len(states) != 1 || states[0] != "deleted" {
		t.Errorf("gate states = %v, want one deleted gate", states)
	}
	if n := countRows(t, "users", "id", "alice"); n != 0 {
		t.Errorf("users: %d row(s) of alice, want the account deleted", n)
	}
	if n := countRows(t, "account_deletion_attempts", "user_id", "alice"); n != 0 {
		t.Errorf("account_deletion_attempts: %d row(s), want none", n)
	}
}
