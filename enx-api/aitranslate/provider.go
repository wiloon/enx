// Package aitranslate provides the AI-backed features: sentence and word
// translation, rephrase and define-word, as opposed to the dictionary-backed
// single-word lookups in the translate/dictionary packages. A provider only
// offers chats (llm.Chat); each feature's prompt and reply parsing live in
// its own package, whose Call this package invokes. See
// docs/tasks/TASK-SPEC-enx-chrome-sentence-translation-sidepanel.md.
package aitranslate

import (
	"time"

	"enx-api/aitranslate/aiusage"
	"enx-api/aitranslate/llm"
)

// Usage re-exports aiusage.Usage so code in this package doesn't need the
// leaf import. The leaf package exists only to break the
// aitranslate <-> provider import cycle (see the aiusage package doc).
type Usage = aiusage.Usage

// Provider is the configured AI provider: its chats and what differs from
// one provider to another (ADR-045, ADR-012). New builds it.
type Provider struct {
	// Chat serves every feature except rephrase.
	Chat llm.Chat
	// RephraseChat serves rephrase, on its own model where one is
	// configured. Nil: the provider does not serve rephrase.
	RephraseChat llm.Chat
	// DefinesWords says the provider serves the AI word fallback.
	DefinesWords bool
	// ParseAttempts is how many times word-in-context asks while the reply
	// does not parse; 1 means no retry.
	ParseAttempts int

	name     string
	observer AIObserver
}

// AIObserver records one AI feature call: metrics.Metrics in production
// (ADR-040).
type AIObserver interface {
	ObserveAI(provider, operation string, start time.Time, err error, inputTokens, outputTokens int)
}

// Instrument returns p with every feature call timed and its tokens counted
// under name.
func Instrument(p *Provider, name string, obs AIObserver) *Provider {
	instrumented := *p
	instrumented.name, instrumented.observer = name, obs
	return &instrumented
}

// observe runs one feature call and records it as operation. The Grafana
// Cloud dashboards depend on the operation names, which differ from the
// llm.Chat feature strings.
func observe[R any](p *Provider, operation string, call func() (R, Usage, error)) (R, Usage, error) {
	start := time.Now()
	res, u, err := call()
	if p.observer != nil {
		p.observer.ObserveAI(p.name, operation, start, err, u.PromptTokens, u.CompletionTokens)
	}
	return res, u, err
}
