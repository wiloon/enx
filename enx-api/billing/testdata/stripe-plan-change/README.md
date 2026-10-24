# Stripe plan-change fixtures (#297)

Real Sandbox webhook events, captured 2026-10-24 with a test clock. API version
`2026-07-29.dahlia`, `billing_mode=flexible`, default Portal configuration with
`always_invoice` and the `decreasing_item_amount` period-end condition (ADR-067).
Every plan change went through ENX's deep link (`flow_data.type=subscription_update_confirm`
for the existing item and target Price), not the Portal's own plan picker.

Files are numbered in Stripe's creation order. Webhooks may arrive in any order.

| Clock | Action | Invoice |
|---|---|---|
| day 0 | subscribe to Pro ($3.99) | `02` `subscription_create`: one full-period line, Pro |
| day 10 | deep link Pro → Pro+, paid at once | `03` `subscription_update`, $4.07: −Pro and +Pro+ proration lines, 21 of 31 days |
| day 15 | deep link Pro+ → Max, paid at once | `05` `subscription_update`, $5.16: −Pro+ and +Max proration lines, 16 of 31 days |
| day 18 | deep link Max → Pro | none; the Portal creates a Subscription Schedule (`08`) for the period end |
| day 31 | renewal | `15` `subscription_cycle`, $3.99: one full-period line, Pro; the schedule is released (`11`–`13`) |

What this settles for the invoice classifier:

- The deep link follows the configuration: upgrades invoice and charge immediately, the
  downgrade waits for the period end.
- The first renewal after a scheduled downgrade carries `billing_reason=subscription_cycle`,
  with a single non-proration line for the lower tier.
- Each upgrade invoice's negative proration line names the tier being left, also on the
  second upgrade in the same period (`05`: −Pro+, not −Pro).
- Proration line periods run from the change to the period end. The full period (the
  upgrade denominator) is on the normal grant's line: `02` covers the 31-day period both
  upgrades fall in.
- `invoice.period_start`/`period_end` are not the service period: on `15` they are the
  previous period. Read periods from the lines.
- The schedule's end emits `subscription_schedule.expiring` (`11`), which ADR-067's list of
  snapshot-only events does not name yet.
