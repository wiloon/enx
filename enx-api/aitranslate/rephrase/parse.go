package rephrase

import (
	"encoding/json"
	"fmt"
	"strings"
)

// wireResult mirrors the JSON object the LLM is prompted to return. Separate
// from Result so the public type isn't coupled to the wire shape and so
// Usage (which comes from elsewhere) can't leak in from the model.
type wireResult struct {
	Idiomatic    string `json:"idiomatic"`
	Alternatives []struct {
		Text     string `json:"text"`
		Register string `json:"register"`
	} `json:"alternatives"`
	Notes []string `json:"notes"`
}

// ParseResult turns a provider's raw reply into a Result. The model is
// prompted to return a bare JSON object; ParseResult unmarshals it and
// checks the two invariants the UI relies on -- a non-empty idiomatic
// rendering and at least one alternative. Anything else is an error, so the
// handler can 502 rather than serve a half-built result (ADR-012 Decision 2).
func ParseResult(raw string) (Result, error) {
	obj, ok := extractJSONObject(raw)
	if !ok {
		return Result{}, fmt.Errorf("rephrase: reply contains no JSON object")
	}

	var wire wireResult
	if err := json.Unmarshal([]byte(obj), &wire); err != nil {
		return Result{}, fmt.Errorf("rephrase: reply is not valid JSON: %w", err)
	}

	if wire.Idiomatic == "" {
		return Result{}, fmt.Errorf("rephrase: reply has no idiomatic rendering")
	}
	if len(wire.Alternatives) == 0 {
		return Result{}, fmt.Errorf("rephrase: reply has no alternatives")
	}

	out := Result{Idiomatic: wire.Idiomatic, Notes: wire.Notes}
	for _, a := range wire.Alternatives {
		out.Alternatives = append(out.Alternatives, Alternative{Text: a.Text, Register: a.Register})
	}
	return out, nil
}

// extractJSONObject pulls the outermost {...} span out of a reply that may
// be wrapped in a ```json fence or padded with prose. Small models don't
// reliably return a bare object even when told to, so this is deliberately
// lenient: first brace to last brace.
func extractJSONObject(raw string) (string, bool) {
	start := strings.IndexByte(raw, '{')
	end := strings.LastIndexByte(raw, '}')
	if start < 0 || end < start {
		return "", false
	}
	return raw[start : end+1], true
}
