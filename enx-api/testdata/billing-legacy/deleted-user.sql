-- A deleted account (ADR-062): the users and credit_accounts rows are gone,
-- the subscription row and the ledger are kept, including a refund's
-- CLAWBACK linked to its grant. The migration keeps all of it and must not
-- recreate the user, a balance or an accepted subscription.
INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status, plan, current_period_end, created_at, updated_at)
VALUES ('u_deleted', 'cus_deleted', 'sub_deleted', 'canceled', 'pro', 1700000000, 1780000000000, 1790000000000);
INSERT INTO credit_transactions (id, user_id, type, amount, balance_after, stripe_event_id, stripe_payment_intent_id, created_at)
VALUES ('tx_deleted_grant', 'u_deleted', 'GRANT_SUBSCRIPTION', 100, 100, 'evt_deleted_paid', 'pi_deleted', 1780000000000);
INSERT INTO credit_transactions (id, user_id, type, amount, balance_after, stripe_event_id, related_transaction_id, note, created_at)
VALUES ('tx_deleted_clawback', 'u_deleted', 'CLAWBACK', -100, 0, 'evt_deleted_refund', 'tx_deleted_grant',
        'Stripe charge ch_deleted, 1000 of 1000 refunded', 1785000000000);
