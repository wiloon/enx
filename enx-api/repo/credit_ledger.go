package repo

import (
	"context"
	"time"

	"enx-api/billing/creditledger"
	"enx-api/utils/sqlitex"
)

// CreditLedger is creditledger.Store over credit_transactions (ADR-063).
type CreditLedger struct{}

var _ creditledger.Store = CreditLedger{}

func (CreditLedger) Transactions(ctx context.Context, userID string, q creditledger.Query) ([]creditledger.Transaction, error) {
	query := sqlitex.DB.WithContext(ctx).Model(&sqlitex.CreditTransaction{}).
		Select("rowid AS seq, id, user_id, type, amount, balance_after, total_balance_after, feature, note, created_at").
		Where("user_id = ?", userID)
	switch q.Direction {
	case creditledger.DirectionIn:
		query = query.Where("amount > 0")
	case creditledger.DirectionOut:
		query = query.Where("amount < 0")
	}
	if q.Before != nil {
		ms := q.Before.CreatedAt.UnixMilli()
		query = query.Where("created_at < ? OR (created_at = ? AND rowid < ?)", ms, ms, q.Before.Seq)
	}
	var rows []struct {
		Seq               int64
		ID                string
		UserID            string
		Type              string
		Amount            int64
		BalanceAfter      int64
		TotalBalanceAfter *int64
		Feature           string
		Note              string
		CreatedAt         int64 // Unix ms
	}
	if err := query.Order("created_at DESC, rowid DESC").Limit(q.Limit).Scan(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]creditledger.Transaction, len(rows))
	for i, r := range rows {
		out[i] = creditledger.Transaction{
			ID: r.ID, Seq: r.Seq, UserID: r.UserID, Type: r.Type, Amount: r.Amount,
			BalanceAfter: r.BalanceAfter, TotalBalanceAfter: r.TotalBalanceAfter, Feature: r.Feature, Note: r.Note,
			CreatedAt: time.UnixMilli(r.CreatedAt),
		}
	}
	return out, nil
}
