package adapters

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"enx-api/utils/sqlitex"

	"github.com/glebarez/sqlite"
	stripeSDK "github.com/stripe/stripe-go/v86"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

func newSubscriptionsDB(t *testing.T) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: gormlogger.Default.LogMode(gormlogger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&sqlitex.Subscription{}); err != nil {
		t.Fatal(err)
	}
	prev := sqlitex.DB
	sqlitex.DB = db
	t.Cleanup(func() { sqlitex.DB = prev })
}

func seedSubscription(t *testing.T, userID, status, subID string) {
	t.Helper()
	row := sqlitex.Subscription{UserId: userID, StripeCustomerId: "cus_" + userID, Status: status, CreatedAt: 1, UpdatedAt: 1}
	if subID != "" {
		row.StripeSubscriptionId = &subID
	}
	if err := sqlitex.DB.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
}

// fakeStripe answers GET /v1/subscriptions/<id> from subs (id -> JSON fields)
// and counts the calls.
func fakeStripe(t *testing.T, subs map[string]string, calls *int) *stripeSDK.Client {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*calls++
		w.Header().Set("Content-Type", "application/json")
		id := strings.TrimPrefix(r.URL.Path, "/v1/subscriptions/")
		fields, ok := subs[id]
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":{"type":"invalid_request_error","code":"resource_missing"}}`))
			return
		}
		_, _ = w.Write([]byte(`{"id":"` + id + `","object":"subscription",` + fields + `}`))
	}))
	t.Cleanup(server.Close)
	backend := stripeSDK.GetBackendWithConfig(stripeSDK.APIBackend, &stripeSDK.BackendConfig{
		URL: stripeSDK.String(server.URL), HTTPClient: server.Client(), MaxNetworkRetries: stripeSDK.Int64(0),
	})
	return stripeSDK.NewClient("sk_test_sub", stripeSDK.WithBackends(&stripeSDK.Backends{API: backend}))
}

func TestSubscriptionsRenewing(t *testing.T) {
	newSubscriptionsDB(t)
	seedSubscription(t, "renews", "active", "sub_renews")
	seedSubscription(t, "canceling", "active", "sub_canceling")
	seedSubscription(t, "pastdue", "past_due", "sub_pastdue")
	seedSubscription(t, "ended", "canceled", "sub_ended")
	calls := 0
	subs := Subscriptions{Stripe: fakeStripe(t, map[string]string{
		"sub_renews":    `"status":"active","cancel_at_period_end":false`,
		"sub_canceling": `"status":"active","cancel_at_period_end":true`,
		"sub_pastdue":   `"status":"past_due","cancel_at_period_end":false`,
	}, &calls)}

	for user, want := range map[string]bool{
		"renews": true, "canceling": false, "pastdue": true, "ended": false, "never-subscribed": false,
	} {
		got, err := subs.Renewing(context.Background(), user)
		if err != nil || got != want {
			t.Errorf("%s: Renewing = %v, %v; want %v", user, got, err, want)
		}
	}
	if calls != 3 {
		t.Errorf("Stripe calls = %d, want 3 (none for an ended or missing subscription)", calls)
	}
}

func TestSubscriptionsWithoutStripeFailsForALiveSubscription(t *testing.T) {
	newSubscriptionsDB(t)
	seedSubscription(t, "renews", "active", "sub_renews")
	if _, err := (Subscriptions{}).Renewing(context.Background(), "renews"); err == nil {
		t.Fatal("Renewing without Stripe succeeded, want an error (cannot tell)")
	}
	if got, err := (Subscriptions{}).Renewing(context.Background(), "never-subscribed"); err != nil || got {
		t.Fatalf("no subscription without Stripe = %v, %v; want false, nil", got, err)
	}
}
