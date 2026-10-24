package stripe

import (
	"context"
	"net/http"
	"reflect"
	"testing"

	"enx-api/billing/eligibility"
	"enx-api/billing/snapshot"
)

func subscriptionObject(itemsHasMore string) string {
	return `{"id":"sub_1","object":"subscription","status":"active","customer":"cus_1",` +
		`"cancel_at":1795507901,"cancel_at_period_end":false,` +
		`"pending_update":{"expires_at":1792900000,"subscription_items":[]},` +
		`"schedule":"sub_sched_1",` +
		`"items":{"object":"list","url":"/v1/subscription_items?subscription=sub_1","has_more":` + itemsHasMore + `,"data":[` +
		`{"id":"si_1","object":"subscription_item","current_period_start":1792829501,"current_period_end":1795507901,` +
		`"price":{"id":"price_max","object":"price"}}]}}`
}

func TestSubscriptionSnapshotReadsTheLiveState(t *testing.T) {
	sc := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/subscriptions/sub_1" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(subscriptionObject("false")))
	})

	got, err := SubscriptionSnapshot(context.Background(), sc, "sub_1")
	if err != nil {
		t.Fatalf("SubscriptionSnapshot: %v", err)
	}
	want := snapshot.Live{
		Live: eligibility.Live{
			Status: "active", CancelAt: 1795507901, CurrentPeriodEnd: 1795507901,
			PendingUpdate: true, HasSchedule: true,
		},
		CustomerID: "cus_1", PriceIDs: []string{"price_max"}, ItemsComplete: true,
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("SubscriptionSnapshot = %+v, want %+v", got, want)
	}
}

func TestSubscriptionSnapshotReportsItemsStripeDidNotReturn(t *testing.T) {
	sc := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(subscriptionObject("true")))
	})

	got, err := SubscriptionSnapshot(context.Background(), sc, "sub_1")
	if err != nil {
		t.Fatalf("SubscriptionSnapshot: %v", err)
	}
	if got.ItemsComplete {
		t.Errorf("ItemsComplete = true with has_more items, want false")
	}
}

func TestSubscriptionSnapshotReturnsAMissingSubscriptionAsAnError(t *testing.T) {
	sc := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error":{"type":"invalid_request_error","code":"resource_missing","message":"No such subscription: 'sub_1'"}}`))
	})

	if _, err := SubscriptionSnapshot(context.Background(), sc, "sub_1"); err == nil {
		t.Error("SubscriptionSnapshot of a missing subscription returned no error")
	}
}
