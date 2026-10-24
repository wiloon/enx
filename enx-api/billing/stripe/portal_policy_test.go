package stripe

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	stripeSDK "github.com/stripe/stripe-go/v86"
)

var testTierPrices = map[string]string{"pro": "price_pro", "pro-plus": "price_plus", "max": "price_max"}

// safePlanChangeJSON mirrors the sandbox default configuration that
// w10n-config's portal-config.py applies (ADR-067 §Portal 配置校验).
const safePlanChangeJSON = `{
  "id": "bpc_change", "object": "billing_portal.configuration", "active": true, "is_default": true,
  "features": {
    "invoice_history": {"enabled": true},
    "payment_method_update": {"enabled": true},
    "subscription_cancel": {"enabled": true, "mode": "at_period_end"},
    "subscription_update": {
      "enabled": true,
      "default_allowed_updates": ["price"],
      "proration_behavior": "always_invoice",
      "schedule_at_period_end": {"conditions": [{"type": "decreasing_item_amount"}]},
      "products": [
        {"product": "prod_pro", "prices": ["price_pro"], "adjustable_quantity": {"enabled": false}},
        {"product": "prod_plus", "prices": ["price_plus"], "adjustable_quantity": {"enabled": false}},
        {"product": "prod_max", "prices": ["price_max"], "adjustable_quantity": {"enabled": false}}
      ]
    }
  }
}`

const safeRestrictedJSON = `{
  "id": "bpc_restricted", "object": "billing_portal.configuration", "active": true,
  "metadata": {"enx_portal": "restricted"},
  "features": {
    "invoice_history": {"enabled": true},
    "payment_method_update": {"enabled": true},
    "subscription_cancel": {"enabled": true, "mode": "at_period_end"},
    "subscription_update": {"enabled": false}
  }
}`

func decodePortalConfiguration(t *testing.T, raw string) *stripeSDK.BillingPortalConfiguration {
	t.Helper()
	var cfg stripeSDK.BillingPortalConfiguration
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		t.Fatalf("decode configuration: %v", err)
	}
	return &cfg
}

func TestCheckPlanChangePortalConfiguration(t *testing.T) {
	cases := []struct {
		name    string
		old     string
		new     string
		wantErr bool
	}{
		{name: "the sandbox default is safe"},
		{name: "products listed in another order are safe",
			old: `{"product": "prod_pro", "prices": ["price_pro"], "adjustable_quantity": {"enabled": false}},
        {"product": "prod_plus", "prices": ["price_plus"], "adjustable_quantity": {"enabled": false}},`,
			new: `{"product": "prod_plus", "prices": ["price_plus"], "adjustable_quantity": {"enabled": false}},
        {"product": "prod_pro", "prices": ["price_pro"], "adjustable_quantity": {"enabled": false}},`},
		{name: "inactive", old: `"active": true`, new: `"active": false`, wantErr: true},
		{name: "plan switching off", old: `"enabled": true,
      "default_allowed_updates"`, new: `"enabled": false,
      "default_allowed_updates"`, wantErr: true},
		{name: "proration not always_invoice", old: `"always_invoice"`, new: `"create_prorations"`, wantErr: true},
		{name: "no period-end downgrade condition", old: `{"type": "decreasing_item_amount"}`, new: ``, wantErr: true},
		{name: "quantity updates allowed", old: `["price"]`, new: `["price", "quantity"]`, wantErr: true},
		{name: "promotion codes allowed", old: `["price"]`, new: `["price", "promotion_code"]`, wantErr: true},
		{name: "no price updates", old: `["price"]`, new: `[]`, wantErr: true},
		{name: "adjustable quantity on", old: `"prices": ["price_max"], "adjustable_quantity": {"enabled": false}`, new: `"prices": ["price_max"], "adjustable_quantity": {"enabled": true}`, wantErr: true},
		{name: "a product lists another tier's Price", old: `"prices": ["price_max"]`, new: `"prices": ["price_max", "price_pro"]`, wantErr: true},
		{name: "a product lists an extra Price", old: `"prices": ["price_max"]`, new: `"prices": ["price_max", "price_max_annual"]`, wantErr: true},
		{name: "a tier Price is missing", old: `,
        {"product": "prod_max", "prices": ["price_max"], "adjustable_quantity": {"enabled": false}}`, new: ``, wantErr: true},
		{name: "a Price outside ENX's tiers", old: `"prices": ["price_max"]`, new: `"prices": ["price_unknown"]`, wantErr: true},
		{name: "cancellation off", old: `"subscription_cancel": {"enabled": true`, new: `"subscription_cancel": {"enabled": false`, wantErr: true},
		{name: "immediate cancellation", old: `"mode": "at_period_end"`, new: `"mode": "immediately"`, wantErr: true},
		{name: "payment-method update off", old: `"payment_method_update": {"enabled": true}`, new: `"payment_method_update": {"enabled": false}`, wantErr: true},
		{name: "invoice history off", old: `"invoice_history": {"enabled": true}`, new: `"invoice_history": {"enabled": false}`, wantErr: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			raw := safePlanChangeJSON
			if tc.old != "" {
				if !strings.Contains(raw, tc.old) {
					t.Fatalf("test edit %q does not apply", tc.old)
				}
				raw = strings.Replace(raw, tc.old, tc.new, 1)
			}
			err := CheckPlanChangePortalConfiguration(decodePortalConfiguration(t, raw), testTierPrices)
			if tc.wantErr != errors.Is(err, ErrPortalConfigurationUnsafe) || (!tc.wantErr && err != nil) {
				t.Fatalf("got %v, want unsafe=%v", err, tc.wantErr)
			}
		})
	}

	t.Run("missing features", func(t *testing.T) {
		err := CheckPlanChangePortalConfiguration(decodePortalConfiguration(t, `{"id":"bpc_1","active":true}`), testTierPrices)
		if !errors.Is(err, ErrPortalConfigurationUnsafe) {
			t.Fatalf("got %v, want unsafe", err)
		}
	})
	t.Run("no configured tier Prices", func(t *testing.T) {
		err := CheckPlanChangePortalConfiguration(decodePortalConfiguration(t, safePlanChangeJSON), map[string]string{})
		if !errors.Is(err, ErrPortalConfigurationUnsafe) {
			t.Fatalf("got %v, want unsafe", err)
		}
	})
}

func TestCheckRestrictedPortalConfiguration(t *testing.T) {
	cases := []struct {
		name     string
		old, new string
		wantErr  bool
	}{
		{name: "switching off with cancel, payment method and invoices is safe"},
		{name: "inactive", old: `"active": true`, new: `"active": false`, wantErr: true},
		{name: "plan switching on", old: `"subscription_update": {"enabled": false}`, new: `"subscription_update": {"enabled": true}`, wantErr: true},
		{name: "cancellation off", old: `"subscription_cancel": {"enabled": true`, new: `"subscription_cancel": {"enabled": false`, wantErr: true},
		{name: "immediate cancellation", old: `"mode": "at_period_end"`, new: `"mode": "immediately"`, wantErr: true},
		{name: "payment-method update off", old: `"payment_method_update": {"enabled": true}`, new: `"payment_method_update": {"enabled": false}`, wantErr: true},
		{name: "invoice history off", old: `"invoice_history": {"enabled": true}`, new: `"invoice_history": {"enabled": false}`, wantErr: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			raw := safeRestrictedJSON
			if tc.old != "" {
				if !strings.Contains(raw, tc.old) {
					t.Fatalf("test edit %q does not apply", tc.old)
				}
				raw = strings.Replace(raw, tc.old, tc.new, 1)
			}
			err := CheckRestrictedPortalConfiguration(decodePortalConfiguration(t, raw))
			if tc.wantErr != errors.Is(err, ErrPortalConfigurationUnsafe) || (!tc.wantErr && err != nil) {
				t.Fatalf("got %v, want unsafe=%v", err, tc.wantErr)
			}
		})
	}
}
