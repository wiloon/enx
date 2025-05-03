let innerHtmlTest = `the &quot;<em>age of inference</em>,&quot; marking`

let wordDict = {
    "inference": {
        "Id": 1024,
        "Raw": "inference",
        "English": "inference",
        "Chinese": "",
        "Pronunciation": "",
        "Key": "inference",
        "AlreadyAcquainted": 1,
        "LoadCount": 1,
        "WordType": 0
    }
}

import {renderInnerHtml} from '../../content_module'

test('render test', () => {

  let renderedInnerHtml = renderInnerHtml(innerHtmlTest, wordDict)

  console.log("rendered inner html: ", renderedInnerHtml)
  expect(renderedInnerHtml).toBe(`he &quot;<em>age of <u alt="inference" onclick="popEnxDialogBox(event)" class="enx-inference" style="text-decoration: #FFFFFF underline; text-decoration-thickness: 2px;">inference</u></em>,&quot; marking`);
});
