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

// copied to content.js, any change sync with the content.js
// todo, try to merge two func int content.js, inject.js
// which one is in use?
function popEnxDialogBox(mouseEvent) {
    let eventTarget = mouseEvent.target;
    console.log("english word, on mouse click, target:",eventTarget)
    console.log("mouse event: ", mouseEvent)
    let mouseEventX = mouseEvent.clientX;
    let mouseEventY = mouseEvent.clientY;
    console.log("mouse event client x:", mouseEventX, "y:",mouseEventY)

    // get attribute value from event
    let SearchKey = eventTarget.getAttribute("alt");
    console.log("english word alt: ", SearchKey)

    let eventTargetRect = eventTarget.getBoundingClientRect();
    console.log("event target rect: ", eventTargetRect)
    document.getElementById("enx-window").style.display = "block";

    let enxWindowRect = document.getElementById("enx-window").getBoundingClientRect()
    console.log("enx rect: ", enxWindowRect)
    console.log("enx window left: ", enxWindowRect.left);
    console.log("enx window top: ", enxWindowRect.top);
    console.log("enx window height: ", enxWindowRect.height);
    let enxHeight = enxWindowRect.height

    let articleElement = document.getElementsByTagName("body");
    let articleRect = articleElement[0].getBoundingClientRect();
    baseX = articleRect.left
    baseY = articleRect.top
    console.log("base x: ", baseX)
    console.log("base y: ", baseY)

    let offsetX = 0;
    let offsetY = -50;
    let newX = mouseEventX - baseX - offsetX;
    let newY = mouseEventY - baseY + offsetY + (-1 * enxHeight);

    console.log("new x: ", newX);
    console.log("mouse event y:", mouseEventY, "base y:", baseY, "offset y:", offsetY, "enx height:", enxHeight, "new y: ", newY);

    document.getElementById("enx-window").style.left = newX + "px";
    document.getElementById("enx-window").style.top = newY + "px";
    console.log(document.getElementById("enx-window").getBoundingClientRect());
    let word = mouseEvent.target.innerText;

    // send word to enx server and get chinese
    console.log("send get one word from func foo")
    window.postMessage({type: "getOneWord", word: SearchKey});
}
