function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

class ArticleNode {
    constructor(node, paragraph) {
        this.node = node
        this.paragraph = paragraph
        this.id = generateUUID()
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
    
    childNodes.forEach(function (tmpNode) {
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
                if (tmp_node_list.length > 0) {
                    nodeList = nodeList.concat(tmp_node_list)
                    console.log("merged node list length: ", nodeList.length)
                }
            } else {
                console.log("ignore tag:", tmpNodeTagName)
            }
        } else if (tmpNodeType === 3) {
            if (tmpNode.textContent.trim() === "") {
                console.log("text node empty, ignore")

            } else {
                
                textContent += tmpNode.textContent.trim() + ' ';
                const match = textContent.match(chineseCharRegex)
                let index_chinese = -1
                if (match) {
                    index_chinese = match.index
                }
                console.log("text node content length:", textContent.length, "chinese index:", index_chinese)
            
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

    if (textContent.length > 0) {
        console.log("found one paragraph:", textContent)
        let tmp_node = new ArticleNode(parentNode, textContent)
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
        console.log("index:", index, "one character:", oneCharacter, "start:", wordIndexStart, "end ", wordIndexEnd, "html tag:", htmlTag, "tag name:", tagName)

        var oneCharacterCode = oneCharacter.charCodeAt();
        // 0-9, A-Z, a-z
        // 48-57, 65-90, 97-122
        if ((oneCharacterCode >= 48 && oneCharacterCode <= 57) || (oneCharacterCode >= 65 && oneCharacterCode <= 90) || (oneCharacterCode >= 97 && oneCharacterCode <= 122)) {
            // check if word start
            if (htmlTag === false && wordIndexStart === undefined) {
                wordIndexStart = index
                console.log("word start index:", wordIndexStart)
            }
        } else if (oneCharacter === "-" || oneCharacter === "'" || oneCharacter === "\u2019") {
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
                    if (tagName === "!--") {
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

        console.log("found one word:", tmpWord)
        if (tmpWord in wordDict) {
            let ecp = wordDict[tmpWord]
            console.log("word: ", tmpWord, "ecp: ", ecp)

            let startTag = ''
            if (ecp.WordType ===1) {
                startTag = '<u alt="alt-foo" class="class-foo" style="text-decoration: #000000 underline; text-decoration-thickness: 2px;">'
            }else{
                startTag = '<u alt="alt-foo" onclick="popEnxDialogBox(event)" class="class-foo" style="text-decoration: #000000 underline; text-decoration-thickness: 2px;">'
            }

            let colorCode = getColorCodeByCount(ecp)
            startTag = startTag.replace("#000000", colorCode);
            startTag = startTag.replace("class-foo", "enx-" + ecp.Key);
            startTag = startTag.replace("alt-foo", ecp.English);
            newInnerHtml = newInnerHtml + tmpInnerHtml.slice(copyIndex, wordIndexStart)
            newInnerHtml = newInnerHtml + startTag + tmpWord + '</u>'
            console.log("new inner html 0:", newInnerHtml)
            copyIndex = wordIndexEnd
            wordIndexStart = undefined
            wordIndexEnd = undefined
        } else {
            console.log("word no translation:", tmpWord)
            newInnerHtml = newInnerHtml + tmpInnerHtml.slice(copyIndex, wordIndexStart)
            newInnerHtml = newInnerHtml + tmpWord
            console.log("new inner html 1:", newInnerHtml)
            copyIndex = wordIndexEnd
            wordIndexStart = undefined
            wordIndexEnd = undefined
        }
    }
    newInnerHtml = newInnerHtml + tmpInnerHtml.slice(copyIndex)
    return newInnerHtml
}

export function getColorCodeByCount(ecp) {
    let loadCount = ecp.LoadCount
    let isAcquainted = ecp.AlreadyAcquainted

    if (isAcquainted === 1 || ecp.WordType ===1) {
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