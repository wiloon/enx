package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"enx-api/account"
	"enx-api/billing/eligibility"

	"github.com/gin-gonic/gin"
)

var (
	accountAlice = account.User{ID: "u-alice", ClerkUserID: "user_alice", Email: "alice@example.com", Status: account.StatusActive}
	accountAdmin = account.User{ID: "u-admin", ClerkUserID: "user_admin", Email: "admin@example.com", Status: account.StatusActive}
)

type accountUsers map[string]account.User

func (u accountUsers) Get(_ context.Context, id string) (account.User, bool, error) {
	user, ok := u[id]
	return user, ok, nil
}
func (accountUsers) SetStatus(context.Context, string, account.Status) error { return nil }
func (u accountUsers) DeleteData(_ context.Context, id string) error {
	delete(u, id)
	return nil
}

type accountGrants struct{}

func (accountGrants) Record(context.Context, string, string, time.Time) error { return nil }
func (accountGrants) Delete(context.Context, string) error                    { return nil }

type accountClerk struct{ err error }

func (c accountClerk) DeleteUser(context.Context, string) error     { return c.err }
func (c accountClerk) BanUser(context.Context, string) error        { return c.err }
func (c accountClerk) UnbanUser(context.Context, string) error      { return c.err }
func (c accountClerk) RevokeSessions(context.Context, string) error { return c.err }

type accountRenewing bool

func (r accountRenewing) Renewing(context.Context, string) (bool, error) { return bool(r), nil }

type accountAdmins []string

func (a accountAdmins) Contains(id string) bool {
	for _, x := range a {
		if x == id {
			return true
		}
	}
	return false
}

type deletionChecker struct {
	verdict eligibility.DeletionVerdict
	err     error
}

func (c deletionChecker) Check(context.Context, string) (eligibility.DeletionVerdict, error) {
	return c.verdict, c.err
}

type busyCoordinator struct{}

func (busyCoordinator) Acquire(context.Context, account.User, account.DeleteOptions, time.Time) (account.DeletionAttempt, error) {
	return account.DeletionAttempt{}, account.ErrDeletionInProgress
}
func (busyCoordinator) Prepare(context.Context, account.DeletionAttempt, string, time.Time) error {
	return nil
}
func (busyCoordinator) Release(context.Context, account.DeletionAttempt, time.Time) error {
	return nil
}
func (busyCoordinator) Complete(context.Context, account.DeletionAttempt, time.Time) error {
	return nil
}

// accountSetup tweaks the service an AccountHandler test runs against.
type accountSetup struct {
	noClerk     bool
	clerkErr    error
	renewing    bool
	checker     account.DeletionChecker
	coordinator account.DeletionCoordinator
}

func newAccountHandler(s accountSetup) *AccountHandler {
	var clerk account.Clerk = accountClerk{err: s.clerkErr}
	if s.noClerk {
		clerk = nil
	}
	svc := account.NewService(accountUsers{accountAlice.ID: accountAlice, accountAdmin.ID: accountAdmin},
		accountGrants{}, clerk, accountRenewing(s.renewing), accountAdmins{accountAdmin.ClerkUserID},
		account.NewEmailHMAC("test-key"), time.Now)
	if s.checker != nil {
		svc.WithDeletionChecker(s.checker)
	}
	if s.coordinator != nil {
		svc.WithDeletionCoordinator(s.coordinator)
	}
	return NewAccountHandler(svc)
}

type accountResponse struct {
	status     int
	retryAfter string
	body       struct {
		Success bool   `json:"success"`
		Code    string `json:"code"`
		Message string `json:"message"`
	}
}

func callAccount(t *testing.T, h gin.HandlerFunc, userID, targetID, body string) accountResponse {
	t.Helper()
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("user_id", userID)
	c.Params = gin.Params{{Key: "id", Value: targetID}}
	h(c)

	r := accountResponse{status: w.Code, retryAfter: w.Header().Get("Retry-After")}
	if err := json.Unmarshal(w.Body.Bytes(), &r.body); err != nil {
		t.Fatalf("response body %q: %v", w.Body.String(), err)
	}
	return r
}

func TestDeleteMeAnswersEachOutcomeWithItsStatusAndCode(t *testing.T) {
	for name, tc := range map[string]struct {
		setup  accountSetup
		userID string
		body   string
		status int
		code   string
	}{
		"deleted":               {userID: accountAlice.ID, body: `{"email":"alice@example.com"}`, status: http.StatusOK},
		"unreadable body":       {userID: accountAlice.ID, body: `not json`, status: http.StatusBadRequest, code: "email_mismatch"},
		"wrong email":           {userID: accountAlice.ID, body: `{"email":"bob@example.com"}`, status: http.StatusBadRequest, code: "email_mismatch"},
		"renewing subscription": {setup: accountSetup{renewing: true}, userID: accountAlice.ID, body: `{"email":"alice@example.com"}`, status: http.StatusConflict, code: "subscription_active"},
		"subscription conflict": {setup: accountSetup{checker: deletionChecker{verdict: eligibility.DeletionBlockedOpenConflict}}, userID: accountAlice.ID, body: `{"email":"alice@example.com"}`, status: http.StatusConflict, code: "subscription_conflict"},
		"protected admin":       {userID: accountAdmin.ID, body: `{"email":"admin@example.com"}`, status: http.StatusForbidden, code: "admin_account"},
		"unknown user":          {userID: "u-ghost", body: `{"email":"ghost@example.com"}`, status: http.StatusNotFound, code: "not_found"},
		"clerk not configured":  {setup: accountSetup{noClerk: true}, userID: accountAlice.ID, body: `{"email":"alice@example.com"}`, status: http.StatusServiceUnavailable, code: "not_configured"},
		"clerk fails":           {setup: accountSetup{clerkErr: errors.New("clerk down")}, userID: accountAlice.ID, body: `{"email":"alice@example.com"}`, status: http.StatusInternalServerError, code: "failed"},
	} {
		t.Run(name, func(t *testing.T) {
			r := callAccount(t, newAccountHandler(tc.setup).DeleteMe, tc.userID, "", tc.body)
			if r.status != tc.status || r.body.Code != tc.code || r.body.Success != (tc.status == http.StatusOK) {
				t.Fatalf("got %d %+v, want %d code %q", r.status, r.body, tc.status, tc.code)
			}
		})
	}
}

func TestBothDeletionRoutesAnswerABillingRefusalWithItsCodeAndMessage(t *testing.T) {
	routes := map[string]func(*AccountHandler) accountResponse{
		"own": func(h *AccountHandler) accountResponse {
			return callAccount(t, h.DeleteMe, accountAlice.ID, "", `{"email":"alice@example.com"}`)
		},
		"admin": func(h *AccountHandler) accountResponse {
			return callAccount(t, h.Delete, accountAdmin.ID, accountAlice.ID, "")
		},
	}
	for name, tc := range map[string]struct {
		checker deletionChecker
		status  int
		code    string
		message string
	}{
		"renewing subscription": {deletionChecker{verdict: eligibility.DeletionBlockedRenewing}, http.StatusConflict, "subscription_active",
			"Cancel your subscription on the Billing page before deleting your account."},
		"subscription conflict": {deletionChecker{verdict: eligibility.DeletionBlockedOpenConflict}, http.StatusConflict, "subscription_conflict",
			"Contact an administrator to resolve your subscription issue before deleting your account."},
		"live state unknown": {deletionChecker{verdict: eligibility.DeletionBlockedLookup}, http.StatusInternalServerError, "failed",
			"The account action failed. Try again."},
		"check fails": {deletionChecker{err: errors.New("database is locked")}, http.StatusInternalServerError, "failed",
			"The account action failed. Try again."},
	} {
		for route, call := range routes {
			t.Run(name+"/"+route, func(t *testing.T) {
				r := call(newAccountHandler(accountSetup{checker: tc.checker}))
				if r.status != tc.status || r.body.Success || r.body.Code != tc.code || r.body.Message != tc.message {
					t.Fatalf("got %d %+v, want %d code %q message %q", r.status, r.body, tc.status, tc.code, tc.message)
				}
			})
		}
	}
}

func TestADeletionThatGoesThroughAnswersWithoutCodeOrMessage(t *testing.T) {
	h := newAccountHandler(accountSetup{checker: deletionChecker{verdict: eligibility.DeletionAllowed}})
	r := callAccount(t, h.DeleteMe, accountAlice.ID, "", `{"email":"alice@example.com"}`)

	if r.status != http.StatusOK || !r.body.Success || r.body.Code != "" || r.body.Message != "" {
		t.Fatalf("got %d %+v, want 200 success with no code or message", r.status, r.body)
	}
}

func TestDeleteMeDuringAnotherDeletionAsksTheClientToRetry(t *testing.T) {
	h := newAccountHandler(accountSetup{coordinator: busyCoordinator{}})
	r := callAccount(t, h.DeleteMe, accountAlice.ID, "", `{"email":"alice@example.com"}`)

	if r.status != http.StatusServiceUnavailable || r.body.Code != "deletion_in_progress" || r.retryAfter != "60" {
		t.Fatalf("got %d %+v Retry-After %q, want 503 deletion_in_progress with Retry-After 60", r.status, r.body, r.retryAfter)
	}
}

// replacedCoordinator hands out an attempt that another owner takes over
// before it can be released.
type replacedCoordinator struct{ busyCoordinator }

func (replacedCoordinator) Acquire(_ context.Context, u account.User, _ account.DeleteOptions, _ time.Time) (account.DeletionAttempt, error) {
	return account.DeletionAttempt{UserID: u.ID, Owner: "first"}, nil
}
func (replacedCoordinator) Release(context.Context, account.DeletionAttempt, time.Time) error {
	return account.ErrDeletionInProgress
}

// A refusal whose release finds the gate taken over is still a deletion in
// progress: the client retries rather than reading the refusal as final.
func TestARefusalWhoseGateWasTakenOverAsksTheClientToRetry(t *testing.T) {
	h := newAccountHandler(accountSetup{
		checker:     deletionChecker{verdict: eligibility.DeletionBlockedRenewing},
		coordinator: replacedCoordinator{},
	})
	r := callAccount(t, h.DeleteMe, accountAlice.ID, "", `{"email":"alice@example.com"}`)

	if r.status != http.StatusServiceUnavailable || r.body.Code != "deletion_in_progress" || r.retryAfter != "60" {
		t.Fatalf("got %d %+v Retry-After %q, want 503 deletion_in_progress with Retry-After 60", r.status, r.body, r.retryAfter)
	}
}

// optionsCoordinator remembers the options a deletion was started with.
type optionsCoordinator struct {
	busyCoordinator
	got *account.DeleteOptions
}

func (o optionsCoordinator) Acquire(_ context.Context, _ account.User, opts account.DeleteOptions, _ time.Time) (account.DeletionAttempt, error) {
	*o.got = opts
	return account.DeletionAttempt{}, account.ErrDeletionInProgress
}

func TestAdminDeleteResetsTheTrialOnlyWhenAskedTo(t *testing.T) {
	for query, want := range map[string]bool{"": false, "?resetTrial=true": true, "?resetTrial=1": false} {
		var got account.DeleteOptions
		h := newAccountHandler(accountSetup{coordinator: optionsCoordinator{got: &got}})
		gin.SetMode(gin.TestMode)
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodDelete, "/"+query, nil)
		c.Set("user_id", accountAdmin.ID)
		c.Params = gin.Params{{Key: "id", Value: accountAlice.ID}}

		h.Delete(c)

		if got.ResetTrial != want {
			t.Errorf("%q: ResetTrial = %v, want %v", query, got.ResetTrial, want)
		}
	}
}

func TestAdminAccountActionsAnswerSuccessOrNotConfigured(t *testing.T) {
	actions := map[string]func(*AccountHandler) gin.HandlerFunc{
		"delete":          func(h *AccountHandler) gin.HandlerFunc { return h.Delete },
		"disable":         func(h *AccountHandler) gin.HandlerFunc { return h.Disable },
		"enable":          func(h *AccountHandler) gin.HandlerFunc { return h.Enable },
		"revoke sessions": func(h *AccountHandler) gin.HandlerFunc { return h.RevokeSessions },
	}
	for name, action := range actions {
		t.Run(name, func(t *testing.T) {
			if r := callAccount(t, action(newAccountHandler(accountSetup{})), accountAdmin.ID, accountAlice.ID, ""); r.status != http.StatusOK || !r.body.Success {
				t.Errorf("with Clerk: got %d %+v, want 200 success", r.status, r.body)
			}
			r := callAccount(t, action(newAccountHandler(accountSetup{noClerk: true})), accountAdmin.ID, accountAlice.ID, "")
			if r.status != http.StatusServiceUnavailable || r.body.Code != "not_configured" {
				t.Errorf("without Clerk: got %d %+v, want 503 not_configured", r.status, r.body)
			}
		})
	}
}

func TestAdminAccountActionsRefuseAProtectedAdmin(t *testing.T) {
	h := newAccountHandler(accountSetup{})
	for name, action := range map[string]gin.HandlerFunc{"delete": h.Delete, "disable": h.Disable} {
		t.Run(name, func(t *testing.T) {
			r := callAccount(t, action, accountAdmin.ID, accountAdmin.ID, "")
			if r.status != http.StatusForbidden || r.body.Code != "admin_account" {
				t.Fatalf("got %d %+v, want 403 admin_account", r.status, r.body)
			}
		})
	}
}
