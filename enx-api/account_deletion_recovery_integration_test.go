//go:build integration

package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"

	"enx-api/account"
	accountadapters "enx-api/account/adapters"
	"enx-api/billing/eligibility"
	"enx-api/billing/snapshot"
	"enx-api/clerktest"
	"enx-api/config"
	"enx-api/metrics"
	"enx-api/repo"
	"enx-api/utils/sqlitex"

	"github.com/golang-jwt/jwt/v5"
	stripeSDK "github.com/stripe/stripe-go/v86"
	"gorm.io/gorm"
)

type deletionClerk struct {
	account.Clerk
	remove func() error
}

func (c deletionClerk) DeleteUser(context.Context, string) error { return c.remove() }

// All gates in these tests are established by a production deletion route.
// Expiring a persisted lease models elapsed time without minute-long sleeps.
func deletionRecoveryEnv(t *testing.T, stripeClients ...*stripeSDK.Client) (func(account.Clerk) *httptest.Server, func(bool, string) (int, map[string]any)) {
	t.Helper()
	jwks := clerktest.NewEnv(t)
	cfg := config.Default()
	cfg.Clerk = jwks.Config()
	cfg.Admin.ClerkUserIDs = []string{adminSub}
	cfg.Account.EmailHMACKey = "test-key"

	sqlitex.Init(filepath.Join(t.TempDir(), "recovery.db"))
	if err := sqlitex.InitializeBillingSchema(sqlitex.DB); err != nil {
		t.Fatal(err)
	}
	deletionSQL(t, "INSERT INTO users (id, clerk_user_id, email) VALUES ('target', ?, ?)", nonAdminSub, accountPlainEmail)
	var stripeClient *stripeSDK.Client
	if len(stripeClients) > 0 {
		stripeClient = stripeClients[0]
	}
	var server *httptest.Server
	start := func(clerk account.Clerk) *httptest.Server {
		server = httptest.NewServer(setupRouterWithClients(cfg, metrics.New(), stripeClient, clerk))
		t.Cleanup(server.Close)
		return server
	}
	request := func(admin bool, query string) (int, map[string]any) {
		if admin {
			token := jwks.SignSessionToken(t, jwt.MapClaims{"sub": adminSub, "email": "admin@example.com"})
			return doJSON(t, http.MethodDelete, server.URL+"/api/admin/users/target"+query, token)
		}
		token := jwks.SignSessionToken(t, jwt.MapClaims{"sub": nonAdminSub, "email": accountPlainEmail})
		return doJSONBody(t, http.MethodDelete, server.URL+"/api/me", token, map[string]string{"email": accountPlainEmail})
	}
	return start, request
}
func deletionSQL(t *testing.T, query string, args ...any) {
	t.Helper()
	if err := sqlitex.DB.Exec(query, args...).Error; err != nil {
		t.Fatal(err)
	}
}
func deletionCount(t *testing.T, query string, want int) {
	t.Helper()
	var got int
	if err := sqlitex.DB.Raw(query).Scan(&got).Error; err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("%s = %d, want %d", query, got, want)
	}
}

func TestDeletionRecoversUncertainClerkAndLocalFailureWithOriginalIntent(t *testing.T) {
	for _, failure := range []string{"uncertain clerk", "local deletion"} {
		for _, reset := range []bool{false, true} {
			t.Run(failure+"/reset="+map[bool]string{false: "false", true: "true"}[reset], func(t *testing.T) {
				start, request := deletionRecoveryEnv(t)
				hash := account.NewEmailHMAC("test-key").Of(accountPlainEmail)
				deletionSQL(t, "INSERT INTO trial_grants (email_hmac, user_id, granted_at) VALUES (?, 'target', 123)", hash)
				if failure == "local deletion" {
					deletionSQL(t, "CREATE TRIGGER fail_local BEFORE DELETE ON users WHEN OLD.id = 'target' BEGIN SELECT RAISE(ABORT, 'local failure'); END")
				}
				calls := 0
				original := start(deletionClerk{remove: func() error {
					calls++
					deletionCount(t, "SELECT count(*) FROM account_deletion_gates WHERE user_id = 'target' AND state = 'in_progress'", 1)
					deletionCount(t, "SELECT count(*) FROM account_deletion_attempts WHERE user_id = 'target' AND phase = 'irreversible'", 1)
					if failure == "uncertain clerk" {
						return errors.New("response lost after remote deletion")
					}
					return nil
				}})
				query := ""
				if reset {
					query = "?resetTrial=true"
				}
				if code, body := request(reset, query); code != 500 {
					t.Fatalf("first attempt %d %v", code, body)
				}
				deletionCount(t, "SELECT count(*) FROM users WHERE id = 'target'", 1)
				// The other route cannot release or independently invoke Clerk.
				if code, body := request(true, ""); code != 503 || body["code"] != "deletion_in_progress" {
					t.Fatalf("overlap %d %v", code, body)
				}
				if calls != 1 {
					t.Fatalf("overlap invoked Clerk: %d", calls)
				}
				deletionCount(t, "SELECT count(*) FROM account_deletion_gates WHERE state = 'in_progress'", 1)
				deletionSQL(t, "UPDATE account_deletion_attempts SET lease_until = 0")
				if failure == "local deletion" {
					deletionSQL(t, "DROP TRIGGER fail_local")
				}
				// Recreate the router/services on the persisted database. Admin recovery
				// needs no session for the target user, whose Clerk identity is gone.
				original.Close()
				absentCalls := 0
				absent := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					absentCalls++
					if r.Method != http.MethodDelete || r.URL.Path != "/users/"+nonAdminSub {
						t.Errorf("unexpected Clerk request: %s %s", r.Method, r.URL.Path)
					}
					w.WriteHeader(http.StatusNotFound)
				}))
				defer absent.Close()
				recoveredClerk := accountadapters.NewClerk("test")
				recoveredClerk.BaseURL = absent.URL
				recoveredClerk.HTTP = absent.Client()
				start(recoveredClerk)
				// Opposite intent on recovery must not change the original choice.
				query = "?resetTrial=true"
				if reset {
					query = ""
				}
				if code, body := request(true, query); code != 200 {
					t.Fatalf("recovery %d %v", code, body)
				}
				if absentCalls != 1 {
					t.Fatalf("recovery did not repeat Clerk deletion: %d", absentCalls)
				}
				deletionCount(t, "SELECT count(*) FROM users WHERE id = 'target'", 0)
				deletionCount(t, "SELECT count(*) FROM account_deletion_gates WHERE user_id = 'target' AND state = 'deleted'", 1)
				deletionCount(t, "SELECT count(*) FROM account_deletion_attempts", 0)
				wantTrial := 1
				if reset {
					wantTrial = 0
				}
				deletionCount(t, "SELECT count(*) FROM trial_grants WHERE user_id = 'target'", wantTrial)
			})
		}
	}
}

func TestDeletionReleasesOnlyReversibleFailuresAndCanRetry(t *testing.T) {
	for _, stage := range []string{"gate", "trial", "before clerk"} {
		t.Run(stage, func(t *testing.T) {
			start, request := deletionRecoveryEnv(t)
			trigger := map[string]string{
				"gate":         "BEFORE INSERT ON account_deletion_gates",
				"trial":        "BEFORE INSERT ON trial_grants",
				"before clerk": "BEFORE UPDATE OF phase ON account_deletion_attempts",
			}[stage]
			deletionSQL(t, "CREATE TRIGGER fail_attempt "+trigger+" BEGIN SELECT RAISE(ABORT, 'injected failure'); END")
			clerk := &fakeClerkBackend{}
			start(clerk.client(t))
			if code, body := request(true, ""); code != 500 {
				t.Fatalf("failure %d %v", code, body)
			}
			if len(clerk.recorded()) != 0 {
				t.Fatalf("Clerk invoked before preparation committed: %v", clerk.recorded())
			}
			deletionCount(t, "SELECT count(*) FROM account_deletion_gates", 0)
			deletionCount(t, "SELECT count(*) FROM account_deletion_attempts", 0)
			deletionCount(t, "SELECT count(*) FROM trial_grants WHERE user_id = 'target'", 0)
			deletionCount(t, "SELECT count(*) FROM users WHERE id = 'target'", 1)
			deletionSQL(t, "DROP TRIGGER fail_attempt")
			if code, body := request(true, ""); code != 200 {
				t.Fatalf("retry %d %v", code, body)
			}
			deletionCount(t, "SELECT count(*) FROM account_deletion_gates WHERE state = 'deleted'", 1)
		})
	}
}

func TestExpiredDeletionOwnerCannotCompleteAfterTakeover(t *testing.T) {
	start, request := deletionRecoveryEnv(t)
	entered, resume := make(chan struct{}), make(chan struct{})
	defer resumeDeletion(resume)
	start(deletionClerk{remove: func() error {
		close(entered)
		<-resume
		return nil
	}})
	// Capture the first server before starting the replacement router.
	result := make(chan int, 1)
	go func() { code, _ := request(false, ""); result <- code }()
	<-entered
	deletionSQL(t, "UPDATE account_deletion_attempts SET lease_until = 0")
	// Recovery owner reaches Clerk but does not complete. The first owner's
	// late success must not remove its gate, recovery record, or local user.
	start(deletionClerk{remove: func() error { return errors.New("lost response") }})
	if code, body := request(true, "?resetTrial=true"); code != 500 {
		t.Fatalf("takeover %d %v", code, body)
	}
	close(resume)
	if code := <-result; code != 503 {
		t.Fatalf("stale completion returned %d", code)
	}
	deletionCount(t, "SELECT count(*) FROM users WHERE id = 'target'", 1)
	deletionCount(t, "SELECT count(*) FROM account_deletion_attempts WHERE phase = 'irreversible'", 1)
	deletionCount(t, "SELECT count(*) FROM account_deletion_gates WHERE state = 'in_progress'", 1)
	deletionSQL(t, "UPDATE account_deletion_attempts SET lease_until = 0")
	start((&fakeClerkBackend{}).client(t))
	if code, body := request(true, ""); code != 200 {
		t.Fatalf("final recovery %d %v", code, body)
	}
	deletionCount(t, "SELECT count(*) FROM trial_grants WHERE user_id = 'target'", 1)
	deletionCount(t, "SELECT count(*) FROM account_deletion_gates WHERE state = 'deleted'", 1)
}

func TestDeletionRevalidatesTerminalEvidenceBeforeClerk(t *testing.T) {
	entered, resume := make(chan struct{}), make(chan struct{})
	defer resumeDeletion(resume)
	stripeServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(entered)
		<-resume
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"sub_live","status":"canceled"}`))
	}))
	defer stripeServer.Close()
	backend := stripeSDK.GetBackendWithConfig(stripeSDK.APIBackend, &stripeSDK.BackendConfig{URL: stripeSDK.String(stripeServer.URL), HTTPClient: stripeServer.Client()})
	sc := stripeSDK.NewClient("sk_test", stripeSDK.WithBackends(&stripeSDK.Backends{API: backend}))
	start, request := deletionRecoveryEnv(t, sc)
	deletionSQL(t, "INSERT INTO subscriptions (stripe_subscription_id, user_id, stripe_customer_id, status, created_at, updated_at) VALUES ('sub_ended', 'target', 'cus_1', 'canceled', 1, 1), ('sub_live', 'target', 'cus_1', 'active', 2, 2)")
	clerk := &fakeClerkBackend{}
	start(clerk.client(t))
	result := make(chan int, 1)
	go func() { code, _ := request(true, ""); result <- code }()
	<-entered
	deletionCount(t, "SELECT count(*) FROM account_deletion_gates WHERE state = 'in_progress'", 1)
	// Use the production snapshot writer to invalidate the terminal evidence
	// already read by deletion while Stripe supplies the other live answer.
	err := sqlitex.DB.Transaction(func(tx *gorm.DB) error {
		return repo.ApplySnapshot(tx, snapshot.Effects{SubscriptionID: "sub_ended", Known: true, Version: 1, State: eligibility.Live{Status: "active"}})
	})
	close(resume)
	if err != nil {
		t.Fatal(err)
	}
	if code := <-result; code != 503 {
		t.Fatalf("stale eligibility returned %d", code)
	}
	if len(clerk.recorded()) != 0 {
		t.Fatalf("stale eligibility deleted Clerk: %v", clerk.recorded())
	}
	deletionCount(t, "SELECT count(*) FROM users WHERE id = 'target'", 1)
	deletionCount(t, "SELECT count(*) FROM account_deletion_gates", 0)
}

func TestStaleEligibilityAttemptCannotReleaseItsReplacementGate(t *testing.T) {
	entered := make(chan int, 2)
	resume := []chan struct{}{make(chan struct{}), make(chan struct{})}
	var calls atomic.Int32
	stripeServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		i := int(calls.Add(1)) - 1
		entered <- i
		<-resume[i]
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"sub_live","status":"active"}`))
	}))
	defer stripeServer.Close()
	defer resumeDeletion(resume[0])
	defer resumeDeletion(resume[1])
	backend := stripeSDK.GetBackendWithConfig(stripeSDK.APIBackend, &stripeSDK.BackendConfig{URL: stripeSDK.String(stripeServer.URL), HTTPClient: stripeServer.Client()})
	start, request := deletionRecoveryEnv(t, stripeSDK.NewClient("sk_test", stripeSDK.WithBackends(&stripeSDK.Backends{API: backend})))
	deletionSQL(t, "INSERT INTO subscriptions (stripe_subscription_id, user_id, stripe_customer_id, status, created_at, updated_at) VALUES ('sub_live', 'target', 'cus_1', 'active', 1, 1)")
	clerk := &fakeClerkBackend{}
	start(clerk.client(t))
	first, second := make(chan int, 1), make(chan int, 1)
	go func() { code, _ := request(false, ""); first <- code }()
	<-entered
	deletionSQL(t, "UPDATE account_deletion_attempts SET lease_until = 0")
	go func() { code, _ := request(true, "?resetTrial=true"); second <- code }()
	<-entered
	close(resume[0])
	// Lost ownership is retryable; stale release must leave the replacement
	// owner's gate and original intent.
	if code := <-first; code != 503 {
		t.Fatalf("stale eligibility %d", code)
	}
	deletionCount(t, "SELECT count(*) FROM account_deletion_gates WHERE state = 'in_progress'", 1)
	deletionCount(t, "SELECT count(*) FROM account_deletion_attempts WHERE reset_trial = 0", 1)
	close(resume[1])
	if code := <-second; code != 409 {
		t.Fatalf("replacement eligibility %d", code)
	}
	deletionCount(t, "SELECT count(*) FROM account_deletion_gates", 0)
	if len(clerk.recorded()) != 0 {
		t.Fatalf("blocked attempts invoked Clerk: %v", clerk.recorded())
	}
}

func resumeDeletion(ch chan struct{}) {
	select {
	case <-ch:
	default:
		close(ch)
	}
}
