// Package aiusage holds the token-usage type shared between aitranslate and
// its provider packages (kimi, minimax, bedrock). It is its own leaf package
// so a provider method can name Usage in its return signature without
// importing aitranslate -- aitranslate imports the providers (see
// aitranslate/factory.go), so the reverse would be an import cycle.
//
// It mirrors aitranslate/rephrase's Usage type; the two are kept separate
// only because rephrase predates site-wide token billing (ADR-014).
package aiusage

// Usage is one LLM call's token counts, taken from the provider's API
// response. Callers bill the call by actual consumption (ADR-014).
type Usage struct {
	PromptTokens     int
	CompletionTokens int
	TotalTokens      int
}
