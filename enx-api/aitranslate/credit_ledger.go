package aitranslate

import (
	"context"

	"enx-api/billing/credit"
)

// creditLedgerFuncs adapts billing/credit's package-level functions to the
// CreditLedger interface, so the production call site (enx-api.go) doesn't
// need its own adapter boilerplate.
type creditLedgerFuncs struct{}

func (creditLedgerFuncs) Consume(ctx context.Context, userID, feature string, cost int64) (string, error) {
	return credit.Consume(ctx, userID, feature, cost)
}

func (creditLedgerFuncs) Refund(ctx context.Context, userID, feature, pool string, cost int64) error {
	return credit.Refund(ctx, userID, feature, pool, cost)
}

// DefaultCreditLedger is the production CreditLedger, backed by
// billing/credit's real ledger.
var DefaultCreditLedger CreditLedger = creditLedgerFuncs{}
