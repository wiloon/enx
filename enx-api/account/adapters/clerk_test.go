package adapters

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// fakeClerkAPI answers the Backend API calls the client makes and records
// them as "METHOD path?query".
type fakeClerkAPI struct {
	mu       sync.Mutex
	calls    []string
	sessions string // the JSON GET /v1/sessions answers
	status   int    // when set, every call answers it
}

func (f *fakeClerkAPI) serve(t *testing.T) *Clerk {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if r.Header.Get("Authorization") != "Bearer sk_test_fake" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		call := r.Method + " " + r.URL.EscapedPath()
		if r.URL.RawQuery != "" {
			call += "?" + r.URL.RawQuery
		}
		f.calls = append(f.calls, call)
		if f.status != 0 {
			w.WriteHeader(f.status)
			_, _ = w.Write([]byte(`{"errors":[{"code":"resource_not_found","message":"not found"}]}`))
			return
		}
		if r.Method == http.MethodGet && r.URL.Path == "/v1/sessions" {
			_, _ = w.Write([]byte(f.sessions))
			return
		}
		_, _ = w.Write([]byte(`{}`))
	}))
	t.Cleanup(server.Close)
	c := NewClerk("sk_test_fake")
	c.BaseURL = server.URL + "/v1"
	c.HTTP = server.Client()
	return c
}

func TestClerkDeleteUser(t *testing.T) {
	f := &fakeClerkAPI{}
	if err := f.serve(t).DeleteUser(context.Background(), "user_1"); err != nil {
		t.Fatalf("DeleteUser: %v", err)
	}
	if strings.Join(f.calls, ",") != "DELETE /v1/users/user_1" {
		t.Fatalf("calls = %v", f.calls)
	}
}

func TestClerkDeleteUserThatIsAlreadyGoneSucceeds(t *testing.T) {
	f := &fakeClerkAPI{status: http.StatusNotFound}
	if err := f.serve(t).DeleteUser(context.Background(), "user_gone"); err != nil {
		t.Fatalf("DeleteUser of a missing user: %v, want nil", err)
	}
}

func TestClerkFailureIsAnError(t *testing.T) {
	f := &fakeClerkAPI{status: http.StatusInternalServerError}
	c := f.serve(t)
	for name, err := range map[string]error{
		"delete": c.DeleteUser(context.Background(), "user_1"),
		"ban":    c.BanUser(context.Background(), "user_1"),
		"unban":  c.UnbanUser(context.Background(), "user_1"),
		"revoke": c.RevokeSessions(context.Background(), "user_1"),
	} {
		if err == nil {
			t.Errorf("%s: no error on a 500", name)
		}
	}
}

func TestClerkBanAndUnban(t *testing.T) {
	f := &fakeClerkAPI{}
	c := f.serve(t)
	if err := c.BanUser(context.Background(), "user_1"); err != nil {
		t.Fatal(err)
	}
	if err := c.UnbanUser(context.Background(), "user_1"); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(f.calls, ","); got != "POST /v1/users/user_1/ban,POST /v1/users/user_1/unban" {
		t.Fatalf("calls = %s", got)
	}
}

func TestClerkRevokeSessionsRevokesEveryActiveSession(t *testing.T) {
	f := &fakeClerkAPI{sessions: `[{"id":"sess_a","status":"active"},{"id":"sess_b","status":"active"}]`}
	if err := f.serve(t).RevokeSessions(context.Background(), "user_1"); err != nil {
		t.Fatalf("RevokeSessions: %v", err)
	}
	want := "GET /v1/sessions?limit=500&status=active&user_id=user_1," +
		"POST /v1/sessions/sess_a/revoke,POST /v1/sessions/sess_b/revoke"
	if got := strings.Join(f.calls, ","); got != want {
		t.Fatalf("calls = %s\nwant    %s", got, want)
	}
}

func TestClerkRevokeSessionsReadsAPaginatedList(t *testing.T) {
	f := &fakeClerkAPI{sessions: `{"data":[{"id":"sess_a"}],"total_count":1}`}
	if err := f.serve(t).RevokeSessions(context.Background(), "user_1"); err != nil {
		t.Fatalf("RevokeSessions: %v", err)
	}
	if len(f.calls) != 2 || f.calls[1] != "POST /v1/sessions/sess_a/revoke" {
		t.Fatalf("calls = %v", f.calls)
	}
}

func TestClerkEscapesTheUserID(t *testing.T) {
	f := &fakeClerkAPI{}
	if err := f.serve(t).BanUser(context.Background(), "user/../x"); err != nil {
		t.Fatal(err)
	}
	if len(f.calls) != 1 || strings.Contains(f.calls[0], "/../") {
		t.Fatalf("calls = %v, want the id escaped", f.calls)
	}
}
