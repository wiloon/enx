import type { Metadata } from 'next'
import { LegalPage, List, Section, Term } from '@/components/site/LegalPage'
import { AI_PROVIDER, LEGAL, SUBPROCESSORS } from '@/lib/legal'
import { SITE } from '@/lib/site'

// 隐私政策（中文版）。LAUNCH-CHECKLIST §6.2b。
//
// ⚠️ 这是 /privacy 的翻译，两份必须逐节对应 —— app/__tests__/legal.test.tsx
// 里有一条测试比对两版的小节数量，改了一边没改另一边会红。
//
// ⚠️ 中文版声明「以中文版为准」（见 LegalPage 的 translationNote）。运营者常居
// 中国大陆、管辖写中国法、用户是中文用户，真出争议时法院看的就是用户实际读到
// 的那一版。所以这里的措辞不是「译得差不多就行」。
export const dynamic = 'force-static'

export const metadata: Metadata = {
  title: `隐私政策 — ${SITE.name}`,
  description: `${SITE.name} 如何处理你的数据：收集什么、刻意不收集什么、还有谁会拿到。`,
  alternates: { canonical: '/zh/privacy', languages: { en: '/privacy' } },
}

export default function PrivacyPolicyZhPage() {
  return (
    <LegalPage
      locale="zh"
      enHref="/privacy"
      title="隐私政策"
      intro={`${SITE.name} 是一个阅读工具，这意味着它会看到你在读什么。本页说清楚：这里面有多少被留下了，又有多少被刻意丢掉了。`}
    >
      <Section heading="我们是谁">
        <p>
          {SITE.name} 由 <Term>{LEGAL.operatorName}</Term> 一个人开发和运营，
          {LEGAL.operatorRoleZh}，常居{LEGAL.jurisdictionZh}。
          没有公司，也没有团队 —— 本页说「我们」的时候，指的是一个人。
        </p>
        <p>
          这一点有实际意义：你的数据只经过这一个人和下面列出的服务商之手，再没有别人。
          本政策相关的任何事情，包括要求删除你的数据，请写信到{' '}
          <Term>{LEGAL.privacyEmail}</Term>。
        </p>
      </Section>

      <Section heading="一句话版本">
        <List
          items={[
            <>
              我们保存<Term>你查过的词</Term>，因为那就是生词本 —— 它本身就是产品。
            </>,
            <>
              我们保存你读了多少的<Term>每日总量</Term>。我们不保存你是<Term>在哪个页面</Term>上读的。
            </>,
            <>
              当你要求翻译整句时，那句话会被发送到运行在 <Term>{AI_PROVIDER.name}</Term>{' '}
              上的 AI 模型，与我们其余基础设施位于同一区域。我们不留副本。
            </>,
            <>我们不出售你的数据，也不用它做广告。</>,
          ]}
        />
      </Section>

      <Section heading="扩展在你访问的网页上做了什么">
        <p>
          只有当<Term>你为某个页面主动开启</Term>（点工具栏按钮或右键菜单）时，
          扩展才会在该页面上工作。它不会在你打开的每个网站上后台运行。
        </p>
        <p>
          开启之后，它<Term>在你的浏览器里</Term>读取正文，找出页面上的英文单词，
          并给值得学的词加下划线。这段文本在本地处理。离开你浏览器的只有：
        </p>
        <List
          items={[
            <>
              页面上的<Term>单词列表</Term>，以便我们返回每个词的释义和你的复习状态；
            </>,
            <>
              你<Term>点击</Term>的词，用于查询；
            </>,
            <>
              你<Term>划选</Term>并要求翻译的句子或短语。
            </>,
          ]}
        />
        <p>
          扩展申请「所有网站」权限，是因为你可能在任何网站上读英文，它无法预知是哪些。
          这个权限并不等于我们从那些网站收集了什么。页面的网址、标题和全文
          <Term>从不发送到我们的服务器，也从不被保存</Term>。
        </p>
      </Section>

      <Section heading="我们保存什么">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-foreground">
              <tr className="border-b border-border">
                <th className="py-2 pr-4 font-medium">数据</th>
                <th className="py-2 pr-4 font-medium">为什么</th>
                <th className="py-2 font-medium">保存多久</th>
              </tr>
            </thead>
            <tbody>
              {[
                [
                  '邮箱地址与账号标识',
                  '用于登录，以及就账号事宜联系你',
                  '账号存续期间',
                ],
                [
                  '你查过的词、查询次数、以及你是否已标记为「认识」',
                  '这就是你的生词本和复习计划',
                  '账号存续期间',
                ],
                [
                  '你粘贴进阅读器的文本',
                  '方便你回头再读',
                  '7 天后自动删除（最多保留最近 50 篇）',
                ],
                [
                  '每日总量：阅读词数、文章数、查词次数',
                  '阅读统计页上的图表',
                  '账号存续期间',
                ],
                [
                  '订阅状态、积分余额，以及每次 AI 调用的记录（哪个功能、花了多少）',
                  '计费，以及让你看到积分花在了哪里',
                  '账号存续期间；税务与会计法规要求的期限另计',
                ],
                [
                  '崩溃报告与错误诊断信息',
                  '用于发现和修复缺陷',
                  '按 Sentry 的保留期',
                ],
              ].map(([data, why, kept]) => (
                <tr key={data} className="border-b border-border/60 align-top">
                  <td className="py-3 pr-4">{data}</td>
                  <td className="py-3 pr-4">{why}</td>
                  <td className="py-3">{kept}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section heading="我们刻意不保存什么">
        <p>
          阅读统计只由「天」级别的汇总数字构成。我们的数据库里<Term>没有任何一列</Term>
          存放下面这些东西，所以也就无从交出、无从泄露、无从被调取：
        </p>
        <List
          items={[
            '你读过的任何页面的网址（URL）',
            '你读过的任何页面的域名或标题',
            '你读过的任何页面的正文',
            '你在一天中什么时刻阅读 —— 只有按自然日的总数，没有更细的',
            '你的地理位置，或任何设备指纹',
          ]}
        />
        <p>
          你在读哪篇文章，是只有你自己的浏览器知道、而我们的服务器从不得知的事。
        </p>
      </Section>

      <Section heading="整句翻译与 AI">
        <p>
          当你划选一个句子或短语并要求翻译时，这段文本 —— 以及你点击的那个词（如果有）
          —— 会被发送到运行在 <Term>{AI_PROVIDER.name}</Term>（{AI_PROVIDER.entity}）
          上的 <Term>{AI_PROVIDER.model}</Term> 模型，位于{' '}
          <Term>{LEGAL.hostingRegion}</Term>，与我们其余基础设施同一区域。
          这只在你明确划选文本时发生，不会在你阅读过程中发生。
        </p>
        <p>
          我们不在服务器上保存这个句子或它的译文。我们保存的是一条计费记录：
          这次调用发生了、花了多少、在什么时候 —— 不包含内容。
          Amazon 对该文本的处理适用{' '}
          <a
            href={AI_PROVIDER.privacyUrl}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-4 hover:text-foreground"
          >
            其隐私政策
          </a>
          。如果你希望完全没有文本离开浏览器，就不要使用整句翻译功能 ——
          查词和高亮不涉及任何 AI 服务商。
        </p>
      </Section>

      <Section heading="还有谁会收到你的数据">
        <p>我们使用下列服务商。每一家只收到它完成本职工作所必需的内容。</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-foreground">
              <tr className="border-b border-border">
                <th className="py-2 pr-4 font-medium">服务商</th>
                <th className="py-2 pr-4 font-medium">收到什么</th>
                <th className="py-2 font-medium">位于</th>
              </tr>
            </thead>
            <tbody>
              {SUBPROCESSORS.map((p) => (
                <tr key={p.name} className="border-b border-border/60 align-top">
                  <td className="py-3 pr-4">
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-4 hover:text-foreground"
                    >
                      {p.name}
                    </a>
                    <div className="text-xs">{p.purposeZh}</div>
                  </td>
                  <td className="py-3 pr-4">{p.dataZh}</td>
                  <td className="py-3">{p.locationZh}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          这些服务商位于中国境外，因此使用 {SITE.name} 会涉及
          <Term>个人信息向境外提供</Term>。我们在此明确告知接收方、处理目的与数据类型；
          你注册使用即表示对此单独同意。我们不出售个人信息，也不与广告商或数据经纪商共享。
          仅在法律强制要求、或为防止服务被滥用时，我们才会披露数据。
        </p>
      </Section>

      <Section heading="支付">
        <p>
          支付由 <Term>Stripe</Term> 处理。你的卡号从不到达我们的服务器 ——
          Stripe 处理它，只回传给我们一个客户编号、你的订阅状态，以及用于显示的后四位。
          退款事宜见{' '}
          <a
            href="/zh/refund"
            className="underline underline-offset-4 hover:text-foreground"
          >
            退款政策
          </a>
          。
        </p>
      </Section>

      <Section heading="你的数据存放在哪里">
        <p>
          我们的服务器和数据库运行在 {LEGAL.hostingProvider} 的{' '}
          <Term>{LEGAL.hostingRegion}</Term>。上面列出的服务商各自运行在它们自己的区域，
          因此使用 {SITE.name} 会涉及你的数据在不止一个国家或地区被处理。
        </p>
      </Section>

      <Section heading="你的选择和你的权利">
        <List
          items={[
            <>
              <Term>查看你的数据。</Term>
              生词本、统计和账单记录都能在应用里直接看到。
            </>,
            <>
              <Term>删除你的数据。</Term>写信到 {LEGAL.privacyEmail}，
              我们会删除你的账号及其全部关联数据。税法要求留存的账单记录可能保留。
            </>,
            <>
              <Term>导出你的数据。</Term>写信到 {LEGAL.privacyEmail}，
              我们会给你一份机器可读的副本。
            </>,
            <>
              <Term>停止扩展。</Term>它只在你主动开启的页面上工作。
              从浏览器移除它，本地处理立即全部停止。
            </>,
          ]}
        />
        <p>
          你还享有查阅、复制、更正、补充、限制或拒绝处理，以及撤回同意的权利；
          撤回同意不影响此前基于同意已进行的处理。写信到 {LEGAL.privacyEmail}，
          无论你身在何处，我们都会响应这些请求。
        </p>
      </Section>

      <Section heading="未成年人">
        <p>
          {SITE.name} 并非面向 14 岁以下儿童，我们也不会有意收集他们的数据。
          若你认为有儿童注册了账号，请联系 {LEGAL.privacyEmail}，我们会予以删除。
        </p>
      </Section>

      <Section heading="本政策的变更">
        <p>
          如果我们改变了收集的内容或接收方，我们会更新本页及顶部的日期；
          对你有实质影响的变更，会在生效前通过邮件通知你。
        </p>
      </Section>

      <Section heading="联系方式">
        <p>
          隐私问题与数据请求：<Term>{LEGAL.privacyEmail}</Term>。
          其他事宜：<Term>{LEGAL.contactEmail}</Term>。
        </p>
      </Section>
    </LegalPage>
  )
}
