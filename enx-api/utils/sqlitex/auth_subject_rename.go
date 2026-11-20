package sqlitex

import (
	"fmt"

	zapLog "enx-api/utils/logger"

	"gorm.io/gorm"
)

// Steps afterStep hears about during the auth_subject rename, in order.
const (
	stepAuthSubjectColumnRenamed = "column_renamed"
	stepAuthSubjectIndexReplaced = "index_replaced"
)

// authSubjectRename renames users.clerk_user_id to users.auth_subject and
// replaces idx_users_clerk_user_id with idx_users_auth_subject in one
// transaction (ADR-036 / #1027). afterStep lets tests fail mid-migration.
type authSubjectRename struct {
	afterStep func(step string, tx *gorm.DB) error
}

// renameUsersClerkUserIDToAuthSubject renames the external-auth subject
// column before AutoMigrate. A fresh database and an already migrated schema
// are no-ops. Both columns present, or any migration error, fails startup.
func renameUsersClerkUserIDToAuthSubject(db *gorm.DB) error {
	return authSubjectRename{}.run(db)
}

func (r authSubjectRename) run(db *gorm.DB) error {
	if !db.Migrator().HasTable("users") {
		return nil
	}
	hasOld := db.Migrator().HasColumn("users", "clerk_user_id")
	hasNew := db.Migrator().HasColumn("users", "auth_subject")
	switch {
	case !hasOld && !hasNew:
		return nil
	case !hasOld && hasNew:
		return nil
	case hasOld && hasNew:
		return fmt.Errorf("users has both clerk_user_id and auth_subject; refuse to guess which is current")
	}

	zapLog.Info("renaming users.clerk_user_id to auth_subject")
	if err := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`ALTER TABLE users RENAME COLUMN clerk_user_id TO auth_subject`).Error; err != nil {
			return fmt.Errorf("rename users.clerk_user_id to auth_subject: %w", err)
		}
		if r.afterStep != nil {
			if err := r.afterStep(stepAuthSubjectColumnRenamed, tx); err != nil {
				return err
			}
		}
		if err := tx.Exec(`DROP INDEX IF EXISTS idx_users_clerk_user_id`).Error; err != nil {
			return fmt.Errorf("drop idx_users_clerk_user_id: %w", err)
		}
		if err := tx.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_auth_subject ON users(auth_subject)`).Error; err != nil {
			return fmt.Errorf("create idx_users_auth_subject: %w", err)
		}
		if r.afterStep != nil {
			if err := r.afterStep(stepAuthSubjectIndexReplaced, tx); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		return fmt.Errorf("auth_subject rename: %w", err)
	}
	return nil
}
