console.log("content js running")

// copy to content.js, any change sync with the clone
// TODO, try to merge two func int content.js, inject.js
// select multi-word
// Get popup dimensions
function getPopupDimensions() {
    const enxWindow = document.getElementById("enx-window");
    if (!enxWindow) {
        console.log("Popup does not exist");
        return null;
    }

    const popupRect = enxWindow.getBoundingClientRect();
    const computedStyle = window.getComputedStyle(enxWindow);

    return {
        width: popupRect.width,
        height: popupRect.height,
        offsetHeight: enxWindow.offsetHeight,
        scrollHeight: enxWindow.scrollHeight,
        maxHeight: computedStyle.maxHeight,
        isVisible: enxWindow.style.display !== "none"
    };
}

// Improved popup positioning algorithm
function calculateOptimalPosition(eventTarget) {
    const margin = 12;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    // Default spacing - approximately two lines of text height
    const defaultSpacing = 48; // Approximately two lines of text height (24px * 2)

    // Get actual popup dimensions (if popup exists) or use default values
    let popupWidth = 320;
    let popupHeight = 300; // default max-height from CSS

    const enxWindow = document.getElementById("enx-window");
    if (enxWindow && enxWindow.style.display !== "none") {
        const dimensions = getPopupDimensions();
        if (dimensions) {
            popupWidth = dimensions.width;
            popupHeight = dimensions.height;
            console.log(`Using actual popup dimensions: ${popupWidth}x${popupHeight}`);
        }
    } else {
        console.log("Using default popup dimensions: 320x260");
    }

    // Get target element position
    const targetRect = eventTarget.getBoundingClientRect();

    // Calculate horizontal position (center aligned)
    let newX = targetRect.left + (targetRect.width - popupWidth) / 2 + scrollX;

        // Smart vertical positioning - prioritize above for better reading experience
    let newY;

    // Handle case where target is below current viewport (negative space above)
    let spaceAbove, spaceBelow;
    if (targetRect.top < scrollY) {
        // Target is below current viewport - calculate space relative to viewport
        spaceAbove = 0;
        spaceBelow = viewportHeight - (targetRect.bottom - scrollY);
        console.log("Target is below current viewport - adjusting calculations");
    } else {
        // Normal case - target is within or above current viewport
        spaceAbove = targetRect.top - scrollY;
        spaceBelow = viewportHeight - (targetRect.bottom - scrollY);
    }

    console.log(`Default spacing setting: ${defaultSpacing}px`);

    console.log("Positioning analysis:");
    console.log(`- Target rect: top=${targetRect.top}, bottom=${targetRect.bottom}, height=${targetRect.height}`);
    console.log(`- Viewport: height=${viewportHeight}, scrollY=${scrollY}`);
    console.log(`- Space above: ${spaceAbove}px`);
    console.log(`- Space below: ${spaceBelow}px`);
    console.log(`- Popup height needed: ${popupHeight + margin}px`);
    console.log(`- Required space above: ${popupHeight + margin}px`);
    console.log(`- Required space above (70%): ${popupHeight * 0.7 + margin}px`);

        // Prioritize showing above the word for better reading flow (top to bottom)
    console.log("Checking positioning conditions:");
    console.log(`- spaceAbove (${spaceAbove}) >= popupHeight + margin (${popupHeight + margin}): ${spaceAbove >= popupHeight + margin}`);
    console.log(`- spaceAbove (${spaceAbove}) >= popupHeight * 0.7 + margin (${popupHeight * 0.7 + margin}): ${spaceAbove >= popupHeight * 0.7 + margin}`);
    console.log(`- spaceBelow (${spaceBelow}) >= popupHeight + margin (${popupHeight + margin}): ${spaceBelow >= popupHeight + margin}`);

    // Calculate position using default spacing
    if (targetRect.top < scrollY) {
        // Target is below current viewport - show popup above the word with default spacing
        newY = targetRect.top - popupHeight - defaultSpacing + scrollY;
        console.log("Positioning: ABOVE the word (target below viewport, using default spacing)");
    } else if (spaceAbove >= popupHeight + defaultSpacing) {
        // Enough space above, show above the word with default spacing (preferred)
        newY = targetRect.top - popupHeight - defaultSpacing + scrollY;
        console.log("Positioning: ABOVE the word (preferred reading flow, default spacing)");
    } else if (spaceAbove >= popupHeight + margin) {
        // Reduced space above - use minimum margin
        newY = targetRect.top - popupHeight - margin + scrollY;
        console.log("Positioning: ABOVE the word (reduced spacing, minimum margin)");
    } else if (spaceBelow >= popupHeight + defaultSpacing) {
        // No space above, but enough space below with default spacing
        newY = targetRect.bottom + defaultSpacing + scrollY;
        console.log("Positioning: BELOW the word (default spacing)");
    } else if (spaceBelow >= popupHeight + margin) {
        // Reduced space below - use minimum margin
        newY = targetRect.bottom + margin + scrollY;
        console.log("Positioning: BELOW the word (reduced spacing, minimum margin)");
    } else {
        // Not enough space in either direction, choose the one with more space
        if (spaceAbove > spaceBelow) {
            newY = scrollY + margin;
            console.log("Positioning: TOP of viewport (insufficient space, above preferred)");
        } else {
            newY = scrollY + viewportHeight - popupHeight - margin;
            console.log("Positioning: BOTTOM of viewport (insufficient space, below preferred)");
        }
    }

    // Boundary adjustments
    if (newX < scrollX + margin) {
        newX = scrollX + margin;
        console.log("Adjusted: Left boundary");
    }
    if (newX + popupWidth > scrollX + viewportWidth) {
        newX = scrollX + viewportWidth - popupWidth - margin;
        console.log("Adjusted: Right boundary");
    }

    // Ensure popup is at least partially visible in viewport
    if (newY < scrollY) {
        newY = scrollY + margin;
        console.log("Adjusted: Popup was above viewport, moved to top of viewport");
    }

    return { x: newX, y: newY };
}

// Keep the original implementation for window.popEnxDialogBox to call
function popEnxDialogBoxImpl(mouseEvent, english) {
    if (english == null || english == "null" || english == "") {
        // Do not show popup or translate if english is null
        return;
    }
    console.log("pop enx dialog box, content js, english:", english)
    // mouse click on single word or selection
    console.log("on mouse click, event:", mouseEvent)
    let eventTarget = mouseEvent.target;
    let eventTargetRect = eventTarget.getBoundingClientRect();
    console.log("event target: ", eventTarget)
    console.log("event target rect: ", eventTargetRect)

    // Calculate optimal position before showing popup
    const position = calculateOptimalPosition(eventTarget);

    // Show the popup at the calculated position (no flickering)
    let enxWindow = document.getElementById("enx-window");
    enxWindow.style.left = position.x + "px";
    enxWindow.style.top = position.y + "px";
    enxWindow.style.display = "block";
    enxWindow.classList.add("visible");

    // Get popup dimensions after it's displayed and recalculate position if needed
    setTimeout(() => {
        const popupRect = enxWindow.getBoundingClientRect();
        const actualPopupHeight = popupRect.height;
        const actualPopupWidth = popupRect.width;
        const computedStyle = window.getComputedStyle(enxWindow);
        const maxHeight = computedStyle.maxHeight;
        const actualHeight = enxWindow.offsetHeight;
        const scrollHeight = enxWindow.scrollHeight;

                console.log("Popup dimension information:");
        console.log(`- getBoundingClientRect().height: ${actualPopupHeight}px`);
        console.log(`- offsetHeight: ${actualHeight}px`);
        console.log(`- scrollHeight: ${scrollHeight}px`);
        console.log(`- CSS max-height: ${maxHeight}`);
        console.log(`- Width: ${actualPopupWidth}px`);

        // Recalculate position if actual height differs significantly from estimated height
        const heightDifference = Math.abs(actualPopupHeight - 300); // 300 is our default estimate
        if (heightDifference > 20) { // If difference is more than 20px
            console.log(`Popup height difference is significant (${heightDifference}px), recalculating position`);
            const newPosition = calculateOptimalPosition(eventTarget);
            enxWindow.style.left = newPosition.x + "px";
            enxWindow.style.top = newPosition.y + "px";
            console.log("Position adjusted:", newPosition.x, newPosition.y);
        }
    }, 10);

    console.log("popup new position:", position.x, position.y);

    // Immediately display the clicked word in the popup
    if (english && english.trim() !== "") {
        // Ensure enxWindow is defined for skeleton/loading toggling
        let enxWindow = document.getElementById("enx-window");
        document.getElementById("enx-e").innerText = english;
        document.getElementById("enx-p").innerText = "";
        document.getElementById("enx-c").innerText = "";
        document.getElementById("enx-query-count").innerText = "";
        document.getElementById("enx-search-key").innerText = english;

        // Hide empty content areas during loading
        document.getElementById("enx-p").style.display = "none";
        document.getElementById("enx-c").style.display = "none";
        // Show skeletons
        document.getElementById("enx-skeleton").style.display = "block";
        document.getElementById("enx-skeleton2").style.display = "block";
        // Show loading indicator
        document.getElementById("enx-loading").style.display = "block";
        // Add loading class
        enxWindow.classList.add("loading");
        enxWindow.classList.remove("loaded");
        // Set youdao link immediately
        document.getElementById("youdao_link").href = "https://www.youdao.com/result?word=" + english + "&lang=en";
        console.log("Immediately displayed word in popup:", english);
    }

    // send word to enx server and get chinese
    console.log("send window msg 'getOneWord' from content.js to background.js, english: ", english)
    window.postMessage({ type: "getOneWord", word: english });
}

window.popEnxDialogBox = function(mouseEvent) {
    let english = undefined;
    if (mouseEvent && mouseEvent.target) {
        english = mouseEvent.target.getAttribute("alt");
    }
    console.log("window pop enx dialog box, english:", english)
    return popEnxDialogBoxImpl(mouseEvent, english);
};

// update underline color
function updateUnderLine(ecp) {
    console.log("update underline color, key: ", ecp.Key, "load count: ", ecp.LoadCount, "acquainted: ", ecp.AlreadyAcquainted)
    className = "enx-" + ecp.Key
    articleClassElement = document.getElementsByClassName(className);
    console.log("get element by class name: ", className)
    console.log("elements:", articleClassElement)
    if (articleClassElement.length > 0) {
        (async () => {
            const content_module_url = chrome.runtime.getURL("content_module.js");
            const contentModule = await import(content_module_url);
            colorCode = contentModule.getColorCodeByCount(ecp)
            console.log("color code: ", colorCode)
            
            for (let i = 0; i < articleClassElement.length; i++) {
                const element = articleClassElement[i];
                console.log("mark element: ", i, element)
                if (element === undefined || element.style === undefined) {
                    continue
                }
                element.style.textDecoration = colorCode + " underline"
                element.style.textDecorationThickness = "2px"
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
    let articleNode = articleClassElement

    function mouseupHandler(mouseEvent) {
        let selectedText = document.getSelection().toString();
        console.log("mouse up event:", mouseEvent, "selected text:", selectedText);
        popEnxDialogBoxImpl(mouseEvent, selectedText);
    }

    console.log("adding mouse up event")

    // add mouse up event listener to article node
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
                            console.log("enx run, response from backend: ", response)
                            
                            // Check for error response
                            if (response.error) {
                                console.log("Error received:", response.error);
                                if (response.error === "Session expired") {
                                    console.log("Session expired, stopping further requests");
                                    return; // Stop processing this paragraph
                                }
                                // For other errors, continue with empty wordDict
                                continue;
                            }
                            
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
                        
                        // Check for error response
                        if (response.error) {
                            console.log("Error received:", response.error);
                            if (response.error === "Session expired") {
                                console.log("Session expired, stopping further requests");
                                return; // Stop processing this paragraph
                            }
                            // For other errors, continue with empty wordDict
                        } else {
                            wordDict = Object.assign({}, wordDict, response.wordProperties);
                            console.log("paragraph init response, node id:", tmpNode.id, " size:", Object.keys(wordDict).length, "word dict", wordDict)
                        }
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

// Calculate popup content line count
function calculateContentLines() {
    const contentElement = document.querySelector('.enx-content');
    if (!contentElement) return 0;

    // Get computed styles
    const computedStyle = window.getComputedStyle(contentElement);
    const lineHeight = parseInt(computedStyle.lineHeight) || 20; // Default line height 20px
    const contentHeight = contentElement.scrollHeight;

    // Calculate line count
    const lineCount = Math.ceil(contentHeight / lineHeight);

    console.log(`Popup content statistics:`);
    console.log(`- Content height: ${contentHeight}px`);
    console.log(`- Line height: ${lineHeight}px`);
    console.log(`- Total lines: ${lineCount}`);

    // Calculate line count for each element separately
    const elements = contentElement.children;
    let totalLines = 0;
    for (let element of elements) {
        if (element.style.display !== 'none') {
            const elementHeight = element.scrollHeight;
            const elementLines = Math.ceil(elementHeight / lineHeight);
            totalLines += elementLines;
            console.log(`- ${element.tagName} (${element.id || element.className}): ${elementLines} lines`);
        }
    }

    return { totalLines: lineCount, elementLines: totalLines };
}


async function injectEnxWindow() {
    console.log("inject enx window")

    let articleClassElement = document.getElementsByTagName("body");

    console.log("body list", articleClassElement)
    console.log("body list length", articleClassElement.length)
    let bodyNode = articleClassElement.item(0);
    console.log("body node: ", bodyNode)

    let enxWindow = `
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.2/css/all.min.css">
    <style>
      .enx-close { color: #888 !important; position: static !important; }
      .enx-close:hover { color: #f44336 !important; }
      .enx-icon { color: #888 !important; font-size: 1.2em; }
      .enx-icon:hover { color: #1976d2 !important; }
      .enx-mark.enx-icon { color: #888 !important; }
      .enx-mark.enx-icon:hover { color: #43a047 !important; }
      .enx-toolbar {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: auto;
        margin-left: 0;
        margin-right: 0;
        margin-bottom: 0;
        padding: 8px 16px 8px 16px;
        justify-content: space-between;
        flex-shrink: 0;
        border-top: 1px solid #eee;
        background: #fafafa;
      }
      .enx-window {
        transition: top 0.2s, left 0.2s;
      }
      .enx-window.loading {
        opacity: 0.7;
        pointer-events: none;
      }
      .enx-window.loaded {
        opacity: 1;
        pointer-events: auto;
        transition: opacity 0.2s;
      }
      .enx-window.error {
        border: 1px solid #f44336;
      }
      .enx-window.error .enx-ecp {
        color: #f44336;
      }
      .enx-skeleton {
        background: linear-gradient(90deg, #eee 25%, #f5f5f5 50%, #eee 75%);
        background-size: 200% 100%;
        animation: enx-skeleton-loading 1.2s infinite linear;
        border-radius: 4px;
        min-height: 18px;
        margin: 4px 0;
      }
      @keyframes enx-skeleton-loading {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }
      .enx-word-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 8px;
      }
      .enx-word-row .enx-e {
        flex: 1;
        text-align: left;
        font-size: 1.2em;
        font-weight: bold;
      }
      .enx-word-row .enx-query-count {
        flex-shrink: 0;
        text-align: right;
        color: #666;
        font-size: 0.85em;
        min-width: 70px;
        margin-left: 8px;
        font-size: 12px;
      }
    </style>
    <div class='enx-window' id='enx-window' style='max-height: 300px; width: 320px; position: absolute; background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.15); border-radius: 8px; z-index: 9999; display: flex; flex-direction: column; display: none;'>
      <div class='enx-content' style='flex: 1; overflow-y: auto; padding: 8px 16px 0 0; display: flex; flex-direction: column; min-height: 0;'>
        <div class='enx-word-row'>
          <span id='enx-e' class='enx-e'></span>
          <span id='enx-query-count' class='enx-query-count'></span>
        </div>
        <div id='enx-loading' class='enx-loading' style='display: none; color: #666; font-style: italic; margin: 8px 0;'>
          <i class="fa-solid fa-spinner fa-spin"></i> Loading translation...
        </div>
        <div class='enx-content-fields' style='flex: 1; display: flex; flex-direction: column; min-height: 0;'>
          <div id='enx-skeleton' class='enx-skeleton' style='display: none; width: 80%; height: 18px;'></div>
          <div id='enx-skeleton2' class='enx-skeleton' style='display: none; width: 60%; height: 18px;'></div>
          <p id='enx-p' class='enx-ecp'></p>
          <p id='enx-c' class='enx-ecp'></p>
          <p id='enx-search-key' class='enx-search-key' style='display: none'></p>
        </div>
      </div>
      <div class='enx-toolbar' style='flex-shrink: 0; margin: 0;'>
        <div class='enx-toolbar-left'>
          <a id='youdao_link' href='https://www.youdao.com' target='_blank' class='enx-icon' title='Youdao'>
            <i class="fa-solid fa-language"></i>
          </a>
          <a id='enx-mark' class='enx-mark enx-icon' href='javascript:void(0);' title='Mark as Acquainted'>
            <i class="fa-solid fa-circle-check"></i>
          </a>
        </div>
        <a id='enx-close' href='javascript:void(0);' class='enx-close' title='Close'>
          <i class="fa-solid fa-xmark"></i>
        </a>
      </div>
    </div>
    `

    bodyNode.insertAdjacentHTML("afterbegin", enxWindow)
    console.log("enx window inserted")

    document.getElementById("enx-close").onclick = function () {
        let enxWindow = document.getElementById("enx-window");
        enxWindow.style.display = "none";
        enxWindow.classList.remove("visible");
    };

    document.getElementById("enx-mark").onclick = function () {
        console.log("enx mark")
        let key = document.getElementById("enx-e").innerText
        console.log("mark: ", key)

        // Get user ID
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
                
                // Close the popup after marking
                let enxWindow = document.getElementById("enx-window");
                enxWindow.style.display = "none";
                enxWindow.classList.remove("visible");
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
        document.getElementById("enx-p").innerText = ""
        document.getElementById("enx-c").innerText = ""
        document.getElementById("enx-query-count").innerText = ""
        document.getElementById("enx-search-key").innerText = ""

        // Hide empty content areas during loading
        document.getElementById("enx-p").style.display = "none";
        document.getElementById("enx-c").style.display = "none";
        // Show skeletons
        document.getElementById("enx-skeleton").style.display = "block";
        document.getElementById("enx-skeleton2").style.display = "block";
        // Show loading indicator
        document.getElementById("enx-loading").style.display = "block";
        // Add loading class
        let enxWindow = document.getElementById("enx-window");
        enxWindow.classList.add("loading");
        enxWindow.classList.remove("loaded");

        console.log("send get one word from content js")
        const response = await chrome.runtime.sendMessage({ msgType: "getOneWord", word: key });
        // do something with response here, not outside the function
        console.log("get one word, response from backend: ", response)
        
        // Hide loading indicator
        document.getElementById("enx-loading").style.display = "none";
        // Hide skeletons
        document.getElementById("enx-skeleton").style.display = "none";
        document.getElementById("enx-skeleton2").style.display = "none";
        
        // Check for error response
        if (response.error) {
            console.log("Error received:", response.error);
            // Show error message to user
            document.getElementById("enx-p").style.display = "block";
            document.getElementById("enx-c").style.display = "block";
            document.getElementById("enx-p").innerText = "Error";
            document.getElementById("enx-c").innerText = response.error === "Session expired" ? 
                "Session expired. Please log in again." : 
                "Failed to load translation. Please try again.";
            document.getElementById("enx-query-count").innerText = "";
            document.getElementById("enx-search-key").innerText = "";
            
            // Add error styling
            enxWindow.classList.remove("loading");
            enxWindow.classList.add("loaded", "error");
            return;
        }
        
        let ecp = response.ecp

        // Show content areas and update enx window
        document.getElementById("enx-p").style.display = "block";
        document.getElementById("enx-c").style.display = "block";
        document.getElementById("enx-e").innerText = ecp.English
        document.getElementById("enx-p").innerText = ecp.Pronunciation
        document.getElementById("enx-c").innerText = ecp.Chinese
        document.getElementById("enx-query-count").innerText = `Query Count: ${ecp.LoadCount || 0}`
        document.getElementById("enx-search-key").innerText = ecp.English
        // Add loaded class
        enxWindow.classList.remove("loading");
        enxWindow.classList.add("loaded");

                // Calculate content lines and reposition popup
        setTimeout(() => {
            const lineInfo = calculateContentLines();
            console.log(`Popup content line count completed: Total lines=${lineInfo.totalLines}`);

            // Get popup dimensions after loading is complete
            const dimensions = getPopupDimensions();
            if (dimensions) {
                console.log("Popup dimensions after loading:");
                console.log(`- Height: ${dimensions.height}px`);
                console.log(`- Width: ${dimensions.width}px`);
                console.log(`- Is visible: ${dimensions.isVisible}`);
            }

            // Recalculate popup position
            const enxWindow = document.getElementById("enx-window");
            if (enxWindow && enxWindow.style.display !== "none") {
                // Try to find the original clicked target element
                const wordElements = document.querySelectorAll(`[alt="${key}"]`);
                if (wordElements.length > 0) {
                    const targetElement = wordElements[0]; // Use the first matching element
                    console.log("Found target element, recalculating popup position");

                    const newPosition = calculateOptimalPosition(targetElement);
                    enxWindow.style.left = newPosition.x + "px";
                    enxWindow.style.top = newPosition.y + "px";
                    console.log("Repositioned popup after API response:", newPosition.x, newPosition.y);
                } else {
                    console.log("Target element not found, cannot reposition");
                }
            }
        }, 100);

        // set youdao link
        document.getElementById("youdao_link").href = "https://www.youdao.com/result?word=" + ecp.English + "&lang=en"

        // update underline color
        // if key is multi-word, if multi-word do not update underline color
        if (key.includes(" ")) {
            console.log("key is multi-word, do not update underline color")
        } else {
            updateUnderLine(response.ecp)
        }
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

// Add event delegation for all <u alt=...> elements
// This allows popEnxDialogBox to be called from user clicks, even if not in global window

document.body.addEventListener('click', function(e) {
    if (
        e.target &&
        e.target.tagName === 'U' &&
        e.target.hasAttribute('alt') &&
        e.target.getAttribute('alt') &&
        e.target.innerText &&
        e.target.getAttribute('alt') !== 'null' &&
        e.target.innerText.trim() !== '' &&
        !window.getSelection().toString().includes(' ')
    ) {
        window.popEnxDialogBox(e);
    }
});
