package invoice

import (
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// Sandbox Price IDs in billing/testdata/stripe-plan-change.
const (
	pricePro     = "price_1UTxL2D98PEpzR2E1f73d4Ln"
	priceProPlus = "price_1UTxL2D98PEpzR2E4lt7hGCN"
	priceMax     = "price_1UTxL2D98PEpzR2EokCgl4jd"
	sandboxSub   = "sub_1UU03ID98PEpzR2EJ2kjpqD1"
)

var sandboxTiers = map[string]string{pricePro: "pro", priceProPlus: "pro-plus", priceMax: "max"}

func loadFixture(t *testing.T, name string) Invoice {
	t.Helper()
	payload, err := os.ReadFile(filepath.Join("..", "testdata", "stripe-plan-change", name))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	inv, err := DecodeEvent(payload)
	if err != nil {
		t.Fatalf("decode %s: %v", name, err)
	}
	return inv
}

func TestClassifySandboxInvoices(t *testing.T) {
	cases := []struct {
		fixture string
		want    Classification
	}{
		{"02-invoice.paid-subscription_create.json", Classification{
			Kind: PeriodGrant, SubscriptionID: sandboxSub, SubscriptionItemID: "si_VV03M7jaX9ltGc",
			Tier: "pro", Period: Period{Start: 1792829501, End: 1795507901},
		}},
		{"03-invoice.paid-subscription_update.json", Classification{
			Kind: UpgradeTopUp, SubscriptionID: sandboxSub, SubscriptionItemID: "si_VV03M7jaX9ltGc",
			FromTier: "pro", Tier: "pro-plus", Period: Period{Start: 1793693501, End: 1795507901},
		}},
		// The second upgrade in one period leaves Pro+, not Pro.
		{"05-invoice.paid-subscription_update.json", Classification{
			Kind: UpgradeTopUp, SubscriptionID: sandboxSub, SubscriptionItemID: "si_VV03M7jaX9ltGc",
			FromTier: "pro-plus", Tier: "max", Period: Period{Start: 1794125501, End: 1795507901},
		}},
		// The first renewal after a scheduled downgrade grants the lower tier
		// for the line's period; invoice.period_* is the previous period.
		{"15-invoice.paid-subscription_cycle.json", Classification{
			Kind: PeriodGrant, SubscriptionID: sandboxSub, SubscriptionItemID: "si_VV05qXkUm7tzkT",
			Tier: "pro", Period: Period{Start: 1795507901, End: 1798099901},
		}},
	}
	for _, tc := range cases {
		t.Run(tc.fixture, func(t *testing.T) {
			inv := loadFixture(t, tc.fixture)
			if got := Classify(inv, sandboxTiers); got != tc.want {
				t.Fatalf("got %+v, want %+v", got, tc.want)
			}
		})
	}
}

func TestClassifyUpgradeIgnoresLineOrder(t *testing.T) {
	inv := loadFixture(t, "03-invoice.paid-subscription_update.json")
	want := Classify(inv, sandboxTiers)
	slices.Reverse(inv.Lines)
	if got := Classify(inv, sandboxTiers); got != want {
		t.Fatalf("reversed lines: got %+v, want %+v", got, want)
	}
}

// A Subscription Schedule phase change may bill a full period under
// subscription_update; with no proration line it is a normal grant.
func TestClassifyScheduleRenewalUnderSubscriptionUpdateIsAPeriodGrant(t *testing.T) {
	inv := loadFixture(t, "15-invoice.paid-subscription_cycle.json")
	inv.BillingReason = "subscription_update"
	got := Classify(inv, sandboxTiers)
	if got.Kind != PeriodGrant || got.Tier != "pro" || got.Period != (Period{Start: 1795507901, End: 1798099901}) {
		t.Fatalf("got %+v, want a Pro period grant for the line's period", got)
	}
}

func TestClassifySendsUnclearInvoicesToAttention(t *testing.T) {
	cases := []struct {
		name    string
		fixture string
		edit    func(*Invoice)
		reason  string
	}{
		{"missing billing reason", "02-invoice.paid-subscription_create.json", func(i *Invoice) { i.BillingReason = "" }, ReasonUnsupportedBillingReason},
		{"manual invoice", "02-invoice.paid-subscription_create.json", func(i *Invoice) { i.BillingReason = "manual" }, ReasonUnsupportedBillingReason},
		{"unknown Price on a period grant", "02-invoice.paid-subscription_create.json", func(i *Invoice) { i.Lines[0].PriceID = "price_dashboard_mistake" }, ReasonUnknownPrice},
		{"unknown Price on an upgrade", "03-invoice.paid-subscription_update.json", func(i *Invoice) { i.Lines[1].PriceID = "price_dashboard_mistake" }, ReasonUnknownPrice},
		{"paginated lines", "03-invoice.paid-subscription_update.json", func(i *Invoice) { i.LinesComplete = false }, ReasonLinesIncomplete},
		{"no lines", "02-invoice.paid-subscription_create.json", func(i *Invoice) { i.Lines = nil }, ReasonAmbiguousLines},
		{"two recurring lines", "02-invoice.paid-subscription_create.json", func(i *Invoice) { i.Lines = append(i.Lines, i.Lines[0]) }, ReasonAmbiguousLines},
		{"a proration line on a cycle invoice", "15-invoice.paid-subscription_cycle.json", func(i *Invoice) {
			l := i.Lines[0]
			l.Proration = true
			i.Lines = append(i.Lines, l)
		}, ReasonAmbiguousLines},
		{"an upgrade with only one proration line", "03-invoice.paid-subscription_update.json", func(i *Invoice) { i.Lines = i.Lines[1:] }, ReasonAmbiguousLines},
		{"an upgrade with a recurring line too", "03-invoice.paid-subscription_update.json", func(i *Invoice) {
			l := i.Lines[1]
			l.Proration = false
			i.Lines = append(i.Lines, l)
		}, ReasonAmbiguousLines},
		{"two positive proration lines", "03-invoice.paid-subscription_update.json", func(i *Invoice) { i.Lines[0].Amount = 270 }, ReasonAmbiguousLines},
		{"a zero proration line", "03-invoice.paid-subscription_update.json", func(i *Invoice) { i.Lines[0].Amount = 0 }, ReasonAmbiguousLines},
		{"lines on two subscription items", "03-invoice.paid-subscription_update.json", func(i *Invoice) { i.Lines[0].SubscriptionItemID = "si_other" }, ReasonAmbiguousLines},
		{"a line for another subscription", "02-invoice.paid-subscription_create.json", func(i *Invoice) { i.Lines[0].SubscriptionID = "sub_other" }, ReasonAmbiguousLines},
		{"a line that is no subscription item", "02-invoice.paid-subscription_create.json", func(i *Invoice) { i.Lines[0].SubscriptionItemID = "" }, ReasonAmbiguousLines},
		{"no subscription", "02-invoice.paid-subscription_create.json", func(i *Invoice) { i.SubscriptionID = "" }, ReasonAmbiguousLines},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			inv := loadFixture(t, tc.fixture)
			tc.edit(&inv)
			got := Classify(inv, sandboxTiers)
			if got.Kind != NeedsAttention || got.Reason != tc.reason {
				t.Fatalf("got %+v, want needs attention with reason %s", got, tc.reason)
			}
		})
	}
}

func TestDecodeEventRefusesUnsupportedVersionsAndOtherObjects(t *testing.T) {
	payload, err := os.ReadFile(filepath.Join("..", "testdata", "stripe-plan-change", "02-invoice.paid-subscription_create.json"))
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, old, new string
		want           error
	}{
		{"an unsupported API version", `"api_version": "2026-07-29.dahlia"`, `"api_version": "2025-03-31.basil"`, ErrUnsupportedAPIVersion},
		{"no API version", `"api_version": "2026-07-29.dahlia"`, `"api_version": null`, ErrUnsupportedAPIVersion},
		{"not an invoice event", `"type": "invoice.paid"`, `"type": "customer.subscription.updated"`, ErrNotAnInvoiceEvent},
	} {
		t.Run(tc.name, func(t *testing.T) {
			edited := []byte(replaceOnce(t, string(payload), tc.old, tc.new))
			if _, err := DecodeEvent(edited); !errors.Is(err, tc.want) {
				t.Fatalf("got %v, want %v", err, tc.want)
			}
		})
	}

	t.Run("the SDK's pinned version decodes", func(t *testing.T) {
		edited := []byte(replaceOnce(t, string(payload), `"api_version": "2026-07-29.dahlia"`, `"api_version": "2026-08-26.dahlia"`))
		inv, err := DecodeEvent(edited)
		if err != nil || inv.ID != "in_1UU03ID98PEpzR2EMP53Agf8" || len(inv.Lines) != 1 {
			t.Fatalf("got %+v, %v", inv, err)
		}
	})
}

func TestDecodeEventReadsThePaymentAndItsTrustedOwner(t *testing.T) {
	payload, err := os.ReadFile(filepath.Join("..", "testdata", "stripe-plan-change", "02-invoice.paid-subscription_create.json"))
	if err != nil {
		t.Fatal(err)
	}

	t.Run("a Sandbox invoice without ENX metadata", func(t *testing.T) {
		inv, err := DecodeEvent(payload)
		if err != nil {
			t.Fatal(err)
		}
		if inv.CustomerID != "cus_VV03wKkovxzzTP" || inv.AmountPaid != 399 || inv.MetadataUserID != "" {
			t.Fatalf("got customer %q, amount paid %d, metadata user %q; want cus_VV03wKkovxzzTP, 399 and none", inv.CustomerID, inv.AmountPaid, inv.MetadataUserID)
		}
	})

	t.Run("the subscription metadata snapshot names the ENX user", func(t *testing.T) {
		edited := []byte(replaceOnce(t, string(payload),
			"\"subscription_details\": {\n          \"metadata\": {\n            \"enx_experiment\": \"297\"",
			"\"subscription_details\": {\n          \"metadata\": {\n            \"enx_user_id\": \"user_1\""))
		inv, err := DecodeEvent(edited)
		if err != nil {
			t.Fatal(err)
		}
		if inv.MetadataUserID != "user_1" {
			t.Fatalf("metadata user = %q, want user_1", inv.MetadataUserID)
		}
	})

	t.Run("line metadata is not the subscription's", func(t *testing.T) {
		edited := []byte(replaceOnce(t, string(payload),
			"\"metadata\": {\n              \"enx_experiment\": \"297\"",
			"\"metadata\": {\n              \"enx_user_id\": \"user_1\""))
		inv, err := DecodeEvent(edited)
		if err != nil {
			t.Fatal(err)
		}
		if inv.MetadataUserID != "" {
			t.Fatalf("metadata user = %q, want none", inv.MetadataUserID)
		}
	})
}

// ADR-067: floor((new - old) * remaining share), the share being the
// positive proration line's period over the stored normal grant's period.
func TestUpgradeTopUpCredits(t *testing.T) {
	grant := Period{Start: 1792829501, End: 1795507901} // fixture 02, 31 days
	t.Run("Pro to Pro+ with 21 of 31 days left", func(t *testing.T) {
		got, err := UpgradeTopUpCredits(500, 1500, Period{Start: 1793693501, End: 1795507901}, grant)
		if err != nil || got != 677 {
			t.Fatalf("got %d, %v; want 677", got, err)
		}
	})
	t.Run("Pro+ to Max with 16 of 31 days left, over the same denominator", func(t *testing.T) {
		got, err := UpgradeTopUpCredits(1500, 4000, Period{Start: 1794125501, End: 1795507901}, grant)
		if err != nil || got != 1290 {
			t.Fatalf("got %d, %v; want 1290", got, err)
		}
	})
	t.Run("a line longer than the period is clamped to the whole difference", func(t *testing.T) {
		got, err := UpgradeTopUpCredits(500, 1500, Period{Start: grant.Start - (grant.End - grant.Start), End: grant.End}, grant)
		if err != nil || got != 1000 {
			t.Fatalf("got %d, %v; want 1000", got, err)
		}
	})
	t.Run("a line that starts after it ends adds nothing", func(t *testing.T) {
		got, err := UpgradeTopUpCredits(500, 1500, Period{Start: grant.End + (grant.End - grant.Start), End: grant.End}, grant)
		if err != nil || got != 0 {
			t.Fatalf("got %d, %v; want 0", got, err)
		}
	})
	t.Run("an empty line adds nothing", func(t *testing.T) {
		got, err := UpgradeTopUpCredits(500, 1500, Period{Start: grant.End, End: grant.End}, grant)
		if err != nil || got != 0 {
			t.Fatalf("got %d, %v; want 0", got, err)
		}
	})
	t.Run("a new tier that is not higher is refused", func(t *testing.T) {
		for _, to := range []int64{500, 400} {
			if _, err := UpgradeTopUpCredits(500, to, Period{Start: 1793693501, End: 1795507901}, grant); !errors.Is(err, ErrUpgradeNotHigher) {
				t.Fatalf("to=%d: got %v, want ErrUpgradeNotHigher", to, err)
			}
		}
	})
	t.Run("a grant for another period is refused", func(t *testing.T) {
		if _, err := UpgradeTopUpCredits(500, 1500, Period{Start: 1795507901 + 10, End: 1798099901}, grant); !errors.Is(err, ErrGrantPeriodMismatch) {
			t.Fatalf("got %v, want ErrGrantPeriodMismatch", err)
		}
	})
	t.Run("an empty grant period is refused", func(t *testing.T) {
		if _, err := UpgradeTopUpCredits(500, 1500, Period{Start: 5, End: 10}, Period{Start: 10, End: 10}); !errors.Is(err, ErrGrantPeriodMismatch) {
			t.Fatalf("got %v, want ErrGrantPeriodMismatch", err)
		}
	})
}

func replaceOnce(t *testing.T, s, old, new string) string {
	t.Helper()
	if !strings.Contains(s, old) {
		t.Fatalf("test edit %q does not apply", old)
	}
	return strings.Replace(s, old, new, 1)
}
