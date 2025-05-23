import { JSDOM } from "jsdom";
import { findChildNodes } from '../content_module';

let pageSource = `
<article id="article_0">
    <p id="em-test">Google emphasizes that Ironwood is designed to power what they call the &quot;<em>age of inference</em>,&quot; marking a shift from responsive AI models to proactive models that generate insights and interpretations. The company states that AI agents will use Ironwood to retrieve and generate data, delivering insights and answers.</p>
</article>
`
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
    expect(nodeList.length).toBe(1);
});
