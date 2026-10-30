package billing

import (
	"enx-api/config"
	"enx-api/utils/sqlitex"
	"testing"
)

func testStripe() config.Stripe {
	stripe := config.Default().Stripe
	stripe.WebhookSecret = "whsec_test"
	return stripe
}

func seedSubscription(t *testing.T, userID, customerID, subscriptionID, status string, periodEnd int64) {
	t.Helper()
	for _, stmt := range []struct {
		sql  string
		args []any
	}{
		{"INSERT INTO subscriptions (user_id,stripe_customer_id,stripe_subscription_id,status,current_period_end,created_at,updated_at) VALUES (?,?,?,?,?,1,1)", []any{userID, customerID, subscriptionID, status, periodEnd}},
		{"INSERT INTO stripe_customers (user_id,stripe_customer_id,created_at) VALUES (?,?,1)", []any{userID, customerID}},
		{"UPDATE users SET accepted_subscription_id=? WHERE id=?", []any{subscriptionID, userID}},
	} {
		if err := sqlitex.DB.Exec(stmt.sql, stmt.args...).Error; err != nil {
			t.Fatal(err)
		}
	}
}
func seedTopupOnlyCustomer(t *testing.T, userID, customerID string) {
	t.Helper()
	if err := sqlitex.DB.Exec("INSERT INTO stripe_customers (stripe_customer_id,user_id,created_at) VALUES (?,?,1)", customerID, userID).Error; err != nil {
		t.Fatal(err)
	}
}
