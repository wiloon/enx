-- A subscription that ended in Stripe. The row keeps its Subscription ID,
-- Customer and last plan; the pool keeps what was left of the last period.
-- The migration keeps it as ended accepted history, and a new subscription
-- may replace it.
INSERT INTO users (id, clerk_user_id, name, email, status, created_at, updated_at, last_login_time)
VALUES ('u_ended', 'user_ended', 'Ended', 'ended@example.com', 'active',
        '2026-06-01 00:00:00+00:00', '2026-06-01 00:00:00+00:00', '2026-10-01 00:00:00+00:00');
INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status, plan, current_period_end, created_at, updated_at)
VALUES ('u_ended', 'cus_ended', 'sub_ended', 'canceled', 'pro', 1700000000, 1780000000000, 1790000000000);
INSERT INTO credit_accounts (user_id, subscription_balance, topup_balance, period_end, updated_at)
VALUES ('u_ended', 80, 0, 1700000000, 1790000000000);
INSERT INTO credit_transactions (id, user_id, type, amount, balance_after, stripe_event_id, stripe_payment_intent_id, created_at)
VALUES ('tx_ended_grant', 'u_ended', 'GRANT_SUBSCRIPTION', 100, 100, 'evt_ended_paid', 'pi_ended', 1780000000000);
