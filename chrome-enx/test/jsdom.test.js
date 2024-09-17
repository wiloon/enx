import {JSDOM} from "jsdom"

test('jsdom test', () => {
const dom = new JSDOM(`
    <body>
        <div id="content">
            <div class="article__data">
                <p>In a recent <a href="https://www.uber.com/en-AU/blog/continuous-deployment/">post</a>, Uber shared how the development team manage the continuous deployment of the microservices, tackling challenges of working with large monorepos.</p>
            </div>
        </div>
        <script>document.getElementById("content").append(document.createElement("hr"));</script>
    </body>
    `, { runScripts: "outside-only" });

    // run a script outside of JSDOM:
    dom.window.eval('document.getElementById("content").append(document.createElement("p"));');

    console.log(dom.window.document.getElementById("content").children.length); // 1
    console.log(dom.window.document.getElementsByTagName("hr").length); // 0
    console.log(dom.window.document.getElementsByTagName("p").length); // 1
    console.log(dom.window.document.getElementsByClassName("article__data").length);
    console.log(dom.window.document.getElementsByClassName("article__data"));
    let parentNode = dom.window.document.querySelector(".article__data")
    let spanContent = parentNode.innerHTML
    let oneParagraph = parentNode.textContent
    console.log(spanContent)
    console.log('text content: ',oneParagraph)
});
