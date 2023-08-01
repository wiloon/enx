console.log("content js running")

function findChildNodes(rootNode) {
    let childNodes = rootNode.childNodes
    if (childNodes.length === 0) {
        return
    }

    for (let node of childNodes) {
        let tagName = node.tagName
        if (tagName === 'SPAN') {
            let spanContent = node.innerHTML
            console.log('span content: ', spanContent)
            let words = spanContent.split(' ')

            let re = /^[0-9a-zA-Z-,.']+$/;
            let startTag = '<u style="margin-left: 2px; margin-right: 2px; text-decoration: underline; text-decoration-thickness: 2px;">'
            let startTagRed = '<u style="margin-left: 2px; margin-right: 2px; text-decoration: #F44336 underline; text-decoration-thickness: 2px;">'
            let startTagOrange = '<u style="margin-left: 2px; margin-right: 2px; text-decoration: #FF9800 underline; text-decoration-thickness: 2px;">'

            let wordArray = [];

            let newSpanContent = ""
            for (let word of words) {
                wordType = 0
                if (re.test(word)) {
                    wordArray.push(word)
                }
            }
            // send word array to backend
            // get word properties from backend
            (async () => {
                console.log("sending msg from content script to backend, params: ", Date.now())
                console.log(wordArray)
                const response = await chrome.runtime.sendMessage({words: wordArray});
                // do something with response here, not outside the function
                console.log("response from backend: ", Date.now())
                console.log(response);
                console.log(response.wordProperties);
                for (let word of words) {
                    if (word in response.wordProperties) {
                        loadCount = response.wordProperties[word]
                        if (loadCount === 0) {
                            newSpanContent = newSpanContent + startTagRed + word + '</u>'
                        } else if (loadCount > 10) {
                            newSpanContent = newSpanContent + startTagOrange + word + '</u>'
                        } else {
                            newSpanContent = newSpanContent + startTag + word + '</u>'
                        }
                    } else {
                        newSpanContent = newSpanContent + ' ' + word + ' '
                    }
                }
                node.innerHTML = newSpanContent
            })();

        } else {
            findChildNodes(node)
        }

    }
}

function enxMark() {
    articleClassElement = document.getElementsByClassName("Article");
    console.log(articleClassElement)
    articleNode = articleClassElement.item(0)
    console.log(articleNode)
    findChildNodes(articleNode)
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function injectScript(file_path, tag) {
    let node = document.getElementsByTagName(tag)[0];
    let script = document.createElement('script');
    script.setAttribute('type', 'text/javascript');
    script.setAttribute('src', file_path);
    node.appendChild(script);
}

async function addBtn() {

    console.log("sleep 5s and wait for article to load")
    await sleep(5000)

    articleClassElement = document.getElementsByClassName("Article");
    console.log(articleClassElement)
    console.log(articleClassElement.length)
    articleNode = articleClassElement.item(0);
    console.log(articleNode)


    articleNode = articleClassElement.item(0);
    console.log(articleNode)
    articleNode.insertAdjacentHTML("afterbegin", "<button id='enx-on' onclick='enxOn()'>ENX-ON</button><button id='enx-off' onclick='enxOff()'>ENX-OFF</button>")

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
            node.replaceWith(spanContent)

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

window.addEventListener("message", function (event) {
    console.log("content script message event received")
    console.log(event.data)
    // only accept messages from the current tab
    if (event.source !== window)
        return;

    if (event.data.type && (event.data.type === "FROM_PAGE")) {
        console.log("mark event: ", Date.now())
        // msg from web page
        // collect words and send to backend
        //enxMark()
        enxMark()
    }
    if (event.data.type && (event.data.type === "unMark")) {
        console.log("unmark event")
        enxUnMark()
    }
}, false);

addBtn()