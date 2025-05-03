let innerHtmlTest = `its seventh-generation <a href="https://en.wikipedia.org/wiki/Tensor_Processing_Unit">Tensor Processing `

let wordDict = {}

import {renderInnerHtml} from '../../content_module'

test('render test', () => {
  let renderedInnerHtml = renderInnerHtml(innerHtmlTest, wordDict)
  console.log("rendered inner html: ", renderedInnerHtml)
  // 期望输出应该保持原始字符串不变，包括空格
  expect(renderedInnerHtml).toBe(innerHtmlTest);
});

// 添加更多测试用例
test('space before html tag test', () => {
  const testCases = [
    {
      input: 'hello <a>world</a>',
      expected: 'hello <a>world</a>'
    },
    {
      input: 'hello  <a>world</a>',
      expected: 'hello  <a>world</a>'
    },
    {
      input: 'hello\t<a>world</a>',
      expected: 'hello\t<a>world</a>'
    }
  ];

  testCases.forEach(({input, expected}) => {
    const result = renderInnerHtml(input, wordDict);
    expect(result).toBe(expected);
  });
});
