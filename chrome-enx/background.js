console.log("background.js is running")

// set text as off when extension installed
chrome.runtime.onInstalled.addListener(() => {
    console.log('set text as off')
    chrome.action.setBadgeText({
        text: 'OFF'
    });
});

const infoq_url = 'https://www.infoq.com'
const novel_ting_room = 'https://novel.tingroom.com'
const site_bbc = 'https://www.bbc.com'
const site_nytimes = 'https://messaging-custom-newsletters.nytimes.com'

// When the user clicks on the extension action
chrome.action.onClicked.addListener(async (tab) => {
    console.log("chrome action on click, url: ", tab.url)
    if (tab.url.startsWith(infoq_url) ||
        tab.url.startsWith(novel_ting_room) ||
        tab.url.startsWith(site_nytimes) ||
        tab.url.startsWith(site_bbc)) {
        // We retrieve the action badge to check if the extension is 'ON' or 'OFF'
        const prevState = await chrome.action.getBadgeText({tabId: tab.id});
        // Next state will always be the opposite
        const nextState = prevState === 'ON' ? 'OFF' : 'ON';

        console.log("enx status, current: ", prevState, ", next: ", nextState)

        // Set the action badge to the next state
        await chrome.action.setBadgeText({
            tabId: tab.id,
            text: nextState
        });

        if (nextState === 'ON') {
            const [tab] = await chrome.tabs.query({active: true, lastFocusedWindow: true});

            try {
                console.log("sending mark msg to tab, id:", tab.id);
                const response = await chrome.tabs.sendMessage(tab.id, {greeting: "mark"});

                // do something with response here, not outside the function
                console.log("response: ", response);
            } catch (error) {
                console.log('failed to send mark event')
                console.error(error);
            }
            await chrome.scripting.executeScript({
                target: {tabId: tab.id},
                files: ["background1.js"],
            }).then(() => console.log("injected foo script file"));
        } else if (nextState === 'OFF') {
            await chrome.scripting.executeScript({
                target: {tabId: tab.id},
                files: ["backgroud2.js"],
            }).then(() => console.log("injected bar script file"));
        }
    }
});

// send http request to enx server
async function enxServerFoo(words) {
    words = encodeURIComponent(words);
    let url = 'https://enx.wiloon.com/paragraph-init?paragraph=' + words
    console.log("calling enx server")
    const response = await fetch(url);
    console.log("enx server response")
    console.log(response)
    const json = await response.json();
    console.log("enx server response json:")
    console.log(json)
    return json
}

async function enxServerGetOne(word) {
    let url = 'https://enx.wiloon.com/translate?word=' + word
    console.log("calling enx server: ", Date.now())
    const response = await fetch(url);
    console.log("enx server response: ", Date.now())
    console.log(response)
    const json = await response.json();
    console.log("enx server response json:")
    console.log(json)
    return json
}

// mark word as acquainted
async function markWord(key) {
    let url = 'https://enx.wiloon.com/mark'
    console.log("calling enx server, url: ", url)
    let postBody = {"English": key}
    const response = await fetch(url, {method: "POST", body: JSON.stringify(postBody)});
    console.log("enx server response: ", response)
    const json = await response.json();
    console.log("enx server response json: ", json)
    return json
}

// listen msg from content script
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
        let msgType = request.msgType
        console.log("message listener, new msg: ", request, ", msg type: ", msgType)
        console.log(sender.tab ?
            "from content script:" + sender.tab.url :
            "from the extension");

        if (msgType === "getWords") {
            console.log("backend received msg, type: ", msgType)
            let words = request.words

            enxServerFoo(words).then(result => {
                console.log("listener response")
                console.log(result.data)
                sendResponse({wordProperties: result.data});
            })
        } else if (msgType === "getOneWord") {
            let word = request.word
            console.log("backend received msg, type: ", msgType, ", word: ", word)
            // send msg to enx server and get chinese
            enxServerGetOne(word).then(result => {
                console.log("listener response: ", Date.now())
                console.log(result)
                sendResponse({ecp: result});
            })
        } else if (msgType === 'markAcquainted') {
            // mark word as acquainted
            let key = request.word
            console.log("mark word as acquainted, key: ", key)
            markWord(key).then(result => {
                console.log("mark word response: ", result)
                sendResponse({ecp: result});
            })
        }
        return true;
    }
);
