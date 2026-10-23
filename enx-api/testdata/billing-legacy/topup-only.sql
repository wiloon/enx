-- A user who only bought a top-up. The subscriptions row holds just the
-- Customer (no Subscription ID, status none). The migration moves the
-- Customer to stripe_customers and creates no subscription.
INSERT INTO users (id, clerk_user_id, name, email, status, created_at, updated_at, last_login_time)
VALUES ('u_topup', 'user_topup', 'Topup', 'topup@example.com', 'active',
        '2026-09-01 00:00:00+00:00', '2026-09-01 00:00:00+00:00', '2026-10-01 00:00:00+00:00');
INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status, plan, current_period_end, created_at, updated_at)
VALUES ('u_topup', 'cus_topup', NULL, 'none', NULL, NULL, 1788000000000, 1788000000000);
INSERT INTO credit_accounts (user_id, subscription_balance, topup_balance, period_end, updated_at)
VALUES ('u_topup', 0, 300, NULL, 1788000000000);
INSERT INTO credit_transactions (id, user_id, type, amount, balance_after, stripe_event_id, stripe_payment_intent_id, created_at)
VALUES ('tx_topup_grant', 'u_topup', 'GRANT_TOPUP', 300, 300, 'evt_topup_paid', 'pi_topup', 1788000000000);
