import {JSDOM} from "jsdom"

test('infoQ test', () => {
    const dom = new JSDOM(`<!DOCTYPE html><article><p>Hello world</p></article>`);
    console.log("foo test:", dom.window.document.querySelector("p").textContent); // "Hello world"
    console.log("foo test:", dom.window.document.querySelector("article"));
    let nodeList = dom.window.document.querySelector("article").childNodes
    console.log("child node count: ", nodeList.length)
});
