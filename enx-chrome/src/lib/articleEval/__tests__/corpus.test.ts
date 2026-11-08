/**
 * @jest-environment node
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { corpusProblems } from '../corpus'

const page = (url: string, overrides: Record<string, unknown> = {}) => ({
  url,
  category: 'news',
  provenance: 'hand-picked',
  trancoRank: 202,
  ...overrides,
})

const site = (host: string, overrides: Record<string, unknown> = {}) => [
  page(`https://${host}/a`, overrides),
  page(`https://${host}/b`, overrides),
]

describe('corpusProblems', () => {
  it('accepts two distinct pages per site with provenance and rank', () => {
    expect(
      corpusProblems([
        ...site('www.news.example'),
        ...site('blog.example', {
          category: 'personal',
          provenance: 'recommended',
          trancoRank: null,
        }),
      ])
    ).toEqual([])
  })

  it('reports a site with one page or with more than two', () => {
    expect(
      corpusProblems([
        page('https://one.example/a'),
        ...site('three.example'),
        page('https://three.example/c'),
      ])
    ).toEqual([
      'one.example: 1 page, expected 2',
      'three.example: 3 pages, expected 2',
    ])
  })

  it('reports the same URL listed twice', () => {
    expect(
      corpusProblems([
        page('https://dup.example/a'),
        page('https://dup.example/a'),
      ])
    ).toEqual([
      'https://dup.example/a: listed twice',
      'dup.example: 1 page, expected 2',
    ])
  })

  it('reports a missing or unknown provenance', () => {
    expect(
      corpusProblems([
        ...site('a.example', { provenance: undefined }),
        ...site('b.example', { provenance: 'scraped' }),
      ])
    ).toEqual([
      'https://a.example/a: provenance must be hand-picked or recommended',
      'https://a.example/b: provenance must be hand-picked or recommended',
      'https://b.example/a: provenance must be hand-picked or recommended',
      'https://b.example/b: provenance must be hand-picked or recommended',
    ])
  })

  it('reports a rank that is neither a positive integer nor null', () => {
    expect(
      corpusProblems([
        ...site('a.example', { trancoRank: undefined }),
        ...site('b.example', { trancoRank: 0 }),
        ...site('c.example', { trancoRank: '12' }),
      ])
    ).toEqual([
      'https://a.example/a: trancoRank must be a positive integer or null',
      'https://a.example/b: trancoRank must be a positive integer or null',
      'https://b.example/a: trancoRank must be a positive integer or null',
      'https://b.example/b: trancoRank must be a positive integer or null',
      'https://c.example/a: trancoRank must be a positive integer or null',
      'https://c.example/b: trancoRank must be a positive integer or null',
    ])
  })

  it('reports an unknown category', () => {
    expect(corpusProblems(site('a.example', { category: 'forum' }))).toEqual([
      'https://a.example/a: unknown category forum',
      'https://a.example/b: unknown category forum',
    ])
  })

  it("reports a site whose pages disagree on the site's provenance or rank", () => {
    expect(
      corpusProblems([
        page('https://a.example/a'),
        page('https://a.example/b', {
          provenance: 'recommended',
          trancoRank: 9,
        }),
      ])
    ).toEqual(['a.example: pages disagree on provenance or trancoRank'])
  })
})

describe('the committed corpus', () => {
  it('has provenance, a rank and exactly two distinct pages per site', () => {
    const corpus = JSON.parse(
      readFileSync(
        join(__dirname, '../../../../article-eval/corpus.json'),
        'utf8'
      )
    ) as unknown[]
    expect(corpusProblems(corpus)).toEqual([])
  })
})
