package repo

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"enx-api/billing/conflict"
	"enx-api/billing/conflictadmin"
	"enx-api/billing/webhookevent"
	"enx-api/utils/sqlitex"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

// newSubscriptionConflictDB opens a temporary database as the cutover leaves
// it: the legacy billing schema, with the rows of the named
// testdata/billing-legacy fixtures, migrated by MigrateSubscriptionOwnership,
// MigrateWebhookReceipts, MigrateCreditProvenance and MigrateDeletionGates.
func newSubscriptionConflictDB(t *testing.T, fixtures ...string) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "enx.db")), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	for _, name := range append([]string{"schema.sql"}, fixtures...) {
		raw, err := os.ReadFile(filepath.Join("../testdata/billing-legacy", name))
		if err != nil {
			t.Fatal(err)
		}
		var lines []string
		for _, line := range strings.Split(string(raw), "\n") {
			if !strings.HasPrefix(strings.TrimSpace(line), "--") {
				lines = append(lines, line)
			}
		}
		for _, stmt := range strings.Split(strings.Join(lines, "\n"), ";") {
			if stmt = strings.TrimSpace(stmt); stmt != "" {
				if err := db.Exec(stmt).Error; err != nil {
					t.Fatalf("legacy %s: %v", name, err)
				}
			}
		}
	}
	if _, err := sqlitex.MigrateSubscriptionOwnership(db); err != nil {
		t.Fatal(err)
	}
	if _, err := sqlitex.MigrateWebhookReceipts(db); err != nil {
		t.Fatal(err)
	}
	if _, err := sqlitex.MigrateCreditProvenance(db); err != nil {
		t.Fatal(err)
	}
	if _, err := sqlitex.MigrateDeletionGates(db); err != nil {
		t.Fatal(err)
	}
	prev := sqlitex.DB
	sqlitex.DB = db
	t.Cleanup(func() { sqlitex.DB = prev })
}

var discoveredT0 = time.Date(2026, 10, 23, 8, 0, 0, 0, time.UTC)

// subscriptionRow is a subscriptions row to seed. A conflict has
// classification conflict and a conflict status; the zero times are NULL.
type subscriptionRow struct {
	ID, UserID, CustomerID, Status, Classification string
	Version                                        int64
	Reason, With                                   string
	DiscoveredAt                                   time.Time
	ConflictStatus                                 conflict.Status
	ResolverID, Notes                              string
	ResolvedAt                                     time.Time
	SupportMessage                                 string
	SupportAt                                      time.Time
	ConflictAlertState                             string
}

func seedSubscription(t *testing.T, r subscriptionRow) {
	t.Helper()
	if r.Version == 0 {
		r.Version = 1
	}
	var owner any
	if r.UserID != "" {
		owner = r.UserID
	}
	if err := sqlitex.DB.Exec("INSERT INTO subscriptions (stripe_subscription_id, user_id, stripe_customer_id, status, plan, "+
		"classification, version, conflict_reason, conflict_with_subscription_id, conflict_discovered_at, conflict_status, "+
		"conflict_resolver_id, conflict_resolved_at, conflict_notes, support_message, support_at, conflict_alert_state, "+
		"created_at, updated_at) VALUES (?, ?, ?, ?, 'pro', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
		r.ID, owner, r.CustomerID, r.Status, r.Classification, r.Version, r.Reason, r.With,
		unixMilliOrNil(r.DiscoveredAt), string(r.ConflictStatus), r.ResolverID, unixMilliOrNil(r.ResolvedAt), r.Notes,
		r.SupportMessage, unixMilliOrNil(r.SupportAt), r.ConflictAlertState,
		discoveredT0.UnixMilli(), discoveredT0.UnixMilli()).Error; err != nil {
		t.Fatalf("seed subscription %s: %v", r.ID, err)
	}
}

// openConflict is an open conflict of user_1's sub_a discovered at.
func openConflict(id string, at time.Time) subscriptionRow {
	return subscriptionRow{
		ID: id, UserID: "user_1", CustomerID: "cus_" + id, Status: "active", Classification: "conflict",
		Reason: "second_live_subscription", With: "sub_a", DiscoveredAt: at, ConflictStatus: conflict.Open,
		ConflictAlertState: "pending",
	}
}

func seedConflicts(t *testing.T) {
	t.Helper()
	seedSubscription(t, subscriptionRow{ID: "sub_a", UserID: "user_1", CustomerID: "cus_a", Status: "active", Classification: "accepted"})
	seedSubscription(t, openConflict("sub_b", discoveredT0))
	resolved := openConflict("sub_c", discoveredT0.Add(time.Hour))
	resolved.ConflictStatus, resolved.ResolverID, resolved.ResolvedAt, resolved.Notes =
		conflict.Resolved, "admin_1", discoveredT0.Add(2*time.Hour), "Refunded sub_c in Stripe."
	seedSubscription(t, resolved)
	seedSubscription(t, openConflict("sub_d", discoveredT0.Add(3*time.Hour)))
}

func conflictIDs(cs []conflictadmin.Conflict) []string {
	ids := make([]string, len(cs))
	for i, c := range cs {
		ids[i] = c.SubscriptionID
	}
	return ids
}

func TestSubscriptionConflictsListConflictsPagesConflictsNewestDiscoveryFirst(t *testing.T) {
	newSubscriptionConflictDB(t)
	seedConflicts(t)
	store := SubscriptionConflicts{}
	ctx := context.Background()

	for _, tc := range []struct {
		q    conflict.ListQuery
		want []string
	}{
		{conflict.ListQuery{Limit: 50}, []string{"sub_d", "sub_c", "sub_b"}},
		{conflict.ListQuery{Status: conflict.Open, Limit: 50}, []string{"sub_d", "sub_b"}},
		{conflict.ListQuery{Status: conflict.Resolved, Limit: 50}, []string{"sub_c"}},
		{conflict.ListQuery{Limit: 1, Offset: 1}, []string{"sub_c"}},
	} {
		got, err := store.ListConflicts(ctx, tc.q)
		if err != nil {
			t.Fatalf("ListConflicts(%+v): %v", tc.q, err)
		}
		if ids := conflictIDs(got); !reflect.DeepEqual(ids, tc.want) {
			t.Errorf("ListConflicts(%+v) = %v, want %v", tc.q, ids, tc.want)
		}
	}

	got, err := store.ListConflicts(ctx, conflict.ListQuery{Status: conflict.Resolved, Limit: 50})
	if err != nil || len(got) != 1 {
		t.Fatalf("ListConflicts(resolved) = %v, %v", got, err)
	}
	want := conflictadmin.Conflict{
		SubscriptionID: "sub_c", AcceptedSubscriptionID: "sub_a", OwnerID: "user_1", CustomerID: "cus_sub_c",
		StripeStatus: "active", Reason: "second_live_subscription", DiscoveredAt: discoveredT0.Add(time.Hour),
		Resolution: conflict.Resolution{Status: conflict.Resolved, ResolverID: "admin_1",
			ResolvedAt: discoveredT0.Add(2 * time.Hour), Notes: "Refunded sub_c in Stripe."},
	}
	if !conflictEqual(got[0], want) {
		t.Errorf("listed conflict = %+v, want %+v", got[0], want)
	}
}

// conflictEqual compares instants, not time.Time representations.
func conflictEqual(a, b conflictadmin.Conflict) bool {
	if !a.DiscoveredAt.Equal(b.DiscoveredAt) || !a.Resolution.ResolvedAt.Equal(b.Resolution.ResolvedAt) || !a.Support.At.Equal(b.Support.At) {
		return false
	}
	a.DiscoveredAt, b.DiscoveredAt = time.Time{}, time.Time{}
	a.Resolution.ResolvedAt, b.Resolution.ResolvedAt = time.Time{}, time.Time{}
	a.Support.At, b.Support.At = time.Time{}, time.Time{}
	return a == b
}

func TestSubscriptionConflictsConflictReadsTheRowWithItsVersionAndSupportRequest(t *testing.T) {
	newSubscriptionConflictDB(t)
	row := openConflict("sub_b", discoveredT0)
	row.Version, row.SupportMessage, row.SupportAt = 4, "I was charged twice.", discoveredT0.Add(time.Hour)
	seedSubscription(t, row)

	got, err := SubscriptionConflicts{}.Conflict(context.Background(), "sub_b")

	if err != nil {
		t.Fatalf("Conflict: %v", err)
	}
	want := conflictadmin.Conflict{
		SubscriptionID: "sub_b", AcceptedSubscriptionID: "sub_a", OwnerID: "user_1", CustomerID: "cus_sub_b",
		StripeStatus: "active", Reason: "second_live_subscription", DiscoveredAt: discoveredT0,
		Resolution: conflict.Resolution{Status: conflict.Open},
		Support:    conflict.Support{Message: "I was charged twice.", At: discoveredT0.Add(time.Hour)},
	}
	if got.Version != 4 || !conflictEqual(got.Conflict, want) {
		t.Errorf("Conflict = %+v, want version 4 and %+v", got, want)
	}
}

func TestSubscriptionConflictsConflictOfAnUnknownOrNonConflictSubscriptionIsNotFound(t *testing.T) {
	newSubscriptionConflictDB(t)
	seedSubscription(t, subscriptionRow{ID: "sub_a", UserID: "user_1", CustomerID: "cus_a", Status: "active", Classification: "accepted"})

	for _, id := range []string{"sub_missing", "sub_a"} {
		if _, err := (SubscriptionConflicts{}).Conflict(context.Background(), id); !errors.Is(err, conflictadmin.ErrNotFound) {
			t.Errorf("Conflict(%s) = %v, want conflictadmin.ErrNotFound", id, err)
		}
	}
}

// receiveSubscriptionEvent records a delivery of an eventType event that
// references subscriptionID.
func receiveSubscriptionEvent(t *testing.T, deliveryID, eventID, eventType, subscriptionID string, at time.Time) {
	t.Helper()
	d := paidInvoiceDelivery(deliveryID, eventScope(eventID), at)
	d.Receipt.Envelope.Type = eventType
	d.Receipt.Refs.SubscriptionID = subscriptionID
	if err := (WebhookReceipts{}).Record(context.Background(), d, webhookevent.NewTask(eventType, subscriptionID, at)); err != nil {
		t.Fatalf("Record %s: %v", deliveryID, err)
	}
}

func TestSubscriptionConflictsEventsReadsEveryEventOfTheSubscriptionWithAllItsDeliveries(t *testing.T) {
	newSubscriptionConflictDB(t)
	seedSubscription(t, openConflict("sub_b", discoveredT0))
	receiveSubscriptionEvent(t, "dlv_paid", "evt_paid", "invoice.paid", "sub_b", discoveredT0.Add(time.Minute))
	receiveSubscriptionEvent(t, "dlv_created", "evt_created", "customer.subscription.created", "sub_b", discoveredT0)
	receiveSubscriptionEvent(t, "dlv_paid_again", "evt_paid", "invoice.paid", "sub_b", discoveredT0.Add(time.Hour))
	receiveSubscriptionEvent(t, "dlv_other", "evt_other", "invoice.paid", "sub_a", discoveredT0.Add(2*time.Minute))
	setEventStatus(t, eventScope("evt_paid"), webhookevent.Processed)

	got, err := SubscriptionConflicts{}.Events(context.Background(), "sub_b")

	if err != nil {
		t.Fatalf("Events: %v", err)
	}
	want := []conflictadmin.Event{
		{EventID: "evt_created", Type: "customer.subscription.created", Status: webhookevent.Pending,
			Deliveries: []conflictadmin.Delivery{{ID: "dlv_created", ReceivedAt: discoveredT0}}},
		{EventID: "evt_paid", Type: "invoice.paid", Status: webhookevent.Processed,
			Deliveries: []conflictadmin.Delivery{
				{ID: "dlv_paid", ReceivedAt: discoveredT0.Add(time.Minute)},
				{ID: "dlv_paid_again", ReceivedAt: discoveredT0.Add(time.Hour)},
			}},
	}
	if !conflictEventsEqual(got, want) {
		t.Errorf("Events = %+v, want %+v: sub_b's events, oldest receipt first, each with every delivery oldest first", got, want)
	}
}

// conflictEventsEqual compares delivery instants, not time.Time
// representations.
func conflictEventsEqual(a, b []conflictadmin.Event) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if len(a[i].Deliveries) != len(b[i].Deliveries) {
			return false
		}
		for j := range a[i].Deliveries {
			da, db := a[i].Deliveries[j], b[i].Deliveries[j]
			if da.ID != db.ID || !da.ReceivedAt.Equal(db.ReceivedAt) {
				return false
			}
		}
		ea, eb := a[i], b[i]
		ea.Deliveries, eb.Deliveries = nil, nil
		if !reflect.DeepEqual(ea, eb) {
			return false
		}
	}
	return true
}

func conflictAlertState(t *testing.T, subscriptionID string) string {
	t.Helper()
	var state string
	if err := sqlitex.DB.Raw("SELECT conflict_alert_state FROM subscriptions WHERE stripe_subscription_id = ?", subscriptionID).
		Scan(&state).Error; err != nil {
		t.Fatal(err)
	}
	return state
}

func TestSubscriptionConflictsSaveResolutionWritesOnlyTheResolutionAtTheVersionRead(t *testing.T) {
	newSubscriptionConflictDB(t)
	row := openConflict("sub_b", discoveredT0)
	row.Version, row.SupportMessage, row.SupportAt = 3, "I was charged twice.", discoveredT0.Add(time.Hour)
	seedSubscription(t, row)
	ctx := context.Background()
	store := SubscriptionConflicts{}
	res := conflict.Resolution{Status: conflict.Resolved, ResolverID: "admin_1", ResolvedAt: discoveredT0.Add(2 * time.Hour), Notes: "Refunded in Stripe."}

	if err := store.SaveResolution(ctx, conflictadmin.ResolutionSave{SubscriptionID: "sub_b", Version: 3, Resolution: res}); err != nil {
		t.Fatalf("SaveResolution: %v", err)
	}

	got, err := store.Conflict(ctx, "sub_b")
	if err != nil {
		t.Fatalf("Conflict: %v", err)
	}
	want := conflictadmin.Conflict{
		SubscriptionID: "sub_b", AcceptedSubscriptionID: "sub_a", OwnerID: "user_1", CustomerID: "cus_sub_b",
		StripeStatus: "active", Reason: "second_live_subscription", DiscoveredAt: discoveredT0, Resolution: res,
		Support: conflict.Support{Message: "I was charged twice.", At: discoveredT0.Add(time.Hour)},
	}
	if got.Version == 3 || !conflictEqual(got.Conflict, want) {
		t.Errorf("after the save = %+v, want a new version and %+v", got, want)
	}
	if state := conflictAlertState(t, "sub_b"); state != "pending" {
		t.Errorf("conflict alert = %q after the resolution, want still pending", state)
	}

	other := res
	other.Notes = "Cancelled in Stripe."
	if err := store.SaveResolution(ctx, conflictadmin.ResolutionSave{SubscriptionID: "sub_b", Version: 3, Resolution: other}); !errors.Is(err, conflictadmin.ErrStale) {
		t.Fatalf("SaveResolution at the old version = %v, want conflictadmin.ErrStale", err)
	}
	again, err := store.Conflict(ctx, "sub_b")
	if err != nil {
		t.Fatalf("Conflict: %v", err)
	}
	if again.Version != got.Version || again.Conflict.Resolution.Notes != res.Notes {
		t.Errorf("after the stale save = %+v, want unchanged %+v", again, got)
	}
}

func seedBillingOwner(t *testing.T, userID string, billingVersion int64) {
	t.Helper()
	if err := sqlitex.DB.Exec("INSERT INTO users (id, billing_version) VALUES (?, ?)", userID, billingVersion).Error; err != nil {
		t.Fatalf("seed user %s: %v", userID, err)
	}
}

func ownerBillingVersion(t *testing.T, userID string) int64 {
	t.Helper()
	var v int64
	if err := sqlitex.DB.Raw("SELECT billing_version FROM users WHERE id = ?", userID).Scan(&v).Error; err != nil {
		t.Fatal(err)
	}
	return v
}

// A resolution changes the owner's purchase eligibility, so a decision
// that read the owner before it must not apply after it.
func TestSubscriptionConflictsSaveResolutionMovesTheOwnersBillingRevisionOn(t *testing.T) {
	newSubscriptionConflictDB(t)
	seedBillingOwner(t, "user_1", 7)
	seedBillingOwner(t, "user_2", 4)
	seedSubscription(t, openConflict("sub_b", discoveredT0))
	ctx := context.Background()
	store := SubscriptionConflicts{}
	res := conflict.Resolution{Status: conflict.Resolved, ResolverID: "admin_1", ResolvedAt: discoveredT0.Add(2 * time.Hour), Notes: "Refunded in Stripe."}

	if err := store.SaveResolution(ctx, conflictadmin.ResolutionSave{SubscriptionID: "sub_b", Version: 1, Resolution: res}); err != nil {
		t.Fatalf("SaveResolution: %v", err)
	}
	if v := ownerBillingVersion(t, "user_1"); v != 8 {
		t.Errorf("owner's billing_version = %d after the resolution, want 8", v)
	}
	if v := ownerBillingVersion(t, "user_2"); v != 4 {
		t.Errorf("another user's billing_version = %d, want unchanged 4", v)
	}
	saved, err := store.Conflict(ctx, "sub_b")
	if err != nil {
		t.Fatalf("Conflict: %v", err)
	}

	other := res
	other.Notes = "Cancelled in Stripe."
	if err := store.SaveResolution(ctx, conflictadmin.ResolutionSave{SubscriptionID: "sub_b", Version: 1, Resolution: other}); !errors.Is(err, conflictadmin.ErrStale) {
		t.Fatalf("SaveResolution at the old version = %v, want conflictadmin.ErrStale", err)
	}
	if v := ownerBillingVersion(t, "user_1"); v != 8 {
		t.Errorf("owner's billing_version = %d after a stale save, want unchanged 8", v)
	}
	after, err := store.Conflict(ctx, "sub_b")
	if err != nil {
		t.Fatalf("Conflict: %v", err)
	}
	if after.Version != saved.Version || after.Conflict.Resolution.Notes != res.Notes {
		t.Errorf("after the stale save = %+v, want unchanged %+v", after, saved)
	}
}

func TestSubscriptionConflictsAnAdministratorsResolutionStandsAndARepeatChangesNothing(t *testing.T) {
	newSubscriptionConflictDB(t)
	seedSubscription(t, openConflict("sub_b", discoveredT0))
	ctx := context.Background()
	resolvedAt := discoveredT0.Add(2 * time.Hour)
	svc := conflictadmin.New(SubscriptionConflicts{}, func() time.Time { return resolvedAt })
	req := conflict.ResolveRequest{Status: "resolved", Notes: "Refunded in Stripe."}

	if _, err := svc.Resolve(ctx, "admin_1", "sub_b", req); err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	first, err := SubscriptionConflicts{}.Conflict(ctx, "sub_b")
	if err != nil {
		t.Fatalf("Conflict: %v", err)
	}
	want := conflict.Resolution{Status: conflict.Resolved, ResolverID: "admin_1", ResolvedAt: resolvedAt, Notes: "Refunded in Stripe."}
	if r := first.Conflict.Resolution; r.Status != want.Status || r.ResolverID != want.ResolverID || !r.ResolvedAt.Equal(want.ResolvedAt) || r.Notes != want.Notes {
		t.Errorf("stored resolution = %+v, want %+v", r, want)
	}

	if _, err := svc.Resolve(ctx, "admin_2", "sub_b", req); err != nil {
		t.Fatalf("repeated Resolve: %v", err)
	}
	if _, err := svc.Resolve(ctx, "admin_2", "sub_b", conflict.ResolveRequest{Status: "resolved", Notes: "Something else."}); !errors.Is(err, conflict.ErrResolutionDiffers) {
		t.Errorf("Resolve with other notes = %v, want conflict.ErrResolutionDiffers", err)
	}
	after, err := SubscriptionConflicts{}.Conflict(ctx, "sub_b")
	if err != nil {
		t.Fatalf("Conflict: %v", err)
	}
	if after.Version != first.Version || after.Conflict.Resolution.ResolverID != "admin_1" {
		t.Errorf("after the repeats = %+v, want unchanged %+v", after, first)
	}
	if _, err := svc.Resolve(ctx, "admin_1", "sub_missing", req); !errors.Is(err, conflictadmin.ErrNotFound) {
		t.Errorf("Resolve of an unknown subscription = %v, want conflictadmin.ErrNotFound", err)
	}
}
