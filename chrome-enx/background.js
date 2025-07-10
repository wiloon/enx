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
const blog_url = 'https://blog.wiloon.com'

// Global flag to track session expiration
let sessionExpired = false;

// When the user clicks on the extension action
chrome.action.onClicked.addListener(async (tab) => {
    console.log("chrome action on click, url: ", tab.url)
    if (tab.url.startsWith(infoq_url) ||
        tab.url.startsWith(novel_ting_room) ||
        tab.url.startsWith(site_nytimes) ||
        tab.url.startsWith(blog_url) ||
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
                files: ["background2.js"],
            }).then(() => console.log("injected bar script file"));
        }
    }
});

// 从 storage 获取 session id
async function getSessionId() {
    const result = await chrome.storage.local.get(['sessionId']);
    return result.sessionId;
}

// Handle session expiration
async function handleSessionExpired() {
    if (sessionExpired) {
        return; // Already handled
    }
    
    sessionExpired = true;
    console.log("Session expired, clearing local storage and showing notification");
    
    // Clear session data
    await chrome.storage.local.remove(['isLoggedIn', 'username', 'sessionId']);
    
    // Show notification to user
    chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon-48.png',
        title: 'ENX Session Expired',
        message: 'Your session has expired. Please log in again to continue using ENX.'
    });
    
    // Open popup to show login form
    chrome.action.setPopup({popup: 'popup.html'});
}

// send http request to enx server
async function enxServerFoo(words) {
    // Check if session is already expired
    if (sessionExpired) {
        console.log("Session already expired, skipping request");
        return { error: "Session expired" };
    }
    
    words = encodeURIComponent(words);
    let url = 'https://enx-dev.wiloon.com/api/paragraph-init?paragraph=' + words
    console.log("calling enx server")
    const sessionId = await getSessionId();
    if (!sessionId) {
        console.log("no session id found");
        await handleSessionExpired();
        return { error: "No session ID" };
    }
    
    try {
        const response = await fetch(url, {
            headers: {
                "X-Session-ID": sessionId
            }
        });
        
        console.log("enx server response")
        console.log(response)
        
        // Check for session expiration
        if (response.status === 401) {
            console.log("Session expired (401)");
            await handleSessionExpired();
            return { error: "Session expired" };
        }
        
        if (!response.ok) {
            console.log("Server error:", response.status);
            return { error: `Server error: ${response.status}` };
        }
        
        const json = await response.json();
        console.log("enx server response json:")
        console.log(json)
        return json;
    } catch (error) {
        console.error("Network error:", error);
        return { error: "Network error" };
    }
}

async function enxServerGetOne(word) {
    // Check if session is already expired
    if (sessionExpired) {
        console.log("Session already expired, skipping request");
        return { error: "Session expired" };
    }
    
    let url = 'https://enx-dev.wiloon.com/api/translate?word=' + word
    console.log("calling enx server: ", Date.now())
    const sessionId = await getSessionId();
    if (!sessionId) {
        console.log("no session id found");
        await handleSessionExpired();
        return { error: "No session ID" };
    }
    
    try {
        const response = await fetch(url, {
            headers: {
                "X-Session-ID": sessionId
            }
        });
        
        console.log("enx server response: ", Date.now())
        console.log(response)
        
        // Check for session expiration
        if (response.status === 401) {
            console.log("Session expired (401)");
            await handleSessionExpired();
            return { error: "Session expired" };
        }
        
        if (!response.ok) {
            console.log("Server error:", response.status);
            return { error: `Server error: ${response.status}` };
        }
        
        const json = await response.json();
        console.log("enx server response json:")
        console.log(json)
        return json;
    } catch (error) {
        console.error("Network error:", error);
        return { error: "Network error" };
    }
}

// mark word as acquainted
async function markWord(key, userId) {
    // Check if session is already expired
    if (sessionExpired) {
        console.log("Session already expired, skipping request");
        return { error: "Session expired" };
    }
    
    let url = 'https://enx-dev.wiloon.com/api/mark'
    console.log("calling enx server, url: ", url)
    const sessionId = await getSessionId();
    if (!sessionId) {
        console.log("no session id found");
        await handleSessionExpired();
        return { error: "No session ID" };
    }
    
    let postBody = {
        "English": key,
        "userId": userId
    }
    
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-User-ID": userId.toString(),
                "X-Session-ID": sessionId
            },
            body: JSON.stringify(postBody)
        });
        
        console.log("enx server response: ", response)
        
        // Check for session expiration
        if (response.status === 401) {
            console.log("Session expired (401)");
            await handleSessionExpired();
            return { error: "Session expired" };
        }
        
        if (!response.ok) {
            console.log("Server error:", response.status);
            return { error: `Server error: ${response.status}` };
        }
        
        const json = await response.json();
        console.log("enx server response json: ", json)
        return json;
    } catch (error) {
        console.error("Network error:", error);
        return { error: "Network error" };
    }
}

// Reset session expired flag when user logs in
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.sessionId) {
        if (changes.sessionId.newValue) {
            // User logged in, reset the flag
            sessionExpired = false;
            console.log("Session restored, resetting expired flag");
        }
    }
});

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
            if (result.error) {
                console.log("Error:", result.error);
                sendResponse({error: result.error});
            } else {
                console.log(result.data)
                sendResponse({wordProperties: result.data});
            }
        })
    } else if (msgType === "getOneWord") {
        let word = request.word
        console.log("backend received msg, type: ", msgType, ", word: ", word)
        // send msg to enx server and get chinese
        enxServerGetOne(word).then(result => {
            console.log("listener response: ", Date.now())
            if (result.error) {
                console.log("Error:", result.error);
                sendResponse({error: result.error});
            } else {
                console.log(result)
                sendResponse({ecp: result});
            }
        })
    } else if (msgType === 'markAcquainted') {
        // mark word as acquainted
        let key = request.word

        // default user id is 1
        let userId = request.userId || 1
        console.log("mark word as acquainted, key: ", key, ", userId: ", userId)

        markWord(key, userId).then(result => {
            console.log("mark word response: ", result)
            if (result.error) {
                console.log("Error:", result.error);
                sendResponse({error: result.error});
            } else {
                sendResponse({ecp: result});
            }
        })
    }
    return true;
});
