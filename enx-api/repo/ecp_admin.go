package repo

import (
	"time"

	"enx-api/utils/logger"
	"enx-api/utils/sqlitex"

	"github.com/google/uuid"
)

// AdminGetWord looks up a words-table row by exact english, then
// case-insensitive -- the same matching GetWordByEnglish does, but WITHOUT the
// `deleted_at IS NULL` filter: the admin maintenance page (ADR-021) needs to
// see the raw row, soft-delete tombstones included. found reports whether any
// row matched.
func AdminGetWord(english string) (*Word, bool) {
	word := &Word{}
	err := sqlitex.DB.Where("english = ?", english).First(word).Error
	if err != nil {
		err = sqlitex.DB.Where("LOWER(english) = LOWER(?)", english).First(word).Error
	}
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
func AdminSyncWordFromEcdict(english, chinese, pronunciation string) (*Word, error) {
	now := time.Now().UnixMilli()

	if existing, found := AdminGetWord(english); found {
		err := sqlitex.DB.Model(&Word{}).Where("id = ?", existing.Id).Updates(map[string]any{
			"chinese":       chinese,
			"pronunciation": pronunciation,
			"updated_at":    now,
			"deleted_at":    nil,
		}).Error
		if err != nil {
			return nil, err
		}
		existing.Chinese = chinese
		existing.Pronunciation = pronunciation
		existing.UpdatedAt = now
		existing.DeletedAt = nil
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
	}
	if err := sqlitex.DB.Create(row).Error; err != nil {
		return nil, err
	}
	return row, nil
}
