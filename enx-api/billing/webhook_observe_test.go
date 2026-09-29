package billing

import (
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	stripeSDK "github.com/stripe/stripe-go/v86"
	stripewebhook "github.com/stripe/stripe-go/v86/webhook"
)

type recordedWebhooks struct{ got []string }

func (r *recordedWebhooks) ObserveWebhook(eventType, outcome string) {
	r.got = append(r.got, eventType+" "+outcome)
}

func postWebhook(t *testing.T, h *Handler, secret, eventType, object string, sign bool) {
	t.Helper()
	payload := []byte(`{"id": "evt-` + t.Name() + `", "object": "event", "api_version": "` + stripeSDK.APIVersion +
		`", "type": "` + eventType + `", "data": {"object": ` + object + `}}`)
	header := "t=1,v1=deadbeef"
	if sign {
		ts := time.Now()
		header = "t=" + strconv.FormatInt(ts.Unix(), 10) + ",v1=" + hex.EncodeToString(stripewebhook.ComputeSignature(ts, payload, secret))
	}
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/billing/webhook", h.Webhook)
	req := httptest.NewRequest(http.MethodPost, "/billing/webhook", strings.NewReader(string(payload)))
	req.Header.Set("Stripe-Signature", header)
	router.ServeHTTP(httptest.NewRecorder(), req)
}

// ADR-040: every delivery is counted by (narrowed) event type and outcome --
// the earliest signal that a payment did not turn into credits.
func TestWebhookReportsOutcome(t *testing.T) {
	const secret = "whsec_observe"
	viperSet(t, "stripe.credits.topup-large", 9)
	viperSet(t, "stripe.credits.topup-medium", 0) // unconfigured: dispatch fails
	obs := &recordedWebhooks{}
	h := NewHandler(fakeConfiguredClient(), "https://example.com", secret, obs)

	topup := func(tier string) string {
		return `{"id": "cs_` + tier + `", "client_reference_id": "u-` + t.Name() + `", "customer": "cus_1", "metadata": {"type": "topup", "tier": "` + tier + `"}}`
	}
	postWebhook(t, h, secret, "checkout.session.completed", topup("large"), true)
	postWebhook(t, h, secret, "checkout.session.completed", topup("medium"), true)
	postWebhook(t, h, secret, "some.unhandled.event", `{}`, true)
	postWebhook(t, h, secret, "invoice.paid", `{}`, false)

	want := []string{
		"checkout.session.completed ok",
		"checkout.session.completed error",
		"other ok",
		"unknown bad_signature",
	}
	if strings.Join(obs.got, "|") != strings.Join(want, "|") {
		t.Fatalf("observed %q, want %q", obs.got, want)
	}
}
