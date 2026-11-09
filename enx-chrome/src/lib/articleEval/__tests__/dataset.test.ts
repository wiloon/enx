import { parseZyteLabels } from '../dataset'

test('maps labelled snapshot IDs to URLs and human article text', () => {
  expect(
    parseZyteLabels({
      'story-1': {
        url: 'https://example.com/news',
        articleBody: 'The labelled article.',
      },
      'story-2': {
        url: 'http://example.org/story',
        articleBody: 'Another article.',
      },
    })
  ).toEqual([
    {
      id: 'story-1',
      url: 'https://example.com/news',
      labelText: 'The labelled article.',
    },
    {
      id: 'story-2',
      url: 'http://example.org/story',
      labelText: 'Another article.',
    },
  ])
})
