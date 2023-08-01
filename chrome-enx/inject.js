console.log("injected script worked");

function parseEssentialDetails() {
    let main = {};

    // main.performance = JSON.parse(JSON.stringify(window.performance)) || null;

    return main;
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