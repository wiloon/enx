-- #297's defect in the data. Two Checkouts both succeeded; the second
-- (sub_second, Customer cus_second) overwrote the first in the user's row.
-- sub_first survives only as its grant in the ledger. The migration moves
-- sub_second and keeps both grants as they are; it must not invent a
-- subscription for sub_first, whose ID the database no longer holds.
INSERT INTO users (id, clerk_user_id, name, email, status, created_at, updated_at, last_login_time)
VALUES ('u_overwritten', 'user_overwritten', 'Overwritten', 'overwritten@example.com', 'active',
        '2026-09-01 00:00:00+00:00', '2026-09-01 00:00:00+00:00', '2026-10-01 00:00:00+00:00');
INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status, plan, current_period_end, created_at, updated_at)
VALUES ('u_overwritten', 'cus_second', 'sub_second', 'active', 'max', 1800000000, 1788000000000, 1788000001000);
INSERT INTO credit_accounts (user_id, subscription_balance, topup_balance, period_end, updated_at)
VALUES ('u_overwritten', 900, 0, 1800000000, 1788000001000);
INSERT INTO credit_transactions (id, user_id, type, amount, balance_after, stripe_event_id, stripe_payment_intent_id, created_at)
VALUES ('tx_overwritten_first', 'u_overwritten', 'GRANT_SUBSCRIPTION', 100, 100, 'evt_first_paid', 'pi_first', 1788000000000);
INSERT INTO credit_transactions (id, user_id, type, amount, balance_after, stripe_event_id, stripe_payment_intent_id, created_at)
VALUES ('tx_overwritten_second', 'u_overwritten', 'GRANT_SUBSCRIPTION', 900, 900, 'evt_second_paid', 'pi_second', 1788000001000);
