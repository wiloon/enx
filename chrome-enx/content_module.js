function generateUUID() {
    // Use crypto.getRandomValues to generate more secure random numbers
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);

    // Set version number (4)
    array[6] = (array[6] & 0x0f) | 0x40;
    // Set variant (RFC4122)
    array[8] = (array[8] & 0x3f) | 0x80;

    // Convert to UUID format
    return Array.from(array)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
        .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
}

class ArticleNode {
    constructor(node, paragraph) {
        this.id = generateUUID()
        this.node = node
        this.paragraph = paragraph.trim()
    }
}

export function createOneArticleNode() {
    console.log('foo')
}

const chineseCharRegex = /[\u4e00-\u9fa5]/

export function findChildNodes(parentNode) {
    let nodeList = []
    let childNodes = parentNode.childNodes
    let childNodeCount = childNodes.length
    console.log("find article node, root node, tag:", parentNode.tagName, "id:", parentNode.id,
        "class:", parentNode.className, "child node count:", childNodeCount);

    if (childNodes.length === 0) {
        console.log("child node count == 0 return")
        return nodeList
    }

    // try to find in child node
    let index = 1
    let textContent = '';


    let isParagraph = false
    if (parentNode.tagName.toUpperCase() === "P") {
        isParagraph = true
    }

    let childNodeTextContent = ""
    childNodes.forEach(function (tmpNode) {
        textContent = textContent + childNodeTextContent
        childNodeTextContent = ""

        let tmpNodeType = tmpNode.nodeType
        let tmpNodeTagName = tmpNode.tagName
        let tmpNodeId = tmpNode.id
        // index string x/y
        let indexString = index + "/" + childNodeCount
        console.log("child node:", indexString, ", type:", tmpNodeType, ", tag:", tmpNodeTagName, "id:", tmpNodeId)


        if (tmpNodeType === 1) {
            if (tmpNodeTagName.toUpperCase() === "P" ||
                tmpNodeTagName.toUpperCase() === "H2" ||
                tmpNodeTagName.toUpperCase() === "BLOCKQUOTE" ||
                tmpNodeTagName.toUpperCase() === "TABLE" ||
                tmpNodeTagName.toUpperCase() === "TBODY" ||
                tmpNodeTagName.toUpperCase() === "TR" ||
                tmpNodeTagName.toUpperCase() === "TD" ||
                tmpNodeTagName.toUpperCase() === "UL" ||
                tmpNodeTagName.toUpperCase() === "LI" ||
                tmpNodeTagName.toUpperCase() === "SPAN" ||
                tmpNodeTagName.toUpperCase() === "EM" ||
                tmpNodeTagName.toUpperCase() === "DIV") {
                let tmp_node_list = findChildNodes(tmpNode)
                console.log("child node list length: ", tmp_node_list.length, "is paragraph: ", isParagraph)
                if (tmp_node_list.length > 0) {
                    // Special handling for P tag
                    if (isParagraph) {
                        tmp_node_list.forEach(node => {
                            childNodeTextContent += node.paragraph + ' '
                        })
                    } else {
                        nodeList = nodeList.concat(tmp_node_list)
                    }
                    console.log("merged node list length: ", nodeList.length)
                }
            } else {
                console.log("ignore tag:", tmpNodeTagName)
            }
        } else if (tmpNodeType === 3) {
            let trimmedText = tmpNode.textContent.trim()
            if (trimmedText === "" || !/[a-zA-Z]/.test(trimmedText)) {
                console.log("text node empty, ignore")
            } else {
                textContent += trimmedText + ' ';
                const match = textContent.match(chineseCharRegex)
                let index_chinese = -1
                if (match) {
                    index_chinese = match.index
                }
                console.log("text node content length:", textContent.length, "content:", textContent, "chinese index:", index_chinese)

                if (index_chinese > 0) {
                    textContent = textContent.slice(0, index_chinese)
                    console.log("outer div content: ", textContent, ", length: ", textContent.length);
                }
            }
        } else {
            console.log("node type not Node.ELEMENT_NODE===1, node type:", tmpNodeType)
        }
        index++
    });
    textContent += childNodeTextContent
    if (textContent.length > 0) {
        let tmp_node = new ArticleNode(parentNode, textContent)
        console.log("found one paragraph id:", tmp_node.id, "content:", textContent)
        nodeList.push(tmp_node)
    }
    console.log("return node count: ", nodeList.length)
    return nodeList
}

export function renderInnerHtml(tmpInnerHtml, wordDict) {
    console.log("render inner html:", tmpInnerHtml," word dict:", wordDict)
    let newInnerHtml = ""
    let htmlTag = false
    let tagIndexStart = undefined
    let tagIndexStop = undefined
    let tagName = undefined

    let copyIndex = 0
    let wordIndexStart = undefined
    let wordIndexEnd = undefined
    let stringIndexStart = 0
    let stringIndexEnd = 1

    let index = 0
    while (index < tmpInnerHtml.length) {
        let oneCharacter = tmpInnerHtml.charAt(index)
        console.log("index:", index, "one character:", oneCharacter, "start:", wordIndexStart, "end ", wordIndexEnd, "html tag:", htmlTag)

        // Check for HTML entity
        if (oneCharacter === "&") {
            if (wordIndexStart !== undefined && wordIndexEnd === undefined) {
                wordIndexEnd = index
                console.log("word end index:", wordIndexEnd)
                let result = collectEnglishWord(tmpInnerHtml, wordIndexStart, wordIndexEnd, copyIndex, newInnerHtml, wordDict)
                newInnerHtml = result.newInnerHtml
                copyIndex = result.copyIndex
                wordIndexStart = result.wordIndexStart
                wordIndexEnd = result.wordIndexEnd
            }

            let entityEnd = tmpInnerHtml.indexOf(";", index)
            if (entityEnd !== -1) {
                // Found a complete HTML entity, copy it as is
                newInnerHtml = newInnerHtml + tmpInnerHtml.slice(copyIndex, entityEnd + 1)
                copyIndex = entityEnd + 1
                index = entityEnd
                wordIndexStart = undefined
                wordIndexEnd = undefined
                index++
                continue
            }
        }

        // Handle HTML tags
        if (oneCharacter === "<") {
            if (wordIndexStart !== undefined && wordIndexEnd === undefined) {
                wordIndexEnd = index
                console.log("word end index:", wordIndexEnd)
                let result = collectEnglishWord(tmpInnerHtml, wordIndexStart, wordIndexEnd, copyIndex, newInnerHtml, wordDict)
                newInnerHtml = result.newInnerHtml
                copyIndex = result.copyIndex
                wordIndexStart = result.wordIndexStart
                wordIndexEnd = result.wordIndexEnd
            }

            let htmlTagEnd = tmpInnerHtml.indexOf(">", index)
            if (htmlTagEnd !== -1) {
                // Check if this is an <a> tag
                let tagContent = tmpInnerHtml.slice(index, htmlTagEnd + 1)
                console.log("tag content:", tagContent)
                if (tagContent.toLowerCase().startsWith("<a ")) {
                    // Find the closing </a> tag
                    let closingTagStart = tmpInnerHtml.indexOf("</a>", htmlTagEnd)
                    if (closingTagStart !== -1) {
                        // Copy the entire <a> tag and its content
                        newInnerHtml = newInnerHtml + tmpInnerHtml.slice(copyIndex, closingTagStart + 4)
                        index = closingTagStart + 3
                        copyIndex = closingTagStart + 4
                        wordIndexStart = undefined
                        wordIndexEnd = undefined
                        continue
                    }
                }

                // For other tags, preserve spaces before HTML tags
                newInnerHtml = newInnerHtml + tmpInnerHtml.slice(copyIndex, htmlTagEnd + 1)
                index = htmlTagEnd + 1
                copyIndex = htmlTagEnd + 1
                wordIndexStart = undefined
                wordIndexEnd = undefined
                continue
            }
        }

        // Only process word characters when not in an HTML tag
        var oneCharacterCode = oneCharacter.charCodeAt();
        // 0-9, A-Z, a-z
        // 48-57, 65-90, 97-122
        if ((oneCharacterCode >= 48 && oneCharacterCode <= 57) || (oneCharacterCode >= 65 && oneCharacterCode <= 90) || (oneCharacterCode >= 97 && oneCharacterCode <= 122)) {
            // check if word start
            if (wordIndexStart === undefined) {
                wordIndexStart = index
                console.log("word start index:", wordIndexStart)
            }
        } else if (oneCharacter === "-" || oneCharacter === "'" || oneCharacter === "\u2019") {
            // do nothing, allow these characters within words
        } else {
            // non-english character
            if (wordIndexStart !== undefined && wordIndexEnd === undefined) {
                wordIndexEnd = index
                console.log("word end index:", wordIndexEnd)
            }
        }

        index = index + 1

        if (wordIndexStart === undefined || wordIndexEnd === undefined) {
            continue
        }

        // found one word
        let result = collectEnglishWord(tmpInnerHtml, wordIndexStart, wordIndexEnd, copyIndex, newInnerHtml, wordDict)
        newInnerHtml = result.newInnerHtml
        copyIndex = result.copyIndex
        wordIndexStart = result.wordIndexStart
        wordIndexEnd = result.wordIndexEnd
        console.log("new inner html:", newInnerHtml, "copy index:", copyIndex, "word index start:", wordIndexStart, "word index end:", wordIndexEnd)
    }
    newInnerHtml = newInnerHtml + tmpInnerHtml.slice(copyIndex)
    return newInnerHtml
}

function collectEnglishWord(tmpInnerHtml, wordIndexStart, wordIndexEnd, copyIndex, newInnerHtml, wordDict) {
    let tmpWord = tmpInnerHtml.slice(wordIndexStart, wordIndexEnd);

    console.log("found one word:", tmpWord);
    if (tmpWord in wordDict) {
        let ecp = wordDict[tmpWord];
        console.log("word: ", tmpWord, "ecp: ", ecp);

        let startTag = '';
        if (ecp.WordType === 1) {
            startTag = '<u alt="alt-foo" class="class-foo" style="text-decoration: #000000 underline; text-decoration-thickness: 2px;">';
        } else {
            startTag = '<u alt="alt-foo" onclick="popEnxDialogBox(event)" class="class-foo" style="text-decoration: #000000 underline; text-decoration-thickness: 2px;">';
        }

        let colorCode = getColorCodeByCount(ecp);
        startTag = startTag.replace("#000000", colorCode);
        startTag = startTag.replace("class-foo", "enx-" + ecp.Key);
        startTag = startTag.replace("alt-foo", ecp.English);
        newInnerHtml = newInnerHtml + tmpInnerHtml.slice(copyIndex, wordIndexStart);
        newInnerHtml = newInnerHtml + startTag + tmpWord + '</u>';
        console.log("new inner html 0:", newInnerHtml);
        copyIndex = wordIndexEnd;
        wordIndexStart = undefined;
        wordIndexEnd = undefined;
    } else {
        console.log("word no translation:", tmpWord);
        newInnerHtml = newInnerHtml + tmpInnerHtml.slice(copyIndex, wordIndexStart);
        newInnerHtml = newInnerHtml + tmpWord;
        console.log("new inner html 1:", newInnerHtml);
        copyIndex = wordIndexEnd;
        wordIndexStart = undefined;
        wordIndexEnd = undefined;
    }
    return {"newInnerHtml": newInnerHtml, "copyIndex": copyIndex, "wordIndexStart": wordIndexStart, "wordIndexEnd": wordIndexEnd}
}

export function getColorCodeByCount(ecp) {
    const MAX_COUNT = 30;  // Maximum count value for color calculation
    let loadCount = ecp.LoadCount
    let isAcquainted = ecp.AlreadyAcquainted

    if (isAcquainted === 1 || ecp.WordType === 1) {
        return "#FFFFFF"
    }
    if (loadCount === 0) {
        return "#FFFFFF"
    } else if (loadCount > 0) {
        // Normalize count value between 0 and 1
        let normalizedCount = Math.min(loadCount, MAX_COUNT) / MAX_COUNT;

        // Using HSL color model
        // Hue range: 0 (red) to 300 (purple)
        // Saturation: 100%
        // Lightness: 40% for better visibility on white background
        let hue = 300 * normalizedCount;  // Calculate hue proportionally
        return `hsl(${hue}, 100%, 40%)`;  // Reduced lightness for better contrast
    }
}

