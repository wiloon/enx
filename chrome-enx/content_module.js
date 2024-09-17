class ArticleNode {
    constructor(node, paragraph) {
        this.node = node
        this.paragraph = paragraph
    }
}

export function createOneArticleNode(){
    console.log('foo')
}

let spanWidth = 0;

export function findChildNodes0(parentNode){
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
            let tmp_list = findChildNodes0(node)
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

    if (oneParagraph == undefined) {
        console.log('paragraph is undefined')
        return
    }
    // remove duplicate whitespace
    oneParagraph = oneParagraph.replace(/\s+/g, ' ')
    console.log('inner text: ', oneParagraph)
    console.log('span inner html: ', spanContent)
    console.log("span width: ", spanWidth)
    // remove <a> tag
    let filteredContent = ""
    let tagAppeared = false
    let collectWord = true
    for (let i = 0; i < spanContent.length; i++) {
        if (!tagAppeared) {
            collectWord = true
        }
        let c = spanContent.charAt(i)
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

    let tmp_node = new ArticleNode(parentNode, oneParagraph)
    nodeList.push(tmp_node)
}
