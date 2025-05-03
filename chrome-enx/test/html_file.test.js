import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from "jsdom";
import { findChildNodes } from '../content_module';

// Resolve __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("current directory:", __dirname);

let pageSource = fs.readFileSync(path.resolve(__dirname, "./test_0.html"), "utf-8");

test('paragraph test', () => {
    const tmp_dom = new JSDOM(pageSource);
    let articleNode = tmp_dom.window.document.querySelector("article");
    console.log("article node, tag:", articleNode.tagName, "id:", articleNode.id);
    let nodeList = findChildNodes(articleNode);

    console.log("*** print node list ***");
    for (let node of nodeList) {
        console.log("result node: ", node.paragraph);
    }
    console.log(nodeList.length);
    expect(nodeList.length).toBe(4);
});
