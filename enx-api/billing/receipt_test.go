package billing

import (
	"bytes"
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	billingstripe "enx-api/billing/stripe"
	"enx-api/billing/webhookevent"

	"github.com/gin-gonic/gin"
	stripewebhook "github.com/stripe/stripe-go/v86/webhook"
)

const receiptSecret = "whsec_receipt"

// receiptStore keeps what Record committed, as one transaction would:
// every delivery, and one task per scoped event.
type receiptStore struct {
	deliveries []webhookevent.Delivery
	tasks      map[webhookevent.Scope]webhookevent.Task
	err        error
}

func (s *receiptStore) Record(_ context.Context, d webhookevent.Delivery, task webhookevent.Task) error {
	if s.err != nil {
		return s.err
	}
	s.deliveries = append(s.deliveries, d)
	if _, ok := s.tasks[d.Receipt.Scope]; !ok {
		s.tasks[d.Receipt.Scope] = task
	}
	return nil
}

// receiptFixture wires the real receiver and signature check to a fake
// store, behind the receipt edge.
type receiptFixture struct {
	store    *receiptStore
	endpoint webhookevent.Endpoint
	observed *recordedWebhooks
	ids      int
}

func newReceiptFixture() *receiptFixture {
	return &receiptFixture{
		store:    &receiptStore{tasks: map[webhookevent.Scope]webhookevent.Task{}},
		endpoint: webhookevent.Endpoint{AccountID: "acct_enx"},
		observed: &recordedWebhooks{},
	}
}

func (f *receiptFixture) post(t *testing.T, body *bytes.Reader, sigHeader string) int {
	t.Helper()
	receiver := webhookevent.NewReceiver(
		func(payload []byte, sig string) error {
			return billingstripe.VerifyWebhook(payload, sig, receiptSecret)
		},
		func() webhookevent.Endpoint { return f.endpoint },
		f.store,
		func() time.Time { return time.Date(2026, 10, 24, 12, 0, 0, 0, time.UTC) },
		func() string { f.ids++; return fmt.Sprintf("dlv_%d", f.ids) })
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/billing/webhook", NewReceiptHandler(receiver, f.observed).Webhook)
	req := httptest.NewRequest(http.MethodPost, "/billing/webhook", body)
	req.Header.Set("Stripe-Signature", sigHeader)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Body.Len() != 0 {
		t.Errorf("body = %q, want a bare status", w.Body.String())
	}
	return w.Code
}

func signReceipt(payload []byte) string {
	ts := time.Now()
	return "t=" + strconv.FormatInt(ts.Unix(), 10) + ",v1=" + hex.EncodeToString(stripewebhook.ComputeSignature(ts, payload, receiptSecret))
}

func receiptPayload(eventID, extra string) []byte {
	return []byte(`{"id": "` + eventID + `", "object": "event", "type": "invoice.paid", "created": 1793000000,` +
		` "api_version": "2026-08-26.dahlia", "livemode": false` + extra +
		`, "data": {"object": {"object": "invoice", "id": "in_1"}}}`)
}

func TestADurablyReceivedDeliveryIsAnswered200(t *testing.T) {
	f := newReceiptFixture()
	payload := receiptPayload("evt_1", "")

	code := f.post(t, bytes.NewReader(payload), signReceipt(payload))

	if code != http.StatusOK {
		t.Errorf("status = %d, want 200", code)
	}
	if len(f.store.deliveries) != 1 || !bytes.Equal(f.store.deliveries[0].Payload, payload) {
		t.Fatalf("stored %+v, want one delivery with the raw payload", f.store.deliveries)
	}
	if want := []string{"receipt received"}; fmt.Sprint(f.observed.got) != fmt.Sprint(want) {
		t.Errorf("observed %q, want %q", f.observed.got, want)
	}
}

func TestARefusedDeliveryIsAnswered400AndStoresNothing(t *testing.T) {
	signed := func(payload []byte) (*bytes.Reader, string) { return bytes.NewReader(payload), signReceipt(payload) }
	cases := []struct {
		name   string
		body   func() (*bytes.Reader, string)
		reason string
	}{
		{"a bad signature", func() (*bytes.Reader, string) {
			return bytes.NewReader(receiptPayload("evt_1", "")), "t=1,v1=deadbeef"
		}, "bad_signature"},
		{"a signed payload that is not an event", func() (*bytes.Reader, string) {
			return signed([]byte(`{"id": "evt_1", "object": "invoice"}`))
		}, "malformed_envelope"},
		{"another account's event", func() (*bytes.Reader, string) {
			return signed(receiptPayload("evt_1", `, "account": "acct_other"`))
		}, "wrong_account"},
		{"a live event at a test endpoint", func() (*bytes.Reader, string) {
			return signed(bytes.Replace(receiptPayload("evt_1", ""), []byte(`"livemode": false`), []byte(`"livemode": true`), 1))
		}, "wrong_mode"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newReceiptFixture()
			body, sig := tc.body()

			code := f.post(t, body, sig)

			if code != http.StatusBadRequest {
				t.Errorf("status = %d, want 400", code)
			}
			if len(f.store.deliveries) != 0 {
				t.Errorf("stored %d deliveries, want none", len(f.store.deliveries))
			}
			if want := []string{"receipt " + tc.reason}; fmt.Sprint(f.observed.got) != fmt.Sprint(want) {
				t.Errorf("observed %q, want %q", f.observed.got, want)
			}
		})
	}
}

func TestADeliveryBeforeTheEndpointAccountIsKnownIsAnswered503(t *testing.T) {
	f := newReceiptFixture()
	f.endpoint = webhookevent.Endpoint{}
	payload := receiptPayload("evt_1", "")

	code := f.post(t, bytes.NewReader(payload), signReceipt(payload))

	if code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503", code)
	}
	if len(f.store.deliveries) != 0 {
		t.Errorf("stored %d deliveries, want none", len(f.store.deliveries))
	}
	if want := []string{"receipt endpoint_unknown"}; fmt.Sprint(f.observed.got) != fmt.Sprint(want) {
		t.Errorf("observed %q, want %q", f.observed.got, want)
	}
}

func TestADeliveryTheDatabaseFailsToStoreIsAnswered500(t *testing.T) {
	f := newReceiptFixture()
	f.store.err = errors.New("database is locked")
	payload := receiptPayload("evt_1", "")

	code := f.post(t, bytes.NewReader(payload), signReceipt(payload))

	if code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500", code)
	}
	if want := []string{"receipt storage_failed"}; fmt.Sprint(f.observed.got) != fmt.Sprint(want) {
		t.Errorf("observed %q, want %q", f.observed.got, want)
	}
}

type brokenBody struct{}

func (brokenBody) Read([]byte) (int, error) { return 0, errors.New("connection reset") }

func TestARequestWhoseBodyCannotBeReadIsAnswered400(t *testing.T) {
	f := newReceiptFixture()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/billing/webhook", NewReceiptHandler(receiverFunc(func(context.Context, []byte, string) webhookevent.Outcome {
		t.Error("Receive called for a body that could not be read")
		return webhookevent.Outcome{Reason: "received", Accepted: true}
	}), f.observed).Webhook)
	req := httptest.NewRequest(http.MethodPost, "/billing/webhook", brokenBody{})
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", w.Code)
	}
	if want := []string{"receipt unreadable_body"}; fmt.Sprint(f.observed.got) != fmt.Sprint(want) {
		t.Errorf("observed %q, want %q", f.observed.got, want)
	}
}

type receiverFunc func(ctx context.Context, payload []byte, sigHeader string) webhookevent.Outcome

func (f receiverFunc) Receive(ctx context.Context, payload []byte, sigHeader string) webhookevent.Outcome {
	return f(ctx, payload, sigHeader)
}

type recordedWebhooks struct{ got []string }

func (r *recordedWebhooks) ObserveWebhook(eventType, outcome string) {
	r.got = append(r.got, eventType+" "+outcome)
}
