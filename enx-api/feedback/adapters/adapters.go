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
