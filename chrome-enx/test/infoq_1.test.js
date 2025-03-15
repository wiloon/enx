import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from "jsdom";
import { findChildNodes } from '../content_module';

// Resolve __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("current directory:", __dirname);

let pageSource = fs.readFileSync(path.resolve(__dirname, "./infoq.html"), "utf-8");


test('infoQ test', () => {
  const dom = new JSDOM(pageSource)
  let articleNode = dom.window.document.querySelector(".article__data")
  let nodeList = findChildNodes(articleNode)

  console.log("*** print paragraph list ***")
  for (let node of nodeList){
    console.log("paragraph: ", node.paragraph)
  }
  console.log(nodeList.length)
  expect(nodeList.length).toBe(17);
});
