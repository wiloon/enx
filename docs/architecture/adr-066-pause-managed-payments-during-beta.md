---
status: accepted
date: 2026-10-20
related: adr-035/036（国内版）、Linear WIL-189（重开任务）、WIL-120、WIL-53
---

# ADR-066：内测期海外版暂停 Stripe Managed Payments，开启支付宝

海外版生产环境一直走 Stripe Managed Payments（Stripe/Link 当卖家，代缴税、代处理拒付）。2026-10-20 一位内测用户付款失败，结账页提示 "China is not currently supported."。原因是 Managed Payments 的受限国家里有 China（[eligibility](https://docs.stripe.com/payments/managed-payments/eligibility#customer-eligibility)），而且它的付款方式白名单里没有支付宝，Dashboard 里开了支付宝也不会显示。内测期还有不少大陆用户。

我们决定：**国内版上线之前，海外版在 Stripe Live 账号上关闭 Managed Payments，开启支付宝，由我们自己当卖家。国内版上线后，海外版重开 Managed Payments、关闭支付宝（Linear WIL-189）。**

## Considered Options

- **维持 Managed Payments，告诉大陆用户暂时付不了**：零风险，但内测期拿不到大陆用户的付费数据。没选。
- **只让一次性充值绕开 Managed Payments（按 Session 传 `managed_payments[enabled]`），订阅继续走**：税务风险最小，但要按 Session 分流，代码更复杂，而且暂停是临时的。没选。
- **整体关闭（选它）**：一个 Dashboard 开关，回滚也是一个开关。

## Consequences

- 暂停期间的增值税、销售税由我们自己负责。内测期交易量小，大部分来自大陆用户，接受这个风险。
- 拒付由我们自己举证。拒付率高了不仅 Stripe 会限制账户，也会影响重开：Managed Payments 的准入条件里有"历史拒付率低"。
- **暂停期间产生的订阅不会迁进 Managed Payments**（[update-checkout](https://docs.stripe.com/payments/managed-payments/update-checkout)：现有订阅不符合条件），重开后它们仍由我们当卖家。
- `enx-api/billing/stripe/checkout.go` 一直没传 `managed_payments` 参数，依赖账号默认值。暂停期间结账要收税，需要加 `automatic_tax`；重开时要去掉，因为 Managed Payments 不允许这个参数。
