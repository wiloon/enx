class ArticleNode {
    constructor(node, paragraph) {
        this.node = node
        this.paragraph = paragraph
    }
}

export function createOneArticleNode(){
    let articleNode0 = new ArticleNode('foo', 'bar')
    console.log('a n: ', articleNode0)
}
