package credit

import (
	"context"
	"errors"
	"fmt"
	"time"

	"enx-api/utils/sqlitex"

	"gorm.io/gorm"
)

// LedgerWrite runs one ledger write's balance update for userID inside tx
// and returns the total_balance_after its row records (ADR-063 Decisions 7
// and 9). It first forfeits an expired trial, writing that EXPIRE row, so
// the write's own row never starts from a total the ledger has not
// explained; then it runs update; then it reads the account back. Every
// ledger writer, here and in repo, goes through it. A user with no credit
// account has nothing to forfeit and a total of 0.
func LedgerWrite(tx *gorm.DB, userID string, at time.Time, update func() error) (int64, error) {
	if _, err := expireTrial(tx, userID, at); err != nil {
		return 0, err
	}
	if err := update(); err != nil {
		return 0, err
	}
	return totalBalance(tx, userID, at)
}

// totalBalance is userID's spendable total, summed the way Settle draws the
// pools; 0 when the user has no credit account.
func totalBalance(tx *gorm.DB, userID string, at time.Time) (int64, error) {
	account, found, err := findAccount(tx, userID)
	if err != nil || !found {
		return 0, err
	}
	return spendable(account, at), nil
}

func findAccount(tx *gorm.DB, userID string) (sqlitex.CreditAccount, bool, error) {
	var accounts []sqlitex.CreditAccount
	if err := tx.Where("user_id = ?", userID).Limit(1).Find(&accounts).Error; err != nil {
		return sqlitex.CreditAccount{}, false, err
	}
	if len(accounts) == 0 {
		return sqlitex.CreditAccount{}, false, nil
	}
	return accounts[0], true, nil
}

// TrialSweep is the outcome of one ExpireTrials run.
type TrialSweep struct {
	// Expired counts the trials forfeited.
	Expired int
	// Errors holds one error per account left for the next run.
	Errors []error
}

// ExpireTrials forfeits every trial that has expired with credits left,
// each in its own transaction, so the ledger records the expiry within one
// run of it rather than at the user's next write (ADR-063 Decision 10). An
// account a deletion fences is skipped, as grants skip it. One failed
// account does not stop the others; the next run retries it.
func ExpireTrials(ctx context.Context) (TrialSweep, error) {
	at := now()
	var userIDs []string
	if err := sqlitex.DB.WithContext(ctx).Model(&sqlitex.CreditAccount{}).
		Where("trial_expires_at <= ? AND trial_balance > 0", at.Unix()).
		Order("user_id").Pluck("user_id", &userIDs).Error; err != nil {
		return TrialSweep{}, fmt.Errorf("credit: list expired trials: %w", err)
	}
	var run TrialSweep
	for _, userID := range userIDs {
		expired := false
		err := sqlitex.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			if err := checkGrantTarget(tx, userID); err != nil {
				return err
			}
			var err error
			expired, err = expireTrial(tx, userID, at)
			return err
		})
		switch {
		case errors.Is(err, ErrNoUser), errors.Is(err, ErrDeletionInProgress):
		case err != nil:
			run.Errors = append(run.Errors, fmt.Errorf("credit: expire trial of %s: %w", userID, err))
		case expired:
			run.Expired++
		}
	}
	return run, nil
}
