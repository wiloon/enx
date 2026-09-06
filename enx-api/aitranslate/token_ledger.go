package aitranslate

import (
	"context"

	"enx-api/billing/credit"
)

// tokenLedgerFuncs adapts billing/credit's package-level Balance/Settle to
// the TokenLedger interface, so the production call site (enx-api.go)
// doesn't need its own adapter boilerplate.
type tokenLedgerFuncs struct{}

func (tokenLedgerFuncs) Balance(ctx context.Context, userID string) (int64, error) {
	return credit.Balance(ctx, userID)
}

func (tokenLedgerFuncs) Settle(ctx context.Context, userID, feature string, cost int64) error {
	return credit.Settle(ctx, userID, feature, cost)
}

// DefaultTokenLedger is the production TokenLedger, shared by the sentence
// translation handler (ADR-014) and the rephrase handler (ADR-012) -- both
// bill by actual token usage against the same billing/credit ledger.
var DefaultTokenLedger TokenLedger = tokenLedgerFuncs{}
