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

export function findChildNodes(parentNode){
    let nodeList = []
    console.log("parent node: ", parentNode)
    console.log("find child node, parent node: ", parentNode)
    let childNodes = parentNode.childNodes

    console.log("child node count: ", childNodes.length)
    if (childNodes.length === 0) {
        console.log("child node count == 0 return")
        return nodeList
    }

    var textContent = '';
    childNodes.forEach(function (tmpNode) {
        if (tmpNode.nodeType === 3) {
            if (tmpNode.textContent.trim() !== ""){
                textContent += tmpNode.textContent.trim() + ' ';
            }
        }
    });

    console.log("outer div content: ", textContent, ", length: ", textContent.length);

    if (textContent === ""){
        childNodes.forEach(function (tmpNode) {
            let tmpNodeType = tmpNode.nodeType
            let tmpNodeTagName = tmpNode.tagName
            console.log("child node: ",tmpNode, ", tag: ", tmpNodeTagName, ", type: ", tmpNodeType)
            if (tmpNodeType === 1){
                if (tmpNodeTagName.toUpperCase() === "P" || tmpNodeTagName.toUpperCase() === "BLOCKQUOTE"){
                    let tmp_list = findChildNodes(tmpNode)
                    nodeList = nodeList.concat(tmp_list)
                }
            }
        });
    }else{
        let tmp_node = new ArticleNode(parentNode, textContent)
        nodeList.push(tmp_node)
        
    }
    return nodeList
}
