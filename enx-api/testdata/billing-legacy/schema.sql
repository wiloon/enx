-- The billing schema before the #297 subscription cutover (ADR-067), exactly
-- as today's GORM models create it. subscriptions is keyed by user: one row
-- per user holding at most one Stripe Subscription ID, and its unique
-- stripe_customer_id index means one Customer can never appear on two rows,
-- so a Customer shared between users cannot exist in legacy data.
CREATE TABLE `users` (`id` text,`clerk_user_id` text,`name` text,`email` text,`password` text,`status` text DEFAULT "pending",`verification_token` text,`token_expires_at` datetime,`reset_token` text,`reset_token_expires_at` datetime,`created_at` datetime,`updated_at` datetime,`last_login_time` datetime,`avatar_url` text,PRIMARY KEY (`id`));
CREATE UNIQUE INDEX `idx_users_clerk_user_id` ON `users`(`clerk_user_id`);
CREATE TABLE `subscriptions` (`user_id` text,`stripe_customer_id` text NOT NULL,`stripe_subscription_id` text,`status` text NOT NULL DEFAULT "none",`plan` text,`current_period_end` integer,`created_at` integer NOT NULL,`updated_at` integer NOT NULL,PRIMARY KEY (`user_id`));
CREATE UNIQUE INDEX `idx_subscriptions_stripe_subscription_id` ON `subscriptions`(`stripe_subscription_id`);
CREATE UNIQUE INDEX `idx_subscriptions_stripe_customer_id` ON `subscriptions`(`stripe_customer_id`);
CREATE TABLE `credit_accounts` (`user_id` text,`subscription_balance` integer NOT NULL DEFAULT 0,`topup_balance` integer NOT NULL DEFAULT 0,`period_end` integer,`trial_balance` integer NOT NULL DEFAULT 0,`trial_expires_at` integer,`updated_at` integer NOT NULL,PRIMARY KEY (`user_id`));
CREATE TABLE `credit_transactions` (`id` text,`user_id` text,`type` text NOT NULL,`amount` integer NOT NULL,`balance_after` integer NOT NULL,`stripe_event_id` text,`feature` text,`stripe_payment_intent_id` text,`related_transaction_id` text,`note` text,`created_at` integer NOT NULL,PRIMARY KEY (`id`));
CREATE INDEX `idx_credit_transactions_stripe_payment_intent_id` ON `credit_transactions`(`stripe_payment_intent_id`);
CREATE UNIQUE INDEX `idx_credit_transactions_stripe_event_id` ON `credit_transactions`(`stripe_event_id`);
CREATE INDEX `idx_credit_transactions_user_id` ON `credit_transactions`(`user_id`);
