// Package aicfg holds configuration shared by the AI translation provider
// packages (kimi, minimax, bedrock). Like aiusage it is a leaf package, so a
// provider can read shared config without importing aitranslate (which
// imports the providers -- see aitranslate/factory.go).
package aicfg

import (
	"time"

	"github.com/spf13/viper"
)

// defaultRequestTimeout is the per-call ceiling for a provider's HTTP
// request when sentence-translate.request-timeout is unset. 10s was too
// tight once the homelab moved to MiniMax's M-series models, which spend
// time "thinking" before the first response byte.
const defaultRequestTimeout = 60 * time.Second

// RequestTimeout is the deadline for a single provider API call, from
// sentence-translate.request-timeout (env SENTENCE_TRANSLATE_REQUEST_TIMEOUT),
// falling back to defaultRequestTimeout when unset or non-positive.
func RequestTimeout() time.Duration {
	if d := viper.GetDuration("sentence-translate.request-timeout"); d > 0 {
		return d
	}
	return defaultRequestTimeout
}
