function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
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

export function findChildNodes(parentNode) {
    let nodeList = []
    console.log("find child node, parent node: ", parentNode)
    let childNodes = parentNode.childNodes
    console.log("child node count: ", childNodes.length)
    if (childNodes.length === 0) {
        console.log("child node count == 0 return")
        return nodeList
    }

    let textContent = '';
    // child node foreach, collect text
    childNodes.forEach(function (tmpNode) {
        if (tmpNode.nodeType === 3) {
            if (tmpNode.textContent.trim() !== "") {
                textContent += tmpNode.textContent.trim() + ' ';
            }
        }
    });

    const chineseCharRegex = /[\u4e00-\u9fa5]/
    const match = textContent.match(chineseCharRegex)
    let index_chinese = -1
    if (match) {
        index_chinese = match.index
    }
    console.log("text length:",textContent.length,"chinese index:", index_chinese)

    if (index_chinese > 0) {
        textContent = textContent.slice(0, index_chinese)
        console.log("outer div content: ", textContent, ", length: ", textContent.length);
    }

    if (textContent.length>0){
        console.log("text:",textContent)
    }

    if (textContent === undefined || textContent === "") {
        // if no text, try to find in child node
        childNodes.forEach(function (tmpNode) {
            let tmpNodeType = tmpNode.nodeType
            let tmpNodeTagName = tmpNode.tagName
            console.log("node:", tmpNode, ", tag:", tmpNodeTagName, ", type:", tmpNodeType)
            if (tmpNodeType === 1) {
                if (tmpNodeTagName.toUpperCase() === "P" ||
                    tmpNodeTagName.toUpperCase() === "BLOCKQUOTE" ||
                    tmpNodeTagName.toUpperCase() === "DIV") {
                    let tmp_list = findChildNodes(tmpNode)
                    nodeList = nodeList.concat(tmp_list)
                } else {
                    console.log("ignore tag:", tmpNodeTagName)
                }
            }else {
                console.log("node type not 1, node type:", tmpNodeType)
            }
        });
    } else {
        let tmp_node = new ArticleNode(parentNode, textContent)
        nodeList.push(tmp_node)
    }
    return nodeList
}
