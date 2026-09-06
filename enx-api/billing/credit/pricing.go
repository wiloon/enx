package credit

// TokenPricing converts an LLM call's token usage into an integer credit
// cost. It is the policy behind token-metered features (ADR-012 Decision 5)
// and lives here, next to Settle, rather than in a handler.
//
// WeightOut is normally larger than WeightIn because providers price output
// tokens higher, and a rephrase completion (idiomatic + alternatives +
// notes) is the larger, more variable half of the call.
type TokenPricing struct {
	WeightIn  int64
	WeightOut int64
	Divisor   int64
}

// Priced reports whether the feature has a usable price. An unpriced
// feature (Divisor <= 0, or both weights zero) must reject requests rather
// than let AI calls through for free -- same convention as a fixed cost of
// 0 in Consume.
func (p TokenPricing) Priced() bool {
	return p.Divisor > 0 && (p.WeightIn != 0 || p.WeightOut != 0)
}

// Cost returns the credit cost for the given token counts, rounded up and
// floored at 1. Callers must check Priced first; Cost on an unpriced
// TokenPricing is meaningless (and guards against divide-by-zero).
func (p TokenPricing) Cost(promptTokens, completionTokens int) int64 {
	if p.Divisor <= 0 {
		return 1
	}
	raw := int64(promptTokens)*p.WeightIn + int64(completionTokens)*p.WeightOut
	cost := (raw + p.Divisor - 1) / p.Divisor // ceil
	if cost < 1 {
		cost = 1
	}
	return cost
}
