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

function mouseover0(obj){
    console.log("on mouse over")
    console.log(obj)
    console.log(obj.innerText)
    let word = obj.innerText
    // send word to enx server and get chinese
    window.postMessage({type: "getOneWord", word: word});
}