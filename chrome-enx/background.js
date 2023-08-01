console.log("background.js is running")

// set text as off when extension installed
chrome.runtime.onInstalled.addListener(() => {
    chrome.action.setBadgeText({
        text: 'OFF'
    });
});

const extensions = 'https://developer.chrome.com/docs/extensions';
const webstore = 'https://portal.gofluent.cn';


// When the user clicks on the extension action
chrome.action.onClicked.addListener(async (tab) => {
    if (tab.url.startsWith(extensions) || tab.url.startsWith(webstore)) {
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
            console.log("status on")
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
    let concatenatedWords = words.join("_")
    let url = 'https://enx.wiloon.com/load-count?words=' + concatenatedWords
    console.log("calling enx server: ", Date.now())
    const response = await fetch(url);
    console.log("enx server response: ", Date.now())
    console.log(response)
    const json = await response.json();
    console.log("enx server response json:")
    console.log(json)
    return json
}

// listen msg from content script
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
        console.log(sender.tab ?
            "from content script:" + sender.tab.url :
            "from the extension");
        console.log("request: ", Date.now())
        console.log(request)
        let words = request.words

        enxServerFoo(words).then(result => {
            console.log("listener response: ", Date.now())
            console.log(result.data)
            sendResponse({wordProperties: result.data});
        })
        return true;
    }
);
