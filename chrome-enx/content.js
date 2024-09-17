console.log("content js running")

// copy to content.js, any change sync with the clone
// todo, try to merge two func int content.js, inject.js
// which one is in use?
function popEnxDialogBox(mouseEvent, english) {
    console.log("on mouse click")
    console.log("mouse event: ", mouseEvent)
    let mouseEventX = mouseEvent.clientX;
    let mouseEventY = mouseEvent.clientY;
    console.log("mouse event client x: ", mouseEventX)
    console.log("mouse event client y: ", mouseEventY)

    let eventTarget = mouseEvent.target;
    console.log("event target: ", eventTarget)

    let eventTargetRect = eventTarget.getBoundingClientRect();
    console.log("event target rect: ", eventTargetRect)
    document.getElementById("enx-window").style.display = "block";

    let enxWindowRect = document.getElementById("enx-window").getBoundingClientRect()
    console.log("enx rect: ", enxWindowRect)
    console.log("enx window left: ", enxWindowRect.left);
    console.log("enx window top: ", enxWindowRect.top);
    console.log("enx window height: ", enxWindowRect.height);
    let enxHeight = enxWindowRect.height

    let articleElement = document.getElementsByTagName("body");
    let articleRect = articleElement[0].getBoundingClientRect();
    baseX = articleRect.left
    baseY = articleRect.top
    console.log("base x: ", baseX)
    console.log("base y: ", baseY)

    let offsetX = 0;
    let offsetY = -50;
    let newX = mouseEventX - baseX - offsetX;
    let newY = mouseEventY - baseY + offsetY + (-1 * enxHeight);

    console.log("new x: ", newX);
    console.log("mouse event y:", mouseEventY, "base y:", baseY, "offset y:", offsetY, "enx height:", enxHeight, "new y: ", newY);

    document.getElementById("enx-window").style.left = newX + "px";
    document.getElementById("enx-window").style.top = newY + "px";
    console.log(document.getElementById("enx-window").getBoundingClientRect());
    let word = mouseEvent.target.innerText;


    if (english == undefined || english == "") {
        // get attribute value from event
        english = eventTarget.getAttribute("alt");
    }

    // send word to enx server and get chinese
    console.log("send window msg 'getOneWord' from content.js to background.js, english: ", english)
    window.postMessage({ type: "getOneWord", word: english });
}

// update underline color
function updateUnderLine(ecp) {
    console.log("update underline color, key: ", ecp.Key, "load count: ", ecp.LoadCount, "acquainted: ", ecp.AlreadyAcquainted)
    className = "enx-" + ecp.Key
    articleClassElement = document.getElementsByClassName(className);
    console.log("get element by class name: ", className)
    console.log(articleClassElement)
    if (articleClassElement.length > 0) {
        for (element in articleClassElement) {
            // style="margin-left: 2px; margin-right: 2px; text-decoration: #FF9800 underline; text-decoration-thickness: 2px;"
            colorCode = getColorCodeByCount(ecp)
            console.log("color code: ", colorCode)
            if (articleClassElement[element] === undefined || articleClassElement[element].style === undefined) {
                continue
            }
            articleClassElement[element].style.textDecoration = colorCode + " underline"
            articleClassElement[element].style.textDecorationThickness = "2px"
        }
    }
}

function getColorCodeByCount(ecp) {
    let loadCount = ecp.LoadCount
    let isAcquainted = ecp.AlreadyAcquainted

    if (isAcquainted === 1) {
        return "#FFFFFF"
    }
    if (loadCount === 0) {
        return "#F44336"
    } else if (loadCount > 0 && loadCount <= 10) {
        return "#2196F3"
    } else if (loadCount > 10) {
        return "#9C27B0"
    }
}

let spanWidth = 0;

function findChildNodes(parentNode){
    let nodeList = []

    console.log("find child node 0, parent node: ", parentNode)
    let childNodes = parentNode.childNodes

    console.log("child node count: ", childNodes.length)
    if (childNodes.length === 0) {
        return
    }
    // check if article context
    let articleContent = true
    for (let node of childNodes) {
        let tagName = node.tagName
        console.log("child node: ", node, ", tag name: ", tagName)

        // if child node only contains A, CODE ..., this node is article content node
        if (tagName !== "A" && tagName !== undefined && tagName !== "EM" && tagName !== "CODE") {
            // has sub article node
            articleContent = false
            break
        }
    }

    if (articleContent === false) {
        console.log("article node ==false, check sub node")
        for (let node of childNodes) {
            let tmp_list = findChildNodes(node)
            nodeList = nodeList.concat(tmp_list)
        }
        return;
    }


    let tagName = parentNode.tagName
    console.log("tag: ", tagName, "node: ", parentNode)

    console.log("span width: ", parentNode.getBoundingClientRect().width)
    if (parentNode.getBoundingClientRect().width > spanWidth) {
        spanWidth = parentNode.getBoundingClientRect().width
    }

    let spanContent = parentNode.innerHTML
    let oneParagraph = parentNode.textContent

    // remove duplicate whitespace
    oneParagraph = oneParagraph.replace(/\s+/g, ' ')
    console.log('inner text: ', oneParagraph)
    console.log('span inner html: ', spanContent)
    console.log("span width: ", spanWidth)
    // remove <a> tag
    let filteredContent = ""
    let tagAppeared = false
    let collectWord = true
    for (i = 0; i < spanContent.length; i++) {
        if (!tagAppeared) {
            collectWord = true
        }
        c = spanContent.charAt(i)
        if (c === "<") {
            // tag start
            tagAppeared = true
        } else if (c === ">") {
            tagAppeared = false
        }
        if (tagAppeared) {
            collectWord = false
        }
        if (collectWord) {
            filteredContent += c
        }
    }
    console.log("span inner html remove tag: ", filteredContent)
    let words = filteredContent.split(' ')


    let re = /^[0-9a-zA-Z-,.']+$/;

    let rawParagraphWordArray = [];

    for (let word of words) {
        word = word.replace(",", "");
        word = word.replace(".", "");
        if (re.test(word)) {
            rawParagraphWordArray.push(word)
        }
    }
    // send word array to backend
    // get word properties from backend
    (async () => {
        console.log("sending msg from content script to backend")
        const response = await chrome.runtime.sendMessage({ msgType: "getWords", words: oneParagraph });
        // do something with response here, not outside the function
        console.log("response from backend: ", response)
        console.log(response.wordProperties);

        let newSpanContent = ""
        let spanContentLength = 0
        let wordMargin = 4;

        wordsInParagraph = oneParagraph.split(' ')
        for (let wordInRawParagraph of wordsInParagraph) {
            if (spanContentLength > 0 && spanWidth > 50 && spanContentLength > (spanWidth - 50)) {
                // newSpanContent = newSpanContent + "<br>"
                spanContentLength = 0
                console.log("insert br, span width: ", spanWidth, ", span content width: ", spanContentLength)
            }

            // get index of ',' for wordRaw
            let commaIndex = wordInRawParagraph.indexOf(',')
            // if comma exists and comma is not the first or the last char
            if (commaIndex > 0 && commaIndex < wordInRawParagraph.length - 1) {
                // append space for comma
                wordInRawParagraph = wordInRawParagraph.replace(",", ", ")
            }
            wordInRawParagraph = wordInRawParagraph.trim()
            rawParagraphWordArray = wordInRawParagraph.split(' ')
            console.log("raw words: ", rawParagraphWordArray)
            for (let wordTmp of rawParagraphWordArray) {
                let word = wordTmp.replace(/[^a-zA-Z\-]/g, '');
                if (word.length === 0) {
                    continue
                }
                if (word in response.wordProperties) {
                    let ecp = response.wordProperties[word]
                    console.log("word: ", word, "ecp: ", ecp)
                    let loadCount = ecp.LoadCount
                    console.log("word: ", word, " load count: ", loadCount)
                    let colorCode = getColorCodeByCount(ecp)
                    console.log("word: ", word, ", load count: ", loadCount, ", color code: ", colorCode)
                    let startTag = '<u alt="alt-foo" onclick="popEnxDialogBox(event)" class="class-foo" style="text-decoration: #000000 underline; text-decoration-thickness: 2px;">'
                    startTag = startTag.replace("#000000", colorCode);
                    startTag = startTag.replace("class-foo", "enx-" + ecp.Key);
                    startTag = startTag.replace("alt-foo", ecp.Key);
                    newSpanContent = newSpanContent + startTag + wordTmp + '</u> '
                } else {
                    newSpanContent = newSpanContent + ' ' + wordTmp + ' '
                }
                spanContentLength = spanContentLength + word.length * 8 + wordMargin
                console.log("span content width: ", spanContentLength)
            }
        }
        parentNode.innerHTML = newSpanContent
    })();
}

function getArticleNode() {
    // gofluent
    let articleClassElement = document.getElementsByClassName("Article")
    if (articleClassElement.length === 0) {
        // infoq
        articleClassElement = document.getElementsByClassName("article__data")
    }
    if (articleClassElement.length === 0) {
        // tingroom
        articleClassElement = document.getElementsByClassName("text")
    }
    return articleClassElement
}

// when chrome extension ENx clicked
function enxRun() {
    articleClassElement = getArticleNode();
    console.log("article node: ", articleClassElement)
    // console.log(articleClassElement)
    let articleNode = articleClassElement.item(0)

    // for word group select
    console.log("adding mouse up")
    // 改变 t2 内容的函数
    function mouseupHandler(mouseEvent) {
        console.log("mouse up")
        console.log("mouse event: ", mouseEvent)
        selectedText = document.getSelection().toString()
        console.log("mouse up", selectedText)
        popEnxDialogBox(mouseEvent, selectedText)
    }

    // 为 table 添加事件监听器
    articleNode.addEventListener("mouseup", mouseupHandler, false);

    (async () => {
        try {
            const src = chrome.runtime.getURL("content_module.js");
            const contentMain = await import(src);
            contentMain.createOneArticleNode();
            // multiple content js test
        } catch (error) {
            console.error('import error 0: ', error);
            // Expected output: ReferenceError: nonExistentFunction is not defined
            // (Note: the exact output may be browser-dependent)
        }
    })();

    // console.log(articleNode)
    findChildNodes(articleNode)
}

function injectScript(file_path, tag) {
    let node = document.getElementsByTagName(tag)[0];
    let script = document.createElement('script');
    script.setAttribute('type', 'text/javascript');
    script.setAttribute('src', file_path);
    node.appendChild(script);
}


async function injectEnxWindow() {
    console.log("adding btn")

    let articleClassElement = document.getElementsByTagName("body");

    console.log("article node", articleClassElement)
    console.log("article node length", articleClassElement.length)
    let articleNode = articleClassElement.item(0);
    console.log(articleNode)

    let enxWindow = `<div class='enx-window' id='enx-window'>
    <a id='enx-close' href='javascript:void(0);' class='enx-close'>关闭</a>
    <a id='youdao_link' href='https://www.youdao.com' target='_blank'>有道</a>
    <a id='enx-mark' class='enx-mark' href='javascript:void(0);'>MARK</a>
    <p id='enx-e' class='enx-ecp'></p>
    <p id='enx-p' class='enx-ecp'></p>
    <p id='enx-c' class='enx-ecp'></p>
    <p id='enx-search-key' class='enx-search-key' style='display: none'></p>
    </div>
    `

    articleNode.insertAdjacentHTML("afterbegin", enxWindow)

    document.getElementById("enx-close").onclick = function () {
        document.getElementById("enx-window").style.display = "none";
    };

    document.getElementById("enx-mark").onclick = function () {
        console.log("enx mark")
        let key = document.getElementById("enx-search-key").innerText
        console.log("mark: ", key)

        // mark word as acquainted
        chrome.runtime.sendMessage({
            msgType: "markAcquainted",
            word: key
        }).then((data) => {
            console.log("mark response: ", data)
            updateUnderLine(data.ecp)
        });
    };
    console.log("html added")
}


function findChildNodesAndUnmark(rootNode) {
    let childNodes = rootNode.childNodes
    if (childNodes.length === 0) {
        return
    }

    for (let node of childNodes) {
        let tagName = node.tagName
        if (tagName === 'U') {
            let spanContent = node.innerHTML
            node.replaceWith(spanContent + " ")

        } else {
            findChildNodesAndUnmark(node)
        }

    }
}

function enxUnMark() {
    articleClassElement = document.getElementsByClassName("Article");
    articleNode = articleClassElement.item(0)
    findChildNodesAndUnmark(articleNode)
}


injectScript(chrome.runtime.getURL('inject.js'), 'body');


function getOneWord(key) {
    (async () => {
        console.log("sending msg from content script to backend, params: ", key)
        document.getElementById("enx-e").innerText = key
        document.getElementById("enx-p").innerText = "Loading..."
        document.getElementById("enx-c").innerText = ""
        document.getElementById("enx-search-key").innerText = ""

        console.log("send get one word from content js")
        const response = await chrome.runtime.sendMessage({ msgType: "getOneWord", word: key });
        // do something with response here, not outside the function
        console.log("response from backend")
        console.log(response);
        console.log(response.ecp);
        let ecp = response.ecp
        // update enx window
        document.getElementById("enx-e").innerText = ecp.English
        document.getElementById("enx-p").innerText = ecp.Pronunciation
        document.getElementById("enx-c").innerText = ecp.Chinese
        document.getElementById("enx-search-key").innerText = ecp.Key

        // set youdao link
        document.getElementById("youdao_link").href = "https://www.youdao.com/result?word=" + ecp.Key + "&lang=en"

        // update underline color
        updateUnderLine(response.ecp)
    })();
}

window.addEventListener("message", function (event) {
    console.log("content script message event received")
    console.log(event.data)
    // only accept messages from the current tab
    if (event.source !== window) return;

    // user clicked extension icon, ENx enable
    if (event.data.type && (event.data.type === "mark")) {
        console.log("call enx mark")
        // msg from web page
        // collect words and send to backend
        enxRun()
    }

    // user clicked extension icon, ENx disable
    if (event.data.type && (event.data.type === "unMark")) {
        console.log("unmark event")
        enxUnMark()
    }
    // receive msg from inject js mouse click then invoke service
    if (event.data.type && (event.data.type === "getOneWord")) {
        let word = event.data.word
        console.log("content script, get one word: ", word)
        getOneWord(word)
    }
}, false);

chrome.runtime.onMessage.addListener(
    function (request, sender, sendResponse) {
        console.log("on message")
        console.log('sender tab: ', sender.tab)
        // console.log("sender tab url: ", sender.tab.url)
        console.log("request: ", request)
        if (request.greeting === "mark") {
            enxRun()
            sendResponse({ farewell: "ok" });
        }
    }
);

injectEnxWindow().then()
