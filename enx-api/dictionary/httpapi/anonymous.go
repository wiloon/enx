package httpapi

import (
	"errors"
	"net"
	"net/http"
	"strconv"

	"enx-api/dictionary"
	"enx-api/middleware"
	"enx-api/platform/httpjson"

	"github.com/gin-gonic/gin"
)

// DeviceIDHeader carries the anonymous device id (ADR-095 Decision 4).
const DeviceIDHeader = "X-Enx-Device-Id"

// AnonymousHandler serves the anonymous lookup (ADR-095 Decision 7).
type AnonymousHandler struct {
	lookups *dictionary.AnonymousLookups
	// clientIPHeader names the header carrying the client IP; empty means
	// the connection's remote address.
	clientIPHeader string
}

func NewAnonymousHandler(lookups *dictionary.AnonymousLookups, clientIPHeader string) *AnonymousHandler {
	return &AnonymousHandler{lookups: lookups, clientIPHeader: clientIPHeader}
}

type anonymousRequest struct {
	Word string `json:"word"`
}

// Entry handles POST /api/anonymous/dictionary/entry: one word's dictionary
// definition without an account, as a single object shaped like one element
// of the batch definitions response, never with an AI fallback offer.
func (h *AnonymousHandler) Entry(c *gin.Context) {
	if !h.lookups.Enabled() {
		respondAnonymousDisabled(c)
		return
	}
	if c.ContentType() != "application/json" {
		httpjson.Fail(c, http.StatusUnsupportedMediaType, "Content-Type must be application/json")
		return
	}
	var req anonymousRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpjson.Fail(c, http.StatusBadRequest, "Invalid request body")
		return
	}

	result, err := h.lookups.Lookup(c.Request.Context(), dictionary.AnonymousRequest{
		DeviceID: c.GetHeader(DeviceIDHeader),
		ClientIP: h.clientIP(c),
		Word:     req.Word,
	})
	var refusal *dictionary.AnonymousRefusal
	switch {
	case errors.Is(err, dictionary.ErrAnonymousLookupDisabled):
		respondAnonymousDisabled(c)
		return
	case errors.Is(err, dictionary.ErrInvalidDeviceID):
		httpjson.Fail(c, http.StatusBadRequest, "Send a UUID in "+DeviceIDHeader+".")
		return
	case errors.Is(err, dictionary.ErrInvalidAnonymousWord):
		httpjson.Fail(c, http.StatusBadRequest, "Send a single word in \"word\".")
		return
	case errors.As(err, &refusal):
		respondAnonymousRefused(c, refusal)
		return
	case err != nil:
		httpjson.Fail(c, http.StatusInternalServerError, "Dictionary lookup failed")
		return
	}
	c.JSON(http.StatusOK, toEntryJSON(result))
}

// clientIP is the configured header's value, or the connection's remote
// address when no header is configured. A missing header gives "", which
// the domain counts in its shared bucket.
func (h *AnonymousHandler) clientIP(c *gin.Context) string {
	if h.clientIPHeader != "" {
		return c.GetHeader(h.clientIPHeader)
	}
	host, _, err := net.SplitHostPort(c.Request.RemoteAddr)
	if err != nil {
		return c.Request.RemoteAddr
	}
	return host
}

func respondAnonymousDisabled(c *gin.Context) {
	c.JSON(http.StatusForbidden, gin.H{
		"success": false,
		"code":    "anonymous_lookup_disabled",
		"message": "Lookups without an account are turned off. Sign in to look up words.",
	})
}

// respondAnonymousRefused answers a refusal 429 with Retry-After: the
// request rate's too_many_requests, as for signed-in routes (ADR-060), or
// the daily limits' own code.
func respondAnonymousRefused(c *gin.Context, r *dictionary.AnonymousRefusal) {
	c.Header("Retry-After", strconv.Itoa(int(r.RetryAfter.Seconds())))
	if r.Layer == dictionary.LayerRate {
		c.Set(middleware.RateLimitedKey, true)
		c.JSON(http.StatusTooManyRequests, gin.H{
			"success": false,
			"code":    "too_many_requests",
			"message": middleware.RateLimitedMessage,
		})
		return
	}
	c.JSON(http.StatusTooManyRequests, gin.H{
		"success": false,
		"code":    "anonymous_lookup_limit_exceeded",
		"message": "You've reached today's limit for lookups without an account. Sign in to keep going.",
	})
}
