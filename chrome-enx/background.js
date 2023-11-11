console.log("background.js is running")

// set text as off when extension installed
chrome.runtime.onInstalled.addListener(() => {
    chrome.action.setBadgeText({
        text: 'OFF'
    });
});

const webstore = 'https://portal.gofluent.cn';
const infoq_url = 'https://www.infoq.com'
// When the user clicks on the extension action
chrome.action.onClicked.addListener(async (tab) => {
    console.log("chrome action on click, url: ", tab.url)
    if (tab.url.startsWith(webstore) || tab.url.startsWith(infoq_url)) {
        // We retrieve the action badge to check if the extension is 'ON' or 'OFF'
        const prevState = await chrome.action.getBadgeText({tabId: tab.id});
        // Next state will always be the opposite
        const nextState = prevState === 'ON' ? 'OFF' : 'ON';

        // Set the action badge to the next state
        await chrome.action.setBadgeText({
            tabId: tab.id,
            text: nextState
        });

        if (nextState === 'ON') {
            console.log("status on");

            const [tab] = await chrome.tabs.query({active: true, lastFocusedWindow: true});
            const response = await chrome.tabs.sendMessage(tab.id, {greeting: "mark"});
            // do something with response here, not outside the function
            console.log("response: ", response);

            await chrome.scripting.executeScript({
                target: {tabId: tab.id},
                files: ["foo.js"],
            }).then(() => console.log("injected foo script file"));
        } else if (nextState === 'OFF') {
            console.log("status off")
            await chrome.scripting.executeScript({
                target: {tabId: tab.id},
                files: ["bar.js"],
            }).then(() => console.log("injected bar script file"));
        }
    }
});

// send http request to enx server
async function enxServerFoo(words) {
    words = encodeURIComponent(words);
    let url = 'https://enx.wiloon.com/words-count?words=' + words
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

async function markWord(key) {
    let url = 'https://enx.wiloon.com/mark'
    console.log("calling enx server, url: ", url)
    let postBody = {"Key": key}
    const response = await fetch(url, {method: "POST", body: JSON.stringify(postBody)});
    console.log("enx server response: ", response)
    const json = await response.json();
    console.log("enx server response json: ", json)
    return json
}

// listen msg from content script
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
        console.log(sender.tab ?
            "from content script:" + sender.tab.url :
            "from the extension");
        console.log("request: ", Date.now())
        console.log(request)
        let msgType = request.msgType
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
            console.log("backend received msg, type: ", msgType)
            console.log("word: ", word)
            // send msg to enx server and get chinese
            enxServerGetOne(word).then(result => {
                console.log("listener response: ", Date.now())
                console.log(result)
                sendResponse({ecp: result});
            })
        } else if (msgType === 'markAcquainted') {
            let key = request.word
            console.log("markAcquainted: ", key)
            markWord(key).then(result => {
                console.log("mark word response: ", result)
                sendResponse({ecp: result});
            })
        }
        return true;
    }
);
