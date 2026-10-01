package repo

import (
	"errors"
	"time"

	"enx-api/utils/logger"
	"enx-api/utils/sqlitex"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// AdminGetWord looks up a words-table row the way GetWordByEnglish does (any
// case, either apostrophe), but WITHOUT the `deleted_at IS NULL` filter: the
// admin maintenance page (ADR-021) needs to see the raw row, soft-delete
// tombstones included. found reports whether any row matched.
func AdminGetWord(english string) (*Word, bool) {
	english = CanonicalEnglish(english)
	word := &Word{}
	err := sqlitex.DB.Where("english = ?", english).First(word).Error
	if err != nil {
		logger.Debugf("AdminGetWord: not found: %s (%v)", english, err)
		return nil, false
	}
	return word, true
}

// AdminSyncWordFromEcdict writes chinese/pronunciation onto the words-table
// row for english (matched as AdminGetWord does), creating the row if absent
// (fresh UUID, load_count 0). If the matched row was soft-deleted it is
// revived (deleted_at cleared) -- otherwise the sync would have no effect on
// user lookups, which filter deleted_at IS NULL. Returns the row as it stands
// after the write. Idempotent. Authz and audit logging are the caller's
// responsibility (ADR-021).
//
// The row ends up as a plain ECDICT row: source "ecdict" and no admin edit
// recorded, since the sync replaces whatever an admin or the AI had put there.
func AdminSyncWordFromEcdict(english, chinese, pronunciation string) (*Word, error) {
	english = CanonicalEnglish(english)
	now := time.Now().UnixMilli()

	if existing, found := AdminGetWord(english); found {
		err := sqlitex.DB.Model(&Word{}).Where("id = ?", existing.Id).Updates(map[string]any{
			"chinese":         chinese,
			"pronunciation":   pronunciation,
			"updated_at":      now,
			"deleted_at":      nil,
			"source":          WordSourceECDICT,
			"admin_edited_at": nil,
		}).Error
		if err != nil {
			return nil, err
		}
		existing.Chinese = chinese
		existing.Pronunciation = pronunciation
		existing.UpdatedAt = now
		existing.DeletedAt = nil
		existing.Source = WordSourceECDICT
		existing.AdminEditedAt = nil
		return existing, nil
	}

	row := &Word{
		Id:            uuid.NewString(),
		English:       english,
		Chinese:       chinese,
		Pronunciation: pronunciation,
		LoadCount:     0,
		CreatedAt:     now,
		UpdatedAt:     now,
		Source:        WordSourceECDICT,
	}
	if err := sqlitex.DB.Create(row).Error; err != nil {
		return nil, err
	}
	return row, nil
}

// ErrWordNotFound: AdminEditWord found no live words row to edit.
var ErrWordNotFound = errors.New("repo: no live words row for that word")

// AdminEditWord replaces chinese/pronunciation on the live words row for
// english (matched as AdminGetWord does) and records the edit in
// admin_edited_at. The row's source is left alone -- an edited AI row is
// still an AI-sourced row, now reviewed by a person (ADR-045 Decision 6).
// A soft-deleted row is not edited: it returns ErrWordNotFound. Authz and
// audit logging are the caller's responsibility (ADR-021).
func AdminEditWord(english, chinese, pronunciation string) (*Word, error) {
	existing, found := AdminGetWord(english)
	if !found || existing.DeletedAt != nil {
		return nil, ErrWordNotFound
	}
	now := time.Now().UnixMilli()
	err := sqlitex.DB.Model(&Word{}).Where("id = ?", existing.Id).Updates(map[string]any{
		"chinese":         chinese,
		"pronunciation":   pronunciation,
		"updated_at":      now,
		"admin_edited_at": now,
	}).Error
	if err != nil {
		return nil, err
	}
	existing.Chinese = chinese
	existing.Pronunciation = pronunciation
	existing.UpdatedAt = now
	existing.AdminEditedAt = &now
	return existing, nil
}

// AdminDeleteWord removes the words row for english (exact match) and every
// user's user_dicts row for it, in one transaction. The words table is a
// shared cache, so this resets that word for every user; the next lookup
// re-fills it from ECDICT. deleted reports whether a words row existed.
func AdminDeleteWord(english string) (deleted bool, err error) {
	english = CanonicalEnglish(english)
	err = sqlitex.DB.Transaction(func(tx *gorm.DB) error {
		var w Word
		if err := tx.Where("english = ?", english).Limit(1).Find(&w).Error; err != nil {
			return err
		}
		if w.Id == "" {
			return nil
		}
		if err := tx.Where("word_id = ?", w.Id).Delete(&UserDict{}).Error; err != nil {
			return err
		}
		if err := tx.Where("id = ?", w.Id).Delete(&Word{}).Error; err != nil {
			return err
		}
		deleted = true
		return nil
	})
	return deleted, err
}
