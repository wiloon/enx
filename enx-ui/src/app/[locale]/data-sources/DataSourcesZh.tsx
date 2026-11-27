import type { Metadata } from 'next'
import { LegalPage, Section, Term } from '@/components/site/LegalPage'
import { SITE } from '@/lib/site'

export const metadata: Metadata = {
  title: `数据来源 — ${SITE.name}`,
  description: `${SITE.name} 词典释义的来源与许可。`,
}

export default function DataSourcesZhPage() {
  return (
    <LegalPage
      title="数据来源"
      intro={`${SITE.name} 的单词释义来自第三方词典。本页说明这些来源及其许可，方便你了解一条释义从哪里来。`}
      locale="zh"
      enHref="/data-sources"
    >
      <Section heading="English Wiktionary">
        <p>
          当你把释义语言设为英语时，释义来自 <Term>English Wiktionary</Term>
          ，依据{' '}
          <a
            href="https://creativecommons.org/licenses/by-sa/4.0/deed.zh"
            className="underline underline-offset-4 hover:text-foreground"
            target="_blank"
            rel="noreferrer"
          >
            知识共享署名-相同方式共享 4.0 国际许可协议
          </a>
          （CC BY-SA 4.0）发布。
        </p>
        <p>
          数据经过 <Term>修改</Term>
          ：为在 {SITE.name} 中查词做了过滤与重新格式化，并非 Wiktionary
          的原文拷贝。
        </p>
        <p>
          提取使用{' '}
          <a
            href="https://github.com/tatuylonen/wiktextract"
            className="underline underline-offset-4 hover:text-foreground"
            target="_blank"
            rel="noreferrer"
          >
            Wiktextract
          </a>
          ，并通过{' '}
          <a
            href="https://kaikki.org/"
            className="underline underline-offset-4 hover:text-foreground"
            target="_blank"
            rel="noreferrer"
          >
            kaikki.org
          </a>{' '}
          分发。
        </p>
      </Section>

      <Section heading="ECDICT">
        <p>
          当你把释义语言设为简体中文时，释义来自 <Term>ECDICT</Term>（
          {SITE.name} 使用的英汉词典）；词典没有该词时，可选用 AI 补全。
        </p>
      </Section>
    </LegalPage>
  )
}
