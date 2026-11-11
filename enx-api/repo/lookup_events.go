package repo

import (
	"context"

	"enx-api/utils/sqlitex"
)

// AddLookupEvent inserts one lookup event (ADR-059 Decision 1).
func AddLookupEvent(ctx context.Context, e sqlitex.LookupEvent) error {
	return sqlitex.DB.WithContext(ctx).Create(&e).Error
}
