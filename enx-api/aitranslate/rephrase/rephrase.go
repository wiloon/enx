// Package rephrase holds the contract for turning Chinese / mixed / rough
// English into idiomatic workplace American English (ADR-012): the
// Rephraser interface every provider implements, the structured Result it
// returns, and ParseResult, which turns a provider's raw JSON reply into a
// Result. It is a leaf package -- both aitranslate and the provider
// packages (kimi, ...) import it, so the provider's Rephrase method can
// name Result as its return type without an import cycle.
package rephrase

import "context"

// Rephraser rewrites one short piece of text into idiomatic workplace
// American English. Input may be Chinese, mixed, or ungrammatical English.
type Rephraser interface {
	Rephrase(ctx context.Context, input string) (Result, error)
}

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
