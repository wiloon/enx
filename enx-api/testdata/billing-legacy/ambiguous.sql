-- Rows a migration's preflight must stop on rather than guess about.

-- Status active with no Subscription ID (rows like this are seeded by
-- tests and could exist after a manual fix): nothing to migrate as a
-- subscription, yet entitlement counts the user as a subscriber.
INSERT INTO users (id, clerk_user_id, name, email, status, created_at, updated_at, last_login_time)
VALUES ('u_active_without_subscription', 'user_active_without_subscription', 'No Sub', 'nosub@example.com', 'active',
        '2026-09-01 00:00:00+00:00', '2026-09-01 00:00:00+00:00', '2026-10-01 00:00:00+00:00');
INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status, plan, current_period_end, created_at, updated_at)
VALUES ('u_active_without_subscription', 'cus_active_without_subscription', NULL, 'active', 'pro', 1800000000, 1788000000000, 1788000000000);

-- A plan value from before the three tiers (monthly/annual): no effective
-- tier can be seeded from it.
INSERT INTO users (id, clerk_user_id, name, email, status, created_at, updated_at, last_login_time)
VALUES ('u_legacy_plan', 'user_legacy_plan', 'Legacy Plan', 'legacyplan@example.com', 'active',
        '2026-05-01 00:00:00+00:00', '2026-05-01 00:00:00+00:00', '2026-10-01 00:00:00+00:00');
INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status, plan, current_period_end, created_at, updated_at)
VALUES ('u_legacy_plan', 'cus_legacy_plan', 'sub_legacy_plan', 'active', 'monthly', 1800000000, 1777000000000, 1788000000000);

-- A subscription grant in the ledger with no subscriptions row at all: the
-- Subscription ID is unknown, so neither a subscription nor its pool
-- provenance can be migrated.
INSERT INTO users (id, clerk_user_id, name, email, status, created_at, updated_at, last_login_time)
VALUES ('u_ledger_without_subscription', 'user_ledger_without_subscription', 'Ledger Only', 'ledgeronly@example.com', 'active',
        '2026-09-01 00:00:00+00:00', '2026-09-01 00:00:00+00:00', '2026-10-01 00:00:00+00:00');
INSERT INTO credit_accounts (user_id, subscription_balance, topup_balance, period_end, updated_at)
VALUES ('u_ledger_without_subscription', 100, 0, 1800000000, 1788000000000);
INSERT INTO credit_transactions (id, user_id, type, amount, balance_after, stripe_event_id, stripe_payment_intent_id, created_at)
VALUES ('tx_ledger_without_subscription', 'u_ledger_without_subscription', 'GRANT_SUBSCRIPTION', 100, 100, 'evt_orphan_paid', 'pi_orphan', 1788000000000);
