console.log("content js running")

function getColorCodeByCount(count) {
    if (count === 0) {
        return "#F44336"
    } else if (count > 0 && count <= 10) {
        return "#2196F3"
    } else if (count > 10) {
        return "#9C27B0"
    }
}

function findChildNodes(rootNode) {
    let childNodes = rootNode.childNodes
    if (childNodes.length === 0) {
        return
    }

    for (let node of childNodes) {
        let tagName = node.tagName
        if (tagName === 'SPAN') {
            let spanContent = node.innerHTML
            console.log('span inner html: ', spanContent)
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
            let startTag = '<u onmouseover="mouseover0(this)" class="class-foo" style="margin-left: 2px; margin-right: 2px; text-decoration: #000000 underline; text-decoration-thickness: 2px;">'

            let wordArray = [];
            let newSpanContent = ""
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
                console.log(wordArray)
                const response = await chrome.runtime.sendMessage({msgType: "getWords", words: wordArray});
                // do something with response here, not outside the function
                console.log("response from backend: ", Date.now())
                console.log(response);
                console.log(response.wordProperties);
                for (let word of words) {
                    let wordLowerCase = word.toLowerCase();
                    wordLowerCase = wordLowerCase.replace(",", "");
                    wordLowerCase = wordLowerCase.replace(".", "");
                    if (wordLowerCase in response.wordProperties) {
                        let loadCount = response.wordProperties[wordLowerCase]
                        console.log("word: ", wordLowerCase, " load count: ", loadCount)
                        let colorCode = getColorCodeByCount(loadCount)
                        startTag = startTag.replace("#000000", colorCode);
                        startTag = startTag.replace("class-foo", "enx-" + wordLowerCase);
                        newSpanContent = newSpanContent + startTag + word + '</u>'

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
    console.log("adding btn")

    let articleClassElement = document.getElementsByClassName("Article");
    while (articleClassElement.length === 0) {
        console.log("article tag not found, wait 1s...")
        await sleep(1000)
        articleClassElement = document.getElementsByClassName("Article");
    }
    console.log(articleClassElement)
    console.log(articleClassElement.length)
    let articleNode = articleClassElement.item(0);
    console.log(articleNode)

    articleNode = articleClassElement.item(0);
    console.log(articleNode)

    dragSvgUrl=chrome.runtime.getURL('drag.svg')
    articleNode.insertAdjacentHTML("afterbegin", "<button id='enx-on' onclick='enxOn()'>ENX-ON</button><button id='enx-off' onclick='enxOff()'>ENX-OFF</button><div class='enx-window' id='enx-window'> <a id='enx-close' href='javascript:void(0);' class='enx-close'>关闭</a>   </div>")

    document.getElementById("enx-close").onclick = function () {
        document.getElementById("enx-window").style.display = "none";
    };
    // 按下鼠标，移动鼠标，移动登录框
    // document.getElementById("enx-title").onmousedown = function (e) {
    //     // 获取此时的可视区域的横坐标，此时登陆框距离左侧页面的横坐标
    //     var spaceX = e.clientX - document.getElementById("enx-window").offsetLeft;
    //     var spaceY = e.clientY - document.getElementById("enx-window").offsetTop;
    //     // 移动事件
    //     document.onmousemove = function (e) {
    //         // 新的可视区域的横坐标-spaceX=====新的值——》登录框的left属性
    //         var x = e.clientX - spaceX + 250;
    //         var y = e.clientY - spaceY - 140;
    //         document.getElementById("enx-window").style.left = x + "px";
    //         document.getElementById("enx-window").style.top = y + "px";
    //     };
    // };
    // document.onmouseup = function () {
    //     document.onmousemove = null;//当鼠标抬起的时候,把鼠标移动事件干掉
    // };

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

function getOneWord(word) {
    (async () => {
        console.log("sending msg from content script to backend, params: ", Date.now())
        word = word.replace(",", "");
        word = word.replace(".", "");
        console.log(word)
        const response = await chrome.runtime.sendMessage({msgType: "getOneWord", word: word});
        // do something with response here, not outside the function
        console.log("response from backend: ", Date.now())
        console.log(response);
        console.log(response.ecp);
        className = "enx-" + response.ecp.English
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
    if (event.data.type && (event.data.type === "getOneWord")) {
        let word = event.data.word
        console.log("content script, get one word: ", word)
        getOneWord(word)
    }
}, false);

addBtn()