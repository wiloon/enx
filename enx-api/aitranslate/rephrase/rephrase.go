// Package rephrase holds the contract for turning Chinese / mixed / rough
// English into idiomatic workplace American English (ADR-012): Call, which
// runs it on a provider's chat, the structured Result it returns, and
// ParseResult, which turns the raw JSON reply into a Result.
package rephrase

// Result is the structured rephrasing. Usage is filled by the provider from
// its API response, not by ParseResult.
type Result struct {
	Idiomatic    string
	Alternatives []Alternative
	Notes        []string
	Usage        Usage
}

// Alternative is one wording at a different register (e.g. more formal for
// an email, more casual for a chat message).
type Alternative struct {
	Text     string
	Register string
}

// Usage is the provider-reported token count for one call, used to bill the
// request by actual consumption (ADR-012 Decision 5).
type Usage struct {
	PromptTokens     int
	CompletionTokens int
	TotalTokens      int
}
