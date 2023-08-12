console.log("injected script worked");

function parseEssentialDetails() {

    // main.performance = JSON.parse(JSON.stringify(window.performance)) || null;

    return {};
}

function enxOn() {
    console.log("enx on clicked: ", Date.now())
    let essential = parseEssentialDetails();
    window.postMessage({type: "FROM_PAGE", essential});
}

function enxOff() {
    console.log("enx off")
    let essential = parseEssentialDetails();
    window.postMessage({type: "unMark", essential});
}

let baseX = -1;
let baseY = -1;

function mouseover0(event) {
    console.log("on mouse over")
    console.log("mouse event: ",event)
    console.log("event client x: ", event.clientX)
    console.log("event client y: ", event.clientY)

    let eventTarget = event.target;
    let eventTargetRect = eventTarget.getBoundingClientRect();
    console.log("event target rect: ", eventTargetRect)
    document.getElementById("enx-window").style.display = "block";

    let enxWindowRect = document.getElementById("enx-window").getBoundingClientRect()
    console.log("enx rect: ",enxWindowRect)
    console.log("enx window left: ", enxWindowRect.left);
    console.log("enx window top: ", enxWindowRect.top);
    console.log("enx window top: ", enxWindowRect.height);
    let enxHeight=enxWindowRect.height
    if (baseX === -1 && baseY === -1) {
        console.log("set base x y")
        baseX = enxWindowRect.left
        baseY = enxWindowRect.top
    }
    let offsetX = 0;
    let offsetY = -10;
    let newX = event.clientX - baseX + offsetX;
    let newY = event.clientY - baseY + offsetY+(-1*enxHeight);

    console.log("new x: ", newX);
    console.log("new y: ", newY)

    document.getElementById("enx-window").style.left = newX + "px";
    document.getElementById("enx-window").style.top = newY + "px";
    console.log(document.getElementById("enx-window").getBoundingClientRect())
    let word = event.target.innerText
    // send word to enx server and get chinese
    window.postMessage({type: "getOneWord", word: word});
}
