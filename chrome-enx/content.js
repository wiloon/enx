console.log("content js running")

// copy to content.js, any change sync with the clone
// TODO, try to merge two func int content.js, inject.js
// which one is in use?
function popEnxDialogBox(mouseEvent, english) {
    console.log("pop enx dialog box, english: ", english)
    if (english == "null" || english == "") {
        console.log("english is empty")
        return
    }
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
    window.postMessage({type: "getOneWord", word: english});
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

function getArticleNode() {
    // gofluent
    let articleClassElement = document.getElementsByClassName("Article")
    if (articleClassElement.length === 0) {
        // infoq
        console.log("try to find infoq article node")
        articleClassElement = document.getElementsByClassName("article__data")
    }
    if (articleClassElement.length === 0) {
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
    console.log("article element length:", articleClassElement.length)
    return articleClassElement
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
            console.log("get content module js src")
            const src = chrome.runtime.getURL("content_module.js");
            console.log("content module js src: ", src);

            const contentMain = await import(src);
            console.log("content module main:", contentMain)

            let nodeList = contentMain.findChildNodes(articleNode);
            console.log("node list: ", nodeList)
            for (let tmpNode of nodeList) {
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
                            let response = await chrome.runtime.sendMessage({msgType: "getWords", words: tmpParagraph});
                            console.log("response from backend: ", response)
                            console.log(response.wordProperties)
                            wordDict = Object.assign({}, wordDict, response.wordProperties);
                            console.log("word dict size:", Object.keys(wordDict).length)
                            tmpParagraph = ""
                        }
                    }

                    if (tmpParagraph.length > 0) {
                        console.log("sending msg from content script to backend, node id:", tmpNode.id, "paragraph length<=5000:", tmpParagraph.length, "paragraph:", tmpParagraph)
                        let response = await chrome.runtime.sendMessage({msgType: "getWords", words: tmpParagraph});
                        wordDict = Object.assign({}, wordDict, response.wordProperties);
                        console.log("word dict, node id:",tmpNode.id," size:", Object.keys(wordDict).length)
                    }

                    let tmpInnerHtml = tmpNode.node.innerHTML
                    if (tmpInnerHtml === undefined) {
                        return
                    }
                    let newInnerHtml = ""
                    htmlTag = false
                    tagIndexStart = undefined
                    tagIndexStop = undefined
                    tagName = undefined

                    copyIndex = 0
                    wordIndexStart = undefined
                    wordIndexEnd = undefined
                    stringIndexStart = 0
                    stringIndexEnd = 1

                    index = 0
                    while (index < tmpInnerHtml.length) {
                        let oneCharacter = tmpInnerHtml.charAt(index)
                        console.log("index: ", index, "one character:", oneCharacter,", start: ", wordIndexStart, ", end: ", wordIndexEnd, "html tag:", htmlTag, "tag name:", tagName)

                        var oneCharacterCode = oneCharacter.charCodeAt();
                        if ((oneCharacterCode >= 65 && oneCharacterCode <= 90) || (oneCharacterCode >= 97 && oneCharacterCode <= 122)) {
                            // english character
                            if (htmlTag === false && wordIndexStart === undefined) {
                                wordIndexStart = index
                                console.log("word start index:", wordIndexStart)
                            }
                        } else if (oneCharacter === "-" || oneCharacter === "'") {
                            // do nothing
                        } else {
                            // none english character
                            if (htmlTag === false && wordIndexStart !== undefined && wordIndexEnd === undefined) {
                                wordIndexEnd = index
                                console.log("word end index:", wordIndexEnd)
                            }

                            if (tagName === undefined) {
                                if (oneCharacter === "<") {
                                    htmlTag = true
                                    tagIndexStart = index + 1
                                    console.log("html tag:", htmlTag)
                                }
                                if (htmlTag === true && (oneCharacter === " " || oneCharacter === ">")) {
                                    tagName = tmpInnerHtml.slice(tagIndexStart, index)

                                    // comment tag has special close rule
                                    if (tagName === "!--"){
                                        tagName = "--"
                                    }
                                    console.log("html tag name:", tagName)
                                }
                            } else {
                                console.log("check if html tag close:", tmpInnerHtml.slice(index - tagName.length, index + 1))
                                if (oneCharacter === ">" && tmpInnerHtml.slice(index - tagName.length, index + 1) === tagName + ">") {
                                    htmlTag = false
                                    tagName = undefined
                                }
                            }
                        }
                        index = index + 1

                        if (wordIndexStart === undefined || wordIndexEnd === undefined) {
                            continue
                        }

                        // found one word
                        let tmpWord = tmpInnerHtml.slice(wordIndexStart, wordIndexEnd)
                        if (tmpWord in wordDict) {
                            let ecp = wordDict[tmpWord]
                            console.log("word: ", tmpWord, "ecp: ", ecp)
                            let colorCode = getColorCodeByCount(ecp)
                            let startTag = '<u alt="alt-foo" onclick="popEnxDialogBox(event)" class="class-foo" style="text-decoration: #000000 underline; text-decoration-thickness: 2px;">'
                            startTag = startTag.replace("#000000", colorCode);
                            startTag = startTag.replace("class-foo", "enx-" + ecp.Key);
                            startTag = startTag.replace("alt-foo", ecp.English);
                            newInnerHtml = newInnerHtml + tmpInnerHtml.slice(copyIndex, wordIndexStart)
                            newInnerHtml = newInnerHtml + startTag + tmpWord + '</u> '
                            copyIndex = wordIndexEnd
                            wordIndexStart = undefined
                            wordIndexEnd = undefined
                        } else {
                            console.log("word not found: ", tmpWord)
                            newInnerHtml = newInnerHtml + tmpInnerHtml.slice(copyIndex, wordIndexStart)
                            newInnerHtml = newInnerHtml + ' ' + tmpWord + ' '
                            wordIndexStart = undefined
                            wordIndexEnd = undefined
                        }
                    }
                    newInnerHtml = newInnerHtml + tmpInnerHtml.slice(copyIndex)
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
            msgType: "markAcquainted", word: key
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
        console.log("sending msg from content script to backend, key: ", key)
        document.getElementById("enx-e").innerText = key
        document.getElementById("enx-p").innerText = "Loading..."
        document.getElementById("enx-c").innerText = ""
        document.getElementById("enx-search-key").innerText = ""

        console.log("send get one word from content js")
        const response = await chrome.runtime.sendMessage({msgType: "getOneWord", word: key});
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

// extension icon click event listener
// noinspection JSUnresolvedReference
chrome.runtime.onMessage.addListener(
    function (request, sender, sendResponse) {
        console.log("on message")
        console.log('sender tab: ', sender.tab)
        // console.log("sender tab url: ", sender.tab.url)
        console.log("request: ", request)
        if (request.greeting === "mark") {
            enxRun()
            sendResponse({farewell: "ok"});
        }
    });

injectEnxWindow().then()
