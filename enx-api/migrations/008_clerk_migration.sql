-- ADR-015: switch auth from AWS Cognito to Clerk.
--
-- Hard cutover: the product is not launched and there are ~0 real users, so
-- there is NO data migration -- test rows are wiped and homelab/test accounts
-- simply sign in again through Clerk (middleware.ClerkAuth -> GetOrCreateByClerkUserID
-- auto-provisions the local user).
--
-- GORM AutoMigrate (utils/sqlitex/sqlitex.go) adds the `clerk_user_id` column and
-- its unique index automatically on startup. glebarez/sqlite AutoMigrate never
-- DROPs columns, so this script does the one-off manual cleanup of the old
-- Cognito column.

-- 1. Wipe test users (no real accounts exist pre-launch).
DELETE FROM users;

-- 2. Drop the Cognito mapping column and its index. SQLite 3.35+ supports
--    DROP COLUMN; the index goes with it.
DROP INDEX IF EXISTS idx_users_cognito_sub;
ALTER TABLE users DROP COLUMN cognito_sub;

-- 3. clerk_user_id + idx_users_clerk_user_id are created by AutoMigrate; if
--    applying this by hand against a DB that has not yet run the new binary:
-- ALTER TABLE users ADD COLUMN clerk_user_id TEXT;
-- CREATE UNIQUE INDEX IF NOT EXISTS idx_users_clerk_user_id ON users(clerk_user_id);
