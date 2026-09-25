import type { Metadata } from 'next'
import { LegalPage, List, Section, Term } from '@/components/site/LegalPage'
import { LEGAL } from '@/lib/legal'
import { SITE } from '@/lib/site'

// 退款政策（中文版）。LAUNCH-CHECKLIST §6.2b。
//
// 退款规则写在收费之前才有约束力 —— 这一页存在的意义就在于规则先于投诉存在。
// 与 /refund 逐节对应。
export const dynamic = 'force-static'

export const metadata: Metadata = {
  title: `退款政策 — ${SITE.name}`,
  description: `${SITE.name} 在什么情况下退钱，以及怎么申请。`,
  alternates: { canonical: '/zh/refund', languages: { en: '/refund' } },
}

export default function RefundPolicyZhPage() {
  return (
    <LegalPage
      locale="zh"
      enHref="/refund"
      title="退款政策"
      intro={`如果 ${SITE.name} 不合你用，我们宁可把钱退给你，也不愿留着。以下是规则，事先写下来，方便你据此要求我们。`}
    >
      <Section heading="订阅">
        <p>
          <Term>新订阅的首次扣费</Term>可在{' '}
          <Term>{LEGAL.subscriptionRefundDays} 天内</Term>全额退款，不限理由。
          你不需要解释，我们也不会要求你举证。
        </p>
        <p>
          超过这个窗口后，已经开始的订阅周期不退款，但你可以随时取消以停止下一次续订。
          取消后你的访问权限保留到已付费周期结束 ——
          你从不会损失已经付过钱的时间。
        </p>
        <p>另有两种情形，我们会在窗口之外退款，且不需要你据理力争：</p>
        <List
          items={[
            <>
              <Term>你没预料到的续费。</Term>
              如果你本打算取消却被续费扣款，且该周期内你并未使用服务，
              写信给我们，我们会退款。
            </>,
            <>
              <Term>长时间停机。</Term>
              如果 {SITE.name} 在你已付费的周期内有相当一部分时间不可用，
              我们会退还这一部分。
            </>,
          ]}
        />
      </Section>

      <Section heading="积分">
        <p>
          <Term>未消费的积分可随时退款</Term>，按你购买时的价格。
          提出申请，我们就退还你尚未花掉的余额。
        </p>
        <p>
          <Term>已经消费掉的积分不予退款。</Term>
          每一分都对应一次已经发生、并已在当时向我们计费的 AI 调用，
          没有什么可退回的了。你随时可以在账单页看到积分花在了哪里。
        </p>
        <p>
          如果积分是被我们这边明显出错的情况消耗掉的 —— 请求失败却仍然扣费、
          重复调用、程序缺陷 —— 那不是退款问题。告诉我们，我们把积分补回去。
        </p>
      </Section>

      <Section heading="你作为消费者的法定权利">
        <p>
          依据你所在地的法律，你可能享有在一定期限内取消数字服务购买的法定权利。
          本政策不取代该权利，本页也没有任何内容剥夺它。
          <Term>你所在地的法律给你的保护高于本页时，以法律为准。</Term>
        </p>
      </Section>

      <Section heading="怎么申请">
        <p>
          用你账号上的邮箱地址写信到 <Term>{LEGAL.contactEmail}</Term>，
          告诉我们你希望退哪一笔。不需要填表，也不需要给理由。
        </p>
        <p>
          我们会在 <Term>{LEGAL.refundResponseDays} 个工作日</Term>内回复。
          通过审核的退款经 Stripe 原路退回原支付方式；
          之后多久到账取决于你的发卡行，通常是 5–10 个工作日。
        </p>
      </Section>

      <Section heading="拒付（Chargeback）">
        <p>
          如果你的账单上有看起来不对的地方，请先写信给我们，
          不要直接向银行发起拒付 —— 我们几乎总能更快地解决，
          而拒付会在银行调查期间自动冻结账号。
        </p>
      </Section>

      <Section heading="滥用">
        <p>
          若账号违反了
          <a
            href="/zh/terms"
            className="underline underline-offset-4 hover:text-foreground"
          >
            用户协议
          </a>
          ，或其行为模式明显是在试图免费使用服务 —— 反复订阅、消耗积分、再退款
          —— 我们可能拒绝退款。这一条不是针对任何改变主意的人；
          它针对的是那种一看就知道的情况。
        </p>
      </Section>

      <Section heading="联系方式">
        <p>
          {SITE.name} 由 <Term>{LEGAL.operatorName}</Term> 运营 —{' '}
          <Term>{LEGAL.contactEmail}</Term>
        </p>
      </Section>
    </LegalPage>
  )
}
