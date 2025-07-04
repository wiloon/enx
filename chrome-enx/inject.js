console.log("injected script worked");

function getArticleNode() {
    // gofluent
    let articleClassElement = document.getElementsByClassName("Article");
    if (articleClassElement.length === 0) {
        // infoq
        articleClassElement = document.getElementsByClassName("article__data");
    }
    return articleClassElement
}

function parseEssentialDetails() {
    // main.performance = JSON.parse(JSON.stringify(window.performance)) || null;
    return {};
}

function enxOn() {
    console.log("enx on clicked")
    let essential = parseEssentialDetails();
    window.postMessage({type: "mark", essential});
}

function enxOff() {
    console.log("enx off")
    let essential = parseEssentialDetails();
    window.postMessage({type: "unMark", essential});
}

let baseX = -1;
let baseY = -1;
