INSERT INTO users (id, clerk_user_id, name, email, status, created_at, updated_at, last_login_time)
VALUES ('u_subscribed', 'user_subscribed', 'Subscribed', 'subscribed@example.com', 'active',
        '2026-09-01 00:00:00+00:00', '2026-09-01 00:00:00+00:00', '2026-10-01 00:00:00+00:00');
INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status, plan, current_period_end, classification, created_at, updated_at)
VALUES ('u_subscribed', 'cus_subscribed', 'sub_subscribed', 'active', 'pro-plus', 1800000000, 'accepted', 1788000000000, 1788000000000);
INSERT INTO credit_accounts (user_id, subscription_balance, topup_balance, period_end, updated_at)
VALUES ('u_subscribed', 500, 0, 1800000000, 1788000000000);
INSERT INTO credit_transactions (id, user_id, type, amount, balance_after, stripe_event_id, stripe_payment_intent_id, created_at)
VALUES ('tx_subscribed_grant', 'u_subscribed', 'GRANT_SUBSCRIPTION', 500, 500, 'evt_subscribed_paid', 'pi_subscribed', 1788000000000);
INSERT INTO stripe_customers (stripe_customer_id,user_id,created_at) VALUES ('cus_subscribed','u_subscribed',1780000000000);
UPDATE users SET accepted_subscription_id='sub_subscribed' WHERE id='u_subscribed';

UPDATE credit_accounts SET pool_grant_id='tx_subscribed_grant' WHERE user_id='u_subscribed';
