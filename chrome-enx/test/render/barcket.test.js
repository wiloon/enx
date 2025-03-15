let innerHtmlTest = `scientists. (Assassins wove through traffic to attach “sticky bombs” to their car doors.) The`

let wordDict = {
    "Assassins": {
        "Id": 1024,
        "Raw": "their",
        "English": "their",
        "Chinese": "",
        "Pronunciation": "",
        "Key": "their",
        "AlreadyAcquainted": 1,
        "LoadCount": 1,
        "WordType": 0
    },
    "doors": {
        "Id": 298,
        "Raw": "to",
        "English": "to",
        "Chinese": "",
        "Pronunciation": "",
        "Key": "to",
        "AlreadyAcquainted": 1,
        "LoadCount": 0,
        "WordType": 0
    },
}

import {renderInnerHtml} from '../../content_module'

test('render test', () => {

  let renderedInnerHtml = renderInnerHtml(innerHtmlTest, wordDict)

  console.log("rendered inner html: ", renderedInnerHtml)
  expect(renderedInnerHtml).toBe(`scientists. (<u alt=\"their\" onclick=\"popEnxDialogBox(event)\" class=\"enx-their\" style=\"text-decoration: #FFFFFF underline; text-decoration-thickness: 2px;\">Assassins</u> wove through traffic to attach “sticky bombs” to their car <u alt=\"to\" onclick=\"popEnxDialogBox(event)\" class=\"enx-to\" style=\"text-decoration: #FFFFFF underline; text-decoration-thickness: 2px;\">doors</u>.) The`);
});
