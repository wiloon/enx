let innerHtmlTest = `Vector databases are critical for applications backed by GenAI to retrieve semantically relevant information to enrich the context of LLMs (RAG). Other use cases include semantic caching for chatbots, recommender systems, and face recognition. Mirko Ortensi, product manager at Redis, explains in a separate article how to <a href="https://medium.com/@mortensi/redis-vector-sets-for-face-recognition-4f0c17665f26">use Vector Sets for face recognition</a>. Ortensi writes:`

let wordDict = {
    "Vector": {
        "Id": 1024,
        "Raw": "Vector",
        "English": "Vector",
        "Chinese": "",
        "Pronunciation": "",
        "Key": "Vector",
        "AlreadyAcquainted": 1,
        "LoadCount": 1,
        "WordType": 0
    },
}

import {renderInnerHtml} from '../../content_module'

test('render test', () => {

  let renderedInnerHtml = renderInnerHtml(innerHtmlTest, wordDict)

  console.log("rendered inner html: ", renderedInnerHtml)
  expect(renderedInnerHtml).toBe(`<u alt=\"Vector\" onclick=\"popEnxDialogBox(event)\" class=\"enx-Vector\" style=\"text-decoration: #FFFFFF underline; text-decoration-thickness: 2px;\">Vector</u> databases are critical for applications backed by GenAI to retrieve semantically relevant information to enrich the context of LLMs (RAG). Other use cases include semantic caching for chatbots, recommender systems, and face recognition. Mirko Ortensi, product manager at Redis, explains in a separate article how to <a href=\"https://medium.com/@mortensi/redis-vector-sets-for-face-recognition-4f0c17665f26\">use Vector Sets for face recognition</a>. Ortensi writes:`);
});
