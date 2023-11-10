console.log("content js running")

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

function findChildNodes(parentNode) {
    let childNodes = parentNode.childNodes
    if (childNodes.length === 0) {
        return
    }

    // check if article context
    let articleContent = true
    for (let node of childNodes) {
        let tagName = node.tagName
        if (tagName !== "A" && tagName !== undefined && tagName !== "EM" && tagName !== "CODE") {
            articleContent = false
            break
        }
    }

    if (articleContent === false) {
        for (let node of childNodes) {
            findChildNodes(node)
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
    let oneParagraph = parentNode.innerText
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

    let wordArray = [];

    for (let word of words) {
        word = word.replace(",", "");
        word = word.replace(".", "");
        if (re.test(word)) {
            wordArray.push(word)
        }
    }
    // send word array to backend
    // get word properties from backend
    (async () => {
        console.log("sending msg from content script to backend, params: ", Date.now())
        const response = await chrome.runtime.sendMessage({msgType: "getWords", words: oneParagraph});
        // do something with response here, not outside the function
        console.log("response from backend: ", response)
        console.log(response.wordProperties);

        let newSpanContent = ""
        let spanContentLength = 0
        let wordMargin = 4;

        wordsInParagraph = oneParagraph.split(' ')
        for (let wordRaw of wordsInParagraph) {
            if (spanContentLength > 0 && spanWidth > 50 && spanContentLength > (spanWidth - 50)) {
                newSpanContent = newSpanContent + "<br>"
                spanContentLength = 0
                console.log("insert br, span width: ", spanWidth, ", span content width: ", spanContentLength)
            }

            // get index of ',' for wordRaw
            let commaIndex = wordRaw.indexOf(',')
            // if comma exists and comma is not the first or the last char
            if (commaIndex > 0 && commaIndex < wordRaw.length - 1) {
                // replace comma with whitespace
                wordRaw = wordRaw.replace(",", ", ")
            }
            wordRaw = wordRaw.trim()
            wordArray = wordRaw.split(' ')
            console.log("word array: ", wordArray)
            for (let wordTmp of wordArray) {
                word = wordTmp.replace(/[^a-zA-Z\-]/g, '');
                if (word.length === 0) {
                    continue
                }
                if (word in response.wordProperties) {
                    let ecp = response.wordProperties[word]
                    let loadCount = ecp.LoadCount
                    console.log("word: ", word, " load count: ", loadCount)
                    let colorCode = getColorCodeByCount(ecp)
                    console.log("word: ", word, ", load count: ", loadCount, ", color code: ", colorCode)
                    let startTag = '<u alt="alt-foo" onclick="funcFoo(event)" class="class-foo" style="text-decoration: #000000 underline; text-decoration-thickness: 2px;">'
                    startTag = startTag.replace("#000000", colorCode);
                    startTag = startTag.replace("class-foo", "enx-" + ecp.SearchKey);
                    startTag = startTag.replace("alt-foo", ecp.SearchKey);
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
    let articleClassElement = document.getElementsByClassName("Article");
    if (articleClassElement.length === 0) {
        // infoq
        articleClassElement = document.getElementsByClassName("article__data");
    }
    return articleClassElement
}

function enxMark() {
    articleClassElement = getArticleNode();
    console.log(articleClassElement)
    articleNode = articleClassElement.item(0)
    console.log(articleNode)
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
        let word = document.getElementById("enx-search-key").innerText
        console.log("mark: ", word)
        chrome.runtime.sendMessage({msgType: "mark", word: word}).then((data) => console.log("mark response: ", data));
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

function getOneWord(SearchKey) {
    (async () => {
        console.log("sending msg from content script to backend, params: ", SearchKey)
        document.getElementById("enx-e").innerText = SearchKey
        document.getElementById("enx-p").innerText = "Loading..."
        document.getElementById("enx-c").innerText = ""
        document.getElementById("enx-search-key").innerText = ""

        const response = await chrome.runtime.sendMessage({msgType: "getOneWord", word: SearchKey});
        // do something with response here, not outside the function
        console.log("response from backend: ", Date.now())
        console.log(response);
        console.log(response.ecp);
        let ecp = response.ecp
        // update enx window
        document.getElementById("enx-e").innerText = ecp.English
        document.getElementById("enx-p").innerText = ecp.Pronunciation
        document.getElementById("enx-c").innerText = ecp.Chinese
        document.getElementById("enx-search-key").innerText = ecp.SearchKey

        // set youdao link
        document.getElementById("youdao_link").href = "https://www.youdao.com/result?word=" + ecp.SearchKey + "&lang=en"

        // update underline color
        className = "enx-" + response.ecp.SearchKey
        articleClassElement = document.getElementsByClassName(className);
        console.log("get element by class name: ", className)
        console.log(articleClassElement)
        if (articleClassElement.length > 0) {
            for (element in articleClassElement) {
                // style="margin-left: 2px; margin-right: 2px; text-decoration: #FF9800 underline; text-decoration-thickness: 2px;"
                colorCode = getColorCodeByCount(response.ecp.LoadCount)
                if (articleClassElement[element] === undefined || articleClassElement[element].style === undefined) {
                    continue
                }
                articleClassElement[element].style.textDecoration = colorCode + " underline"
                articleClassElement[element].style.textDecorationThickness = "2px"
            }
        }
    })();
}

window.addEventListener("message", function (event) {
    console.log("content script message event received")
    console.log(event.data)
    // only accept messages from the current tab
    if (event.source !== window) return;

    if (event.data.type && (event.data.type === "mark")) {
        console.log("call enx mark")
        // msg from web page
        // collect words and send to backend
        enxMark()
    }
    if (event.data.type && (event.data.type === "unMark")) {
        console.log("unmark event")
        enxUnMark()
    }
    if (event.data.type && (event.data.type === "getOneWord")) {
        let word = event.data.word
        console.log("content script, get one word: ", word)
        getOneWord(word)
    }
}, false);

chrome.runtime.onMessage.addListener(
    function (request, sender, sendResponse) {
        console.log("on message")
        // console.log('sender tab: ', sender.tab)
        // console.log("sender tab url: ", sender.tab.url)
        console.log("request: ", request)
        if (request.greeting === "mark") {
            enxMark()
            sendResponse({farewell: "ok"});
        }
    }
);

injectEnxWindow().then()
