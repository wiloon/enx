let innerHtmlTest = `Good morning. Icebreakers are corny,`

let wordDict = {
    "morning": {
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
    "corny": {
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
  expect(renderedInnerHtml).toBe(`Good <u alt="their" onclick="popEnxDialogBox(event)" class="enx-their" style="text-decoration: #FFFFFF underline; text-decoration-thickness: 2px;">morning</u>. Icebreakers are <u alt="to" onclick="popEnxDialogBox(event)" class="enx-to" style="text-decoration: #FFFFFF underline; text-decoration-thickness: 2px;">corny</u>,`);
});
