console.log("content js running")

// copy to content.js, any change sync with the clone
// TODO, try to merge two func int content.js, inject.js
// select multi-word
function popEnxDialogBox(mouseEvent, english) {
    console.log("pop enx dialog box, content js, english: ", english)
    if (english == "null" || english == "") {
        console.log("english is empty")
        return
    }
    console.log("on mouse click")
    console.log("mouse event: ", mouseEvent)
    let eventTarget = mouseEvent.target;
    let eventTargetRect = eventTarget.getBoundingClientRect();
    console.log("event target: ", eventTarget)
    console.log("event target rect: ", eventTargetRect)

    // Show the popup first to get its height
    let enxWindow = document.getElementById("enx-window");
    enxWindow.style.display = "block";
    let enxWindowRect = enxWindow.getBoundingClientRect();
    let enxHeight = enxWindowRect.height;
    let enxWidth = enxWindowRect.width;

    // Calculate position: popup bottom is above the word, with a margin
    let margin = 12; // px, distance between popup bottom and word top
    let newX = eventTargetRect.left + (eventTargetRect.width - enxWidth) / 2;
    let newY = eventTargetRect.top - enxHeight - margin;
    // Prevent popup from going off the top of the viewport
    if (newY < 0) newY = margin;
    // Prevent popup from going off the left/right
    if (newX < 0) newX = margin;
    if (newX + enxWidth > window.innerWidth) newX = window.innerWidth - enxWidth - margin;

    enxWindow.style.left = newX + "px";
    enxWindow.style.top = newY + "px";
    console.log("popup new position:", newX, newY);
    let word = eventTarget.innerText;


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
    console.log("elements:", articleClassElement)
    if (articleClassElement.length > 0) {
        (async () => {
            for (element in articleClassElement) {
                console.log("mark element: ", element)
                const content_module_url = chrome.runtime.getURL("content_module.js");
                const contentModule = await import(content_module_url);
                // style="margin-left: 2px; margin-right: 2px; text-decoration: #FF9800 underline; text-decoration-thickness: 2px;"
                colorCode = contentModule.getColorCodeByCount(ecp)
                console.log("color code: ", colorCode)
                if (articleClassElement[element] === undefined || articleClassElement[element].style === undefined) {
                    continue
                }
                articleClassElement[element].style.textDecoration = colorCode + " underline"
                articleClassElement[element].style.textDecorationThickness = "2px"
            }
        })();
    }
}

function getArticleNode() {
    console.log('get article node start')
    // gofluent
    let articleClassElement = document.getElementsByClassName("Article")
    console.log('class: Article element: ', articleClassElement)

    if (articleClassElement.length === 0) {
        // infoq
        console.log("try to find infoq article node")
        articleClassElement = document.getElementsByClassName("article__data")
        console.log("infoq article node:", articleClassElement)
    }

    if (articleClassElement.length === 0) {
        // infoq
        console.log("try to find wiloon blog article node")
        articleClassElement = document.getElementsByClassName("post-content")
        console.log("blog article node:", articleClassElement)
    }

    if (articleClassElement.length === 0) {
        // nytimes
        console.log("try to find nytimes article node")
        articleClassElement = document.getElementById("EMAIL_CONTAINER")
        console.log("nytimes article node:", articleClassElement)
        if (articleClassElement !== null) {
            return articleClassElement
        }
    }
    if (articleClassElement == null || articleClassElement.length === 0) {
        // tingroom
        console.log("tingroom article node")
        articleClassElement = document.getElementsByClassName("text")

    }
    if (articleClassElement.length === 0) {
        // bbc
        console.log("bbc article node")
        articleClassElement = document.querySelector("article")
        return articleClassElement
    } else {
        return articleClassElement.item(0)
    }
}

// when chrome extension ENx clicked
function enxRun() {
    articleClassElement = getArticleNode();
    console.log("article node: ", articleClassElement)
    // console.log(articleClassElement)
    let articleNode = articleClassElement

    // for word group select
    console.log("define mouse up func")

    // 改变 t2 内容的函数
    function mouseupHandler(mouseEvent) {
        console.log("mouse up event: ", mouseEvent)
        let selectedText = document.getSelection().toString()
        console.log("mouse up selected text:", selectedText)
        popEnxDialogBox(mouseEvent, selectedText)
    }

    console.log("adding mouse up event")
    // 为 table 添加事件监听器
    articleNode.addEventListener("mouseup", mouseupHandler, false);

    (async () => {
        try {
            console.log("get content module js url")
            const content_module_url = chrome.runtime.getURL("content_module.js");
            const contentModule = await import(content_module_url);
            let nodeList = contentModule.findChildNodes(articleNode);
            console.log("node list size: ", nodeList.length)

            for (let tmpNode of nodeList) {
                let tmpInnerHtml = tmpNode.node.innerHTML
                if (tmpInnerHtml === undefined) {
                    return
                }

                (async () => {
                    let oneParagraph = tmpNode.paragraph
                    let tmpArray = oneParagraph.split(' ');
                    console.log("tmp array length:", tmpArray.length)

                    let tmpParagraph = ""
                    let wordDict = {}
                    for (let tmpWord of tmpArray) {
                        tmpParagraph += tmpWord + ' '
                        if (tmpParagraph.length > 5000) {
                            console.log("sending msg from content script to backend, paragraph length, length>5000:", tmpParagraph.length, "paragraph:", tmpParagraph)
                            let response = await chrome.runtime.sendMessage({ msgType: "getWords", words: tmpParagraph });
                            console.log("response from backend: ", response)
                            console.log(response.wordProperties)
                            wordDict = Object.assign({}, wordDict, response.wordProperties);
                            console.log("word dict size:", Object.keys(wordDict).length)
                            tmpParagraph = ""
                        }
                    }

                    if (tmpParagraph.length > 0) {
                        // call enx api
                        console.log("sending msg from content script to backend, node id:", tmpNode.id, "paragraph length<=5000:", tmpParagraph.length, "paragraph:", tmpParagraph)
                        let response = await chrome.runtime.sendMessage({ msgType: "getWords", words: tmpParagraph });
                        wordDict = Object.assign({}, wordDict, response.wordProperties);
                        console.log("paragraph init response, node id:", tmpNode.id, " size:", Object.keys(wordDict).length, "word dict", wordDict)
                    }

                    let newInnerHtml = contentModule.renderInnerHtml(tmpInnerHtml, wordDict)
                    tmpNode.node.innerHTML = newInnerHtml
                    console.log("original html: ", tmpInnerHtml)
                    console.log("new html: ", newInnerHtml)
                })();
            }
            // multiple content js test
        } catch (error) {
            console.error('import error 0: ', error);
        }
    })();
}

function injectScript(file_path, tag) {
    let node = document.getElementsByTagName(tag)[0];
    let script = document.createElement('script');
    script.setAttribute('type', 'text/javascript');
    script.setAttribute('src', file_path);
    node.appendChild(script);
}


async function injectEnxWindow() {
    console.log("inject enx window")

    let articleClassElement = document.getElementsByTagName("body");

    console.log("body list", articleClassElement)
    console.log("body list length", articleClassElement.length)
    let bodyNode = articleClassElement.item(0);
    console.log("body node: ", bodyNode)

    let enxWindow = `<div class='enx-window' id='enx-window' style='height: 260px; overflow-y: auto; width: 320px; overflow-x: hidden; position: absolute; background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.15); border-radius: 8px; z-index: 9999;'>
    <a id='enx-close' href='javascript:void(0);' class='enx-close' style='position: absolute; right: 8px; top: 8px;'>Close</a>
    <a id='youdao_link' href='https://www.youdao.com' target='_blank'>Youdao</a>
    <a id='enx-mark' class='enx-mark' href='javascript:void(0);'>MARK</a>
    <p id='enx-e' class='enx-ecp'></p>
    <p id='enx-p' class='enx-ecp'></p>
    <p id='enx-c' class='enx-ecp'></p>
    <p id='enx-query-count' class='enx-ecp' style='color: #666; font-size: 0.9em;'></p>
    <p id='enx-search-key' class='enx-search-key' style='display: none'></p>
    </div>
    `

    bodyNode.insertAdjacentHTML("afterbegin", enxWindow)
    console.log("enx window inserted")

    document.getElementById("enx-close").onclick = function () {
        document.getElementById("enx-window").style.display = "none";
    };

    document.getElementById("enx-mark").onclick = function () {
        console.log("enx mark")
        let key = document.getElementById("enx-e").innerText
        console.log("mark: ", key)

        // 获取用户 ID
        chrome.storage.local.get(['userId'], function(result) {
            const userId = result.userId || 1;

            // mark word as acquainted
            chrome.runtime.sendMessage({
                msgType: "markAcquainted",
                word: key,
                userId: userId
            }).then((data) => {
                console.log("mark response: ", data)
                updateUnderLine(data.ecp)
            });
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
        console.log("sending msg from content script to backend, key: ", key)
        document.getElementById("enx-e").innerText = key
        document.getElementById("enx-p").innerText = "Loading..."
        document.getElementById("enx-c").innerText = ""
        document.getElementById("enx-query-count").innerText = ""
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
        document.getElementById("enx-query-count").innerText = `Query Count: ${ecp.LoadCount || 0}`
        document.getElementById("enx-search-key").innerText = ecp.English

        // set youdao link
        document.getElementById("youdao_link").href = "https://www.youdao.com/result?word=" + ecp.English + "&lang=en"

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

// extension icon click event listener
// noinspection JSUnresolvedReference
chrome.runtime.onMessage.addListener(
    function (request, sender, sendResponse) {
        console.log("extension click listener, on message, request: ", request, "sender: ", sender)
        // console.log("sender tab url: ", sender.tab.url)
        if (request.greeting === "mark") {
            enxRun()
            sendResponse({ farewell: "ok" });
        }
    });

chrome.runtime.onMessage.addListener(
    function(request, sender, sendResponse) {
    console.log("content script received message:", request);
    if (request.action === "enxRun") {
        enxRun();
        sendResponse({success: true});
    }
    return true;
});

injectEnxWindow().then()
