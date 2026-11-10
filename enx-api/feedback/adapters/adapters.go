// Package adapters backs feedback.Store with the feedback table.
package adapters

import (
	"context"
	"encoding/json"
	"time"

	"gorm.io/gorm"

	"enx-api/email"
	"enx-api/feedback"
	"enx-api/utils/sqlitex"
)

// Table is feedback.Store over the feedback table (ADR-076).
type Table struct{}

var _ feedback.Store = Table{}

// Admit relies on the connection's _txlock=immediate: the transaction takes
// the write lock at BEGIN, so concurrent admissions run one after another
// and each sees the rows the previous one committed.
func (Table) Admit(ctx context.Context, fn func(feedback.Admission) error) error {
	return sqlitex.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return fn(feedbackAdmission{tx: tx})
	})
}

type feedbackAdmission struct{ tx *gorm.DB }

func (a feedbackAdmission) HasPageReportSince(userID, url, reason string, since time.Time) (bool, error) {
	var n int64
	err := a.tx.Model(&sqlitex.Feedback{}).
		Where("user_id = ? AND kind = ? AND url = ? AND json_extract(details, '$.reason') = ? AND created_at > ?",
			userID, string(feedback.KindPageReport), url, reason, since.UnixMilli()).
		Count(&n).Error
	return n > 0, err
}

func (a feedbackAdmission) HasArticleChoice(userID, host, selector string) (bool, error) {
	var n int64
	err := a.tx.Model(&sqlitex.Feedback{}).
		Where("user_id = ? AND kind = ? AND host = ? AND "+selectorExpr+" = ?",
			userID, string(feedback.KindArticleChoice), host, selector).
		Count(&n).Error
	return n > 0, err
}

func (a feedbackAdmission) CountCreated(userID string, from, to time.Time) (int64, error) {
	var n int64
	err := a.tx.Model(&sqlitex.Feedback{}).
		Where("user_id = ? AND created_at >= ? AND created_at < ?", userID, from.UnixMilli(), to.UnixMilli()).
		Count(&n).Error
	return n, err
}

func (a feedbackAdmission) Insert(r feedback.Record) error {
	return a.tx.Create(&sqlitex.Feedback{
		ID: r.ID, UserID: r.UserID, Kind: string(r.Kind), URL: r.URL, Host: r.Host, Text: r.Text,
		Context: jsonObject(r.Context), Details: jsonObject(r.Details),
		Status: string(r.Status), CreatedAt: r.CreatedAt.UnixMilli(),
	}).Error
}

func (Table) List(ctx context.Context, q feedback.ListQuery) ([]feedback.Record, error) {
	db := sqlitex.DB.WithContext(ctx).Model(&sqlitex.Feedback{})
	if q.Kind != "" {
		db = db.Where("kind = ?", string(q.Kind))
	}
	if q.Status != "" {
		db = db.Where("status = ?", string(q.Status))
	}
	var rows []sqlitex.Feedback
	if err := db.Order("created_at DESC, id DESC").Limit(q.Limit).Offset(q.Offset).Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]feedback.Record, len(rows))
	for i, r := range rows {
		out[i] = feedback.Record{
			ID: r.ID, UserID: r.UserID, Kind: feedback.Kind(r.Kind), URL: r.URL, Host: r.Host, Text: r.Text,
			Context: json.RawMessage(jsonObject([]byte(r.Context))), Details: json.RawMessage(jsonObject([]byte(r.Details))),
			Status: feedback.Status(r.Status), CreatedAt: time.UnixMilli(r.CreatedAt),
		}
	}
	return out, nil
}

func (Table) SetStatus(ctx context.Context, id string, status feedback.Status) (bool, error) {
	res := sqlitex.DB.WithContext(ctx).Model(&sqlitex.Feedback{}).Where("id = ?", id).Update("status", string(status))
	return res.RowsAffected > 0, res.Error
}

// selectorExpr is an article choice's selector, compared byte for byte.
const selectorExpr = "json_extract(details, '$.selector')"

// articleChoiceGroupsSQL groups the article choices whose status matches
// (an empty status matches all) by host + selector. The sample is the
// newest matching record's URL, ties broken by id, so pages are stable.
const articleChoiceGroupsSQL = `
SELECT f.host AS host, json_extract(f.details, '$.selector') AS selector, COUNT(*) AS count,
  (SELECT COUNT(*) FROM feedback t
    WHERE t.kind = f.kind AND t.host = f.host
      AND json_extract(t.details, '$.selector') = json_extract(f.details, '$.selector')) AS total,
  (SELECT s.url FROM feedback s
    WHERE s.kind = f.kind AND s.host = f.host
      AND json_extract(s.details, '$.selector') = json_extract(f.details, '$.selector')
      AND (@status = '' OR s.status = @status)
    ORDER BY s.created_at DESC, s.id DESC LIMIT 1) AS sample_url
FROM feedback f
WHERE f.kind = @kind AND (@status = '' OR f.status = @status)
GROUP BY f.host, json_extract(f.details, '$.selector')
ORDER BY count DESC, host, selector
LIMIT @limit OFFSET @offset`

func (Table) ArticleChoiceGroups(ctx context.Context, q feedback.GroupQuery) ([]feedback.ArticleChoiceGroup, error) {
	var groups []feedback.ArticleChoiceGroup
	err := sqlitex.DB.WithContext(ctx).Raw(articleChoiceGroupsSQL, map[string]any{
		"kind": string(feedback.KindArticleChoice), "status": string(q.Status), "limit": q.Limit, "offset": q.Offset,
	}).Scan(&groups).Error
	return groups, err
}

func (Table) SetArticleChoiceGroupStatus(ctx context.Context, host, selector string, status feedback.Status) (int64, error) {
	res := sqlitex.DB.WithContext(ctx).Model(&sqlitex.Feedback{}).
		Where("kind = ? AND host = ? AND "+selectorExpr+" = ?", string(feedback.KindArticleChoice), host, selector).
		Update("status", string(status))
	return res.RowsAffected, res.Error
}

// Mail is feedback.Notifier over the Resend admin email (ADR-010 Decision
// 12). Only page reports are submitted yet, so only they have an email.
type Mail struct {
	Sender *email.Sender
}

var _ feedback.Notifier = Mail{}

func (m Mail) NotifyNewFeedback(r feedback.Record) error {
	pr, ok := r.PageReport()
	if !ok {
		return nil
	}
	return m.Sender.NotifyAdminPageReport(email.PageReportNotify{
		URL: r.URL, Host: r.Host, Reason: pr.Reason, Adapter: pr.Adapter, ExtVersion: pr.ExtVersion, CreatedAt: r.CreatedAt,
	})
}

// jsonObject stores a missing object as {}.
func jsonObject(raw []byte) string {
	if len(raw) == 0 {
		return "{}"
	}
	return string(raw)
}
