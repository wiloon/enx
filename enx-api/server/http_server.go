package server

import (
	"net/http"
	"time"
)

const (
	// writeTimeoutHeadroom is what the server allows a metered request on top
	// of the provider call itself: Clerk JWT verification (which can make a
	// network round trip when the JWKS cache refreshes), the ADR-014 balance
	// precheck, the ledger Settle write, JSON encoding, and pushing the
	// response to a client that may be on a slow mobile link. All of that is
	// normally milliseconds; 15s is sized so it is never the thing that kills
	// a legitimate request, while still keeping the total bounded (75s at the
	// 60s default) well under IdleTimeout.
	writeTimeoutHeadroom = 15 * time.Second

	// minWriteTimeout floors the derived value so a deliberately tiny
	// provider timeout (a test or a misconfigured env var setting "1s")
	// cannot shrink the server's own budget below what the non-AI routes
	// need. It is the historical 30s, which was always fine for those.
	minWriteTimeout = 30 * time.Second

	// shutdownGraceMargin is the slack Shutdown gets beyond one request's
	// ceiling, so a request that started just before SIGTERM can still
	// finish and flush instead of being cut off mid-response.
	shutdownGraceMargin = 5 * time.Second
)

// NewHTTPServer builds the HTTP server that serves handler on addr.
//
// WriteTimeout is derived from the AI provider's request timeout
// (sentence-translate.request-timeout) instead of being its own constant because the two are not independent: Go's WriteTimeout starts
// when the request header is read and covers body read, handler execution and
// response write, so a WriteTimeout below the provider timeout means the
// server tears the connection down while its own handler is still waiting on
// the model. On /translate/sentence and /rephrase that is worse than a
// dropped request -- they are token-billed (ADR-012/ADR-014), the handler
// keeps running past the write deadline, so the provider call completes and
// Settle charges the user for a response that never reached them.
//
// That is not hypothetical: WriteTimeout sat at a hard-coded 30s (added when
// the provider timeout was 10s) while the provider default was later raised
// to 60s for MiniMax's M-series "thinking" models, silently putting every
// 30-60s translation in the billed-but-undelivered window. Deriving it means
// raising SENTENCE_TRANSLATE_REQUEST_TIMEOUT can no longer reopen that gap.
func NewHTTPServer(addr string, handler http.Handler, providerTimeout time.Duration) *http.Server {
	writeTimeout := providerTimeout + writeTimeoutHeadroom
	if writeTimeout < minWriteTimeout {
		writeTimeout = minWriteTimeout
	}
	return &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		WriteTimeout:      writeTimeout,
		IdleTimeout:       120 * time.Second,
	}
}
