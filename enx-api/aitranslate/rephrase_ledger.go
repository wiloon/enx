package aitranslate

import (
	"context"

	"enx-api/billing/credit"
)

// rephraseLedgerFuncs adapts billing/credit's package-level Balance/Settle to
// the RephraseLedger interface, mirroring creditLedgerFuncs.
type rephraseLedgerFuncs struct{}

func (rephraseLedgerFuncs) Balance(ctx context.Context, userID string) (int64, error) {
	return credit.Balance(ctx, userID)
}

func (rephraseLedgerFuncs) Settle(ctx context.Context, userID, feature string, cost int64) error {
	return credit.Settle(ctx, userID, feature, cost)
}

// DefaultRephraseLedger is the production RephraseLedger.
var DefaultRephraseLedger RephraseLedger = rephraseLedgerFuncs{}
