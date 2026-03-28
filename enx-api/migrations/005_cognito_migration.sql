-- Cognito auth: add cognito_sub for mapping Cognito identities to local users.
-- Legacy password columns are left in place; new users use cognito_sub only.

ALTER TABLE users ADD COLUMN cognito_sub TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_cognito_sub ON users(cognito_sub);
