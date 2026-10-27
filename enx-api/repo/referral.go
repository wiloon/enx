package repo

import (
	"context"
	"errors"
	"time"

	"enx-api/referral"
	"enx-api/utils/sqlitex"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ReferralCodes is referral.CodeRepo over referral_codes (ADR-051).
type ReferralCodes struct{}

var _ referral.CodeRepo = ReferralCodes{}

func (ReferralCodes) CodeOf(ctx context.Context, userID string) (string, bool, error) {
	var row sqlitex.ReferralCode
	err := sqlitex.DB.WithContext(ctx).Where("user_id = ?", userID).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", false, nil
	}
	return row.Code, err == nil, err
}

func (ReferralCodes) OwnerOf(ctx context.Context, code string) (string, bool, error) {
	var row sqlitex.ReferralCode
	err := sqlitex.DB.WithContext(ctx).Where("code = ?", code).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", false, nil
	}
	return row.UserId, err == nil, err
}

// Insert does nothing, without an error, when the user already has a code or
// the code is taken (either unique constraint).
func (ReferralCodes) Insert(ctx context.Context, userID, code string, at time.Time) (bool, error) {
	res := sqlitex.DB.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).
		Create(&sqlitex.ReferralCode{UserId: userID, Code: code, CreatedAt: at.UnixMilli()})
	return res.RowsAffected == 1, res.Error
}

// Referrals is referral.ReferralRepo over referrals (ADR-051).
type Referrals struct {
	// tx, when set, is the transaction Get and RecordFirstPayment run in
	// (the webhook effects' first-payment handoff); otherwise the shared DB.
	tx *gorm.DB
}

var _ referral.ReferralRepo = Referrals{}

func (r Referrals) conn(ctx context.Context) *gorm.DB {
	if r.tx != nil {
		return r.tx.WithContext(ctx)
	}
	return sqlitex.DB.WithContext(ctx)
}

func (r Referrals) Get(ctx context.Context, inviteeID string) (referral.Referral, bool, error) {
	var row sqlitex.Referral
	err := r.conn(ctx).Where("invitee_user_id = ?", inviteeID).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return referral.Referral{}, false, nil
	}
	if err != nil {
		return referral.Referral{}, false, err
	}
	return toReferral(row), true, nil
}

// Insert does nothing, without an error, when the invitee already claimed.
func (Referrals) Insert(ctx context.Context, r referral.Referral) (bool, error) {
	res := sqlitex.DB.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&sqlitex.Referral{
		InviteeUserId:  r.InviteeID,
		ReferrerUserId: r.ReferrerID,
		Code:           r.Code,
		ClaimedAt:      r.ClaimedAt.UnixMilli(),
		Status:         string(r.Status),
		RewardsBlocked: r.RewardsBlocked,
		UpdatedAt:      r.ClaimedAt.UnixMilli(),
	})
	return res.RowsAffected == 1, res.Error
}

func (Referrals) ByReferrer(ctx context.Context, referrerID string) ([]referral.Referral, error) {
	var rows []sqlitex.Referral
	if err := sqlitex.DB.WithContext(ctx).Where("referrer_user_id = ?", referrerID).
		Order("claimed_at, invitee_user_id").Find(&rows).Error; err != nil {
		return nil, err
	}
	return toReferrals(rows), nil
}

// RecordFirstPayment writes only to a row with no first payment yet, so of a
// renewal, a replay or two racing webhooks only the first one lands.
func (r Referrals) RecordFirstPayment(ctx context.Context, inviteeID string, p referral.FirstPayment, reward referral.Reward) (bool, error) {
	updates := map[string]any{
		"first_payment_kind":       string(p.Kind),
		"first_payment_intent_id":  nullable(p.PaymentIntentID),
		"first_payment_invoice_id": nullable(p.InvoiceID),
		"first_payment_credits":    p.Credits,
		"first_paid_at":            p.PaidAt.UnixMilli(),
		"status":                   string(reward.Status),
		"reward_amount":            reward.Amount,
		"updated_at":               time.Now().UnixMilli(),
	}
	if !reward.DueAt.IsZero() {
		updates["reward_due_at"] = reward.DueAt.UnixMilli()
	}
	res := r.conn(ctx).Model(&sqlitex.Referral{}).
		Where("invitee_user_id = ? AND first_payment_kind IS NULL", inviteeID).
		Updates(updates)
	return res.RowsAffected == 1, res.Error
}

func (Referrals) DueRewards(ctx context.Context, at time.Time, rewardKeyPrefix string) ([]referral.Referral, error) {
	var rows []sqlitex.Referral
	if err := sqlitex.DB.WithContext(ctx).
		Where("(status = ? AND reward_due_at <= ?) OR (status = ? AND EXISTS (SELECT 1 FROM credit_transactions WHERE stripe_event_id = ? || referrals.invitee_user_id))",
			string(referral.StatusPending), at.UnixMilli(), string(referral.StatusForfeited), rewardKeyPrefix).
		Order("reward_due_at").Find(&rows).Error; err != nil {
		return nil, err
	}
	return toReferrals(rows), nil
}

func (Referrals) SetPaymentIntent(ctx context.Context, inviteeID, paymentIntentID string) error {
	return sqlitex.DB.WithContext(ctx).Model(&sqlitex.Referral{}).
		Where("invitee_user_id = ?", inviteeID).
		Updates(map[string]any{"first_payment_intent_id": paymentIntentID, "updated_at": time.Now().UnixMilli()}).Error
}

// MarkRewarded reconciles pending or forfeited rows after a committed grant.
// An already rewarded row never changes.
func (Referrals) MarkRewarded(ctx context.Context, inviteeID string, at time.Time) error {
	return sqlitex.DB.WithContext(ctx).Model(&sqlitex.Referral{}).
		Where("invitee_user_id = ? AND status IN ?", inviteeID, []string{string(referral.StatusPending), string(referral.StatusForfeited)}).
		Updates(map[string]any{
			"status": string(referral.StatusRewarded), "rewarded_at": at.UnixMilli(), "updated_at": at.UnixMilli(), "forfeit_reason": "",
		}).Error
}

func (Referrals) MarkForfeited(ctx context.Context, inviteeID, reason string, at time.Time) error {
	return settleReferral(ctx, inviteeID, map[string]any{
		"status": string(referral.StatusForfeited), "forfeit_reason": reason, "updated_at": at.UnixMilli(),
	})
}

func settleReferral(ctx context.Context, inviteeID string, updates map[string]any) error {
	return sqlitex.DB.WithContext(ctx).Model(&sqlitex.Referral{}).
		Where("invitee_user_id = ? AND status = ?", inviteeID, string(referral.StatusPending)).
		Updates(updates).Error
}

func toReferrals(rows []sqlitex.Referral) []referral.Referral {
	out := make([]referral.Referral, len(rows))
	for i, row := range rows {
		out[i] = toReferral(row)
	}
	return out
}

func toReferral(row sqlitex.Referral) referral.Referral {
	r := referral.Referral{
		InviteeID:      row.InviteeUserId,
		ReferrerID:     row.ReferrerUserId,
		Code:           row.Code,
		ClaimedAt:      time.UnixMilli(row.ClaimedAt).UTC(),
		Status:         referral.Status(row.Status),
		RewardsBlocked: row.RewardsBlocked,
		RewardAmount:   row.RewardAmount,
		ForfeitReason:  row.ForfeitReason,
		RewardDueAt:    fromMillis(row.RewardDueAt),
		RewardedAt:     fromMillis(row.RewardedAt),
	}
	if row.FirstPaymentKind != nil {
		r.FirstPayment = &referral.FirstPayment{
			Kind:            referral.PaymentKind(*row.FirstPaymentKind),
			PaymentIntentID: deref(row.FirstPaymentIntentId),
			InvoiceID:       deref(row.FirstPaymentInvoiceId),
			Credits:         row.FirstPaymentCredits,
			PaidAt:          fromMillis(row.FirstPaidAt),
		}
	}
	return r
}

func fromMillis(ms *int64) time.Time {
	if ms == nil {
		return time.Time{}
	}
	return time.UnixMilli(*ms).UTC()
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// nullable maps "" to NULL.
func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// ReferralAccounts is referral.AccountRepo over users, the credit ledger and
// trial_grants.
type ReferralAccounts struct {
	Trials TrialGrants
}

func (a ReferralAccounts) TrialUsedByAnotherAccount(ctx context.Context, userID string) (bool, error) {
	return a.Trials.TrialUsedByAnotherAccount(ctx, userID)
}

var _ referral.AccountRepo = ReferralAccounts{}

func (ReferralAccounts) CreatedAt(ctx context.Context, userID string) (time.Time, error) {
	var u sqlitex.User
	if err := sqlitex.DB.WithContext(ctx).Select("created_at").Where("id = ?", userID).First(&u).Error; err != nil {
		return time.Time{}, err
	}
	return u.CreatedAt, nil
}

// Exists: deletion removes the users row (Accounts.DeleteData); a disabled
// user keeps it.
func (ReferralAccounts) Exists(ctx context.Context, userID string) (bool, error) {
	var n int64
	err := sqlitex.DB.WithContext(ctx).Model(&sqlitex.User{}).Where("id = ?", userID).Count(&n).Error
	return n > 0, err
}

// HasPaid: a top-up or subscription grant is the ledger's record of a
// payment. Trials, referral bonuses and admin grants are not.
func (ReferralAccounts) HasPaid(ctx context.Context, userID string) (bool, error) {
	var n int64
	err := sqlitex.DB.WithContext(ctx).Model(&sqlitex.CreditTransaction{}).
		Where("user_id = ? AND type IN ?", userID, []string{"GRANT_TOPUP", "GRANT_SUBSCRIPTION"}).
		Count(&n).Error
	return n > 0, err
}
