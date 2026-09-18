import type { Metadata } from 'next'
import { LegalPage, List, Section, Term } from '@/components/site/LegalPage'
import { LEGAL } from '@/lib/legal'
import { SITE } from '@/lib/site'

// 用户协议（中文版）。LAUNCH-CHECKLIST §6.2b。
//
// ⚠️ 中文版声明「以中文版为准」，所以第 11 条（责任限制）和第 7 条（准确性）
// 的措辞是有法律后果的，不是英文版的顺手翻译。《民法典》第 496 条要求提供格式
// 条款的一方对免除或减轻自己责任的条款尽到提示说明义务 —— 这正是把这两条加粗、
// 单独成节、并用平实中文写出来的原因。
//
// ⚠️ 与 /terms 逐节对应，app/__tests__/legal.test.tsx 比对两版小节数量。
export const dynamic = 'force-static'

export const metadata: Metadata = {
  title: `用户协议 — ${SITE.name}`,
  description: `使用 ${SITE.name} 时你所同意的条款。`,
  alternates: { canonical: '/zh/terms', languages: { en: '/terms' } },
}

export default function TermsZhPage() {
  return (
    <LegalPage
      locale="zh"
      enHref="/terms"
      title="用户协议"
      intro={`本协议是你与运营 ${SITE.name} 的个人 ${LEGAL.operatorName} 之间的约定。使用本服务即表示你接受这些条款。`}
    >
      <Section heading="1. 服务内容">
        <p>
          {SITE.name} 是一个浏览器扩展和网站，帮助你阅读英文：
          它会给值得学的词加下划线、查询释义、翻译你划选的句子，
          并为你维护生词本和阅读统计。
        </p>
        <p>
          它由<Term>一个人</Term>运营，{LEGAL.operatorRoleZh}，不是一家公司。
          客服也由这个人回复 —— 也就是说回复有多快就是多快，具体承诺见
          <a
            href="/zh/refund"
            className="underline underline-offset-4 hover:text-foreground"
          >
            退款政策
          </a>
          里写明的响应时限。
        </p>
        <p>
          我们可能新增、修改或下线功能。如果我们下线了一项你正在付费使用的功能，
          我们会退还未使用的部分。
        </p>
      </Section>

      <Section heading="2. 你的账号">
        <p>
          使用 {SITE.name} 需要账号。你应妥善保管账号访问权限，
          并对该账号下发生的行为负责。若你认为他人取得了访问权限，
          请立即联系 {LEGAL.contactEmail}。
        </p>
        <p>一个账号供一个人使用。不得共享凭据，也不得用一个账号为多人提供服务。</p>
      </Section>

      <Section heading="3. 可接受的使用">
        <p>你同意不做以下事情：</p>
        <List
          items={[
            '利用本服务从事违法行为，或侵犯他人权利',
            '将释义、译文或其他输出转售、再分发，或包装成你自己的服务',
            '以超出正常阅读的方式自动化访问 —— 脚本化批量翻译、抓取我们的 API，或以程序方式对内容运行本扩展',
            '试图绕过使用限制、配额或计费',
            '干扰服务运行，或试图访问其他用户的数据',
          ]}
        />
        <p>
          违反上述任一项，我们可能暂停或关闭账号。若违反并非故意，
          我们会先告知你，并给你停止的机会。
        </p>
      </Section>

      <Section heading="4. 订阅">
        <p>
          付费套餐按周期预先收费，并在每个周期结束时<Term>自动续订</Term>，
          直到你取消。你可以随时在账单页取消；取消会停止下一次续订，
          而你已付费的当前周期仍可使用到期满。
        </p>
        <p>
          价格在结账时展示。如果我们调价，调整从你的下一次续订开始生效，
          并会提前通知你。
        </p>
      </Section>

      <Section heading="5. 积分">
        <p>
          AI 功能 —— 整句翻译、语境内释义和改写 —— 会消耗<Term>积分</Term>。
          积分随订阅发放，也可以单独购买，按应用内显示的费率消耗。
        </p>
        <p>
          积分在服务之外没有现金价值，也不能在账号之间转让。
          未消费的积分可按
          <a
            href="/zh/refund"
            className="underline underline-offset-4 hover:text-foreground"
          >
            退款政策
          </a>
          退款；已消费的不退，因为对应的成本已经实际发生。
        </p>
      </Section>

      <Section heading="6. 退款">
        <p>
          详见
          <a
            href="/zh/refund"
            className="underline underline-offset-4 hover:text-foreground"
          >
            退款政策
          </a>
          ，它是本协议的组成部分。简而言之：首次订阅扣费可在{' '}
          {LEGAL.subscriptionRefundDays} 天内全额退款，未消费的积分可随时退款。
        </p>
      </Section>

      <Section heading="7. 关于准确性 —— 请务必读这一条">
        <p>
          释义、译文和解释由词典和 AI 语言模型产生。它们
          <Term>经常有用，也时而出错</Term>。
          一段 AI 译文可以读起来流畅、笃定，同时仍然曲解了原文。
        </p>
        <p>
          {SITE.name} 是一个学习辅助工具。
          <Term>请不要在出错会造成后果的场合依赖它的输出</Term> ——
          法律文书、医疗信息、合同、安全须知，或任何专业或官方翻译。
          那些场合请找有资质的人工译者。
        </p>
      </Section>

      <Section heading="8. 你阅读的内容">
        <p>
          {SITE.name} 工作在他人发布的网页上。我们不拥有、不控制、不背书、
          也不对那些内容负责。你对这些内容的使用，仍受发布该内容的网站自身条款约束。
        </p>
        <p>
          你粘贴进阅读器的文本仍然属于你。你只授权我们存储它、向你展示它，
          以及为提供你使用的功能而处理它。7 天后我们会自动删除。
        </p>
      </Section>

      <Section heading="9. 我们的知识产权">
        <p>
          软件、网站、{SITE.name} 这个名称及其品牌标识归 {LEGAL.operatorName} 所有。
          本协议不向你转让其中任何一项。在你的账号状态正常期间，
          你获得的是一项个人的、非排他的、不可转让的使用权。
        </p>
      </Section>

      <Section heading="10. 可用性">
        <p>
          我们会尽力保持 {SITE.name} 正常运行，但不承诺它不中断或无差错。
          我们可能因维护而暂停服务，也依赖可能自身发生故障的第三方服务商。
          付费期间的长时间停机按退款政策处理。
        </p>
      </Section>

      <Section heading="11. 责任限制 —— 请务必读这一条">
        <p>
          <Term>
            在法律允许的范围内，{LEGAL.operatorName} 不对间接损失或后果性损失、
            利润损失、数据丢失，或因你依赖某条释义或译文而产生的损失承担责任。
          </Term>{' '}
          就任何一项主张，我们对你的赔偿责任总额，以该主张发生前十二个月内
          你实际向我们支付的金额为限。
        </p>
        <p>
          本条不限制依法不得限制的责任 —— 包括因故意或重大过失造成的责任、
          造成人身损害的责任，以及你作为消费者依法享有的权利。
        </p>
      </Section>

      <Section heading="12. 协议的终止">
        <p>
          你可以随时写信到 {LEGAL.contactEmail} 注销账号。
          若账号违反本协议，或我们停止运营本服务，我们可能关闭或暂停账号 ——
          属于后者时，我们会提前通知，并退还你已付费用中未使用的部分。
        </p>
      </Section>

      <Section heading="13. 适用法律">
        <p>本协议适用{LEGAL.jurisdictionZh}法律，运营者常居于此。</p>
        <p>
          如果你是消费者，本条不剥夺你依据自身常居地强制性规定所享有的保护，
          也不限制你向当地消费者保护机构投诉的权利。
        </p>
      </Section>

      <Section heading="14. 变更">
        <p>
          我们可能更新本协议。我们会更改顶部的日期；对你有实质影响的变更，
          会在生效前通过邮件通知你。此后继续使用 {SITE.name} 即表示你接受新条款；
          若你不接受，可以注销账号，我们会退还当前周期中未使用的部分。
        </p>
      </Section>

      <Section heading="15. 联系方式">
        <p>
          {SITE.name} 由 <Term>{LEGAL.operatorName}</Term> 运营，
          {LEGAL.operatorRoleZh}，常居{LEGAL.jurisdictionZh}。
        </p>
        <p>
          <Term>{LEGAL.contactEmail}</Term>
        </p>
      </Section>
    </LegalPage>
  )
}
