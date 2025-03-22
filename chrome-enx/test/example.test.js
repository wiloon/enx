// https://www.infoq.com/news/2024/09/amazon-storage-browser-s3/
let pageSource = `
<past html source here>
`

import {JSDOM} from "jsdom"
import {findChildNodes} from '../content_module'

test('BBC test', () => {
  const tmp_dom = new JSDOM(pageSource)
  let articleNode = tmp_dom.window.document.querySelector("article");
  let nodeList = findChildNodes(articleNode)

  console.log("*** print node list ***")
  for (let node of nodeList){
    console.log("node: ", node)
  }
  console.log(nodeList.length)
  expect(nodeList.length).toBe(11);
});
