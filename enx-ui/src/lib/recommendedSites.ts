// English sites the finished /welcome page suggests reading next (ADR-047
// Decision 3). Each must be free to read without signing in, have no
// paywall, use ordinary article markup, and work with learning mode in real
// Chrome. Sites change: drop any entry that stops meeting that bar.
export interface RecommendedSite {
  name: string
  url: string
  description: string
}

export const RECOMMENDED_SITES: RecommendedSite[] = [
  {
    name: 'InfoQ',
    url: 'https://www.infoq.com/',
    description: 'Software engineering articles',
  },
  {
    name: 'Anthropic News',
    url: 'https://www.anthropic.com/news',
    description: 'AI research and product news',
  },
  {
    name: 'BBC News',
    url: 'https://www.bbc.com/news',
    description: 'World news',
  },
  {
    name: 'The Guardian',
    url: 'https://www.theguardian.com/international',
    description: 'News and long reads',
  },
  {
    name: 'AP News',
    url: 'https://apnews.com/',
    description: 'Short, plain news reports',
  },
  {
    name: 'NPR',
    url: 'https://www.npr.org/',
    description: 'News and stories',
  },
  {
    name: 'Wikipedia',
    url: 'https://en.wikipedia.org/wiki/Special:Random',
    description: 'A random encyclopedia article',
  },
]
