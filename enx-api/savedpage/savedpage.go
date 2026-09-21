// Package savedpage stores the pages a user chose to save (ADR-032): URL and
// title only, readable and editable by that user alone.
package savedpage

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"

	"enx-api/urlnorm"
	"enx-api/utils/sqlitex"
)

// MaxTitleLength is the title limit in characters (not bytes): titles are
// often Chinese, and a byte limit would cut one mid-character.
const MaxTitleLength = 200

// MaxPerUser is the per-user cap on saved pages (ADR-032 Decision 3).
const MaxPerUser = 1000

// ErrLimitReached is returned when saving would exceed MaxPerUser. Nothing is
// evicted to make room: these are the user's pages, not a diagnostic log.
var ErrLimitReached = errors.New("savedpage: saved page limit reached")

// ErrNotFound is returned for an id that does not exist OR belongs to another
// user. The two are deliberately indistinguishable, so an id never reveals
// whether someone else has saved something.
var ErrNotFound = errors.New("savedpage: not found")

// ErrDuplicate is returned when an edit would make a page's URL equal to
// another page the same user has already saved.
var ErrDuplicate = errors.New("savedpage: another saved page already has this URL")

// Input is one page as the client submits it.
type Input struct {
	URL   string
	Title string
}

// Page is a saved page as returned to its owner.
type Page struct {
	ID        string
	URL       string
	Title     string
	Host      string
	CreatedAt time.Time
}

func pageFromRow(row sqlitex.SavedPage) Page {
	return Page{
		ID:        row.ID,
		URL:       row.URL,
		Title:     row.Title,
		Host:      row.Host,
		CreatedAt: time.UnixMilli(row.CreatedAt),
	}
}

// Save stores in for userID.
func Save(ctx context.Context, userID string, in Input, now time.Time) (page Page, created bool, err error) {
	pageURL, host, err := urlnorm.ForSave(in.URL)
	if err != nil {
		return Page{}, false, err
	}
	var existing sqlitex.SavedPage
	res := sqlitex.DB.WithContext(ctx).
		Where("user_id = ? AND url = ?", userID, pageURL).
		Limit(1).Find(&existing)
	if res.Error != nil {
		return Page{}, false, res.Error
	}
	if res.RowsAffected > 0 {
		return pageFromRow(existing), false, nil
	}

	var count int64
	if err := sqlitex.DB.WithContext(ctx).Model(&sqlitex.SavedPage{}).
		Where("user_id = ?", userID).Count(&count).Error; err != nil {
		return Page{}, false, err
	}
	if count >= MaxPerUser {
		return Page{}, false, ErrLimitReached
	}

	row := sqlitex.SavedPage{
		ID:        uuid.NewString(),
		UserID:    userID,
		URL:       pageURL,
		Title:     truncateTitle(in.Title),
		Host:      host,
		CreatedAt: now.UnixMilli(),
	}
	if err := sqlitex.DB.WithContext(ctx).Create(&row).Error; err != nil {
		return Page{}, false, err
	}
	return pageFromRow(row), true, nil
}

// List returns userID's saved pages, newest first.
func List(ctx context.Context, userID string) ([]Page, error) {
	var rows []sqlitex.SavedPage
	if err := sqlitex.DB.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("created_at DESC, id DESC").
		Find(&rows).Error; err != nil {
		return nil, err
	}
	pages := make([]Page, len(rows))
	for i, row := range rows {
		pages[i] = pageFromRow(row)
	}
	return pages, nil
}

func truncateTitle(title string) string {
	runes := []rune(title)
	if len(runes) <= MaxTitleLength {
		return title
	}
	return string(runes[:MaxTitleLength])
}

// Delete removes one of userID's pages.
func Delete(ctx context.Context, userID, id string) error {
	res := sqlitex.DB.WithContext(ctx).
		Where("user_id = ? AND id = ?", userID, id).
		Delete(&sqlitex.SavedPage{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteAll removes every page userID has saved and returns how many. It is
// what account deletion will call (ADR-032 Decision 3).
func DeleteAll(ctx context.Context, userID string) (int64, error) {
	res := sqlitex.DB.WithContext(ctx).
		Where("user_id = ?", userID).
		Delete(&sqlitex.SavedPage{})
	return res.RowsAffected, res.Error
}

// Patch is a partial edit: nil fields are left as they are.
type Patch struct {
	URL   *string
	Title *string
}

// Update edits one of userID's pages.
func Update(ctx context.Context, userID, id string, patch Patch) (Page, error) {
	var row sqlitex.SavedPage
	res := sqlitex.DB.WithContext(ctx).
		Where("user_id = ? AND id = ?", userID, id).
		Limit(1).Find(&row)
	if res.Error != nil {
		return Page{}, res.Error
	}
	if res.RowsAffected == 0 {
		return Page{}, ErrNotFound
	}

	if patch.URL != nil {
		pageURL, host, err := urlnorm.ForSave(*patch.URL)
		if err != nil {
			return Page{}, err
		}
		if pageURL != row.URL {
			var clash int64
			if err := sqlitex.DB.WithContext(ctx).Model(&sqlitex.SavedPage{}).
				Where("user_id = ? AND url = ? AND id <> ?", userID, pageURL, id).
				Count(&clash).Error; err != nil {
				return Page{}, err
			}
			if clash > 0 {
				return Page{}, ErrDuplicate
			}
		}
		row.URL = pageURL
		row.Host = host
	}
	if patch.Title != nil {
		row.Title = truncateTitle(*patch.Title)
	}
	if err := sqlitex.DB.WithContext(ctx).Save(&row).Error; err != nil {
		return Page{}, err
	}
	return pageFromRow(row), nil
}
