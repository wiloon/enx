document.addEventListener('DOMContentLoaded', function() {
    const loginForm = document.getElementById('loginForm');
    const errorDiv = document.getElementById('error');

    // Check if already logged in
    chrome.storage.local.get(['isLoggedIn'], function(result) {
        if (result.isLoggedIn) {
            // If logged in, show logged in state
            showLoggedInState();
        }
    });

    loginForm.addEventListener('submit', function(e) {
        e.preventDefault();

        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;

        // Add actual login logic here
        login(username, password);
    });
});

function logEvent(event, message) {
    fetch('https://enx-dev.wiloon.com/api/log', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            event: event,
            message: message,
            timestamp: new Date().toISOString()
        })
    }).catch(err => {
        console.error('Log send error:', err);
    });
}

function login(username, password) {
    fetch('https://enx-dev.wiloon.com/login', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            username: username,
            password: password
        })
    })
    .then(response => response.json())
    .then(data => {
        logEvent('login', `username: ${username}, success: ${data.success}`);
        if (data.success) {
            // Save session information
            chrome.storage.local.set({
                isLoggedIn: true,
                username: username,
                sessionId: data.session_id
            }, function() {
                showLoggedInState();
            });
        } else {
            showError(data.message || 'Login failed, please try again');
        }
    })
    .catch(error => {
        logEvent('login', `username: ${username}, success: false, error: ${error}`);
        showError('An error occurred during login');
        console.error('Error:', error);
    });
}

function logout() {
    const sessionId = chrome.storage.local.get(['sessionId'], function(result) {
        if (result.sessionId) {
            fetch('https://enx-dev.wiloon.com/logout', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-ID': result.sessionId
                }
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    chrome.storage.local.remove(['isLoggedIn', 'username', 'sessionId'], function() {
                        location.reload();
                    });
                }
            })
            .catch(error => {
                console.error('Logout error:', error);
                // Clear local storage even if request fails
                chrome.storage.local.remove(['isLoggedIn', 'username', 'sessionId'], function() {
                    location.reload();
                });
            });
        } else {
            // If no session ID, just clear local storage
            chrome.storage.local.remove(['isLoggedIn', 'username', 'sessionId'], function() {
                location.reload();
            });
        }
    });
}

function showLoggedInState() {
    const loginForm = document.getElementById('loginForm');
    chrome.storage.local.get(['username'], function(result) {
    loginForm.innerHTML = `
        <div class="logged-in-container">
                <p>Logged in as: ${result.username}</p>
            <button id="enxRunBtn" class="enx-run-btn">Run Enx</button>
            <button id="logoutBtn">Logout</button>
        </div>
    `;

    document.getElementById('logoutBtn').addEventListener('click', function() {
        logout();
    });

    document.getElementById('enxRunBtn').addEventListener('click', function() {
        enxRun();
        });
    });
}

function enxRun() {
    // Get current tab
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        const currentTab = tabs[0];

        // Check if current page is in supported sites list
        const supportedSites = [
            'https://www.bbc.com',
            'https://www.infoq.com',
            'https://novel.tingroom.com',
            'https://messaging-custom-newsletters.nytimes.com'
        ];

        const isSupported = supportedSites.some(site => currentTab.url.startsWith(site));

        if (isSupported) {
            // Send message to content script
            chrome.tabs.sendMessage(currentTab.id, {action: "enxRun"}, function(response) {
                if (chrome.runtime.lastError) {
                    console.error(chrome.runtime.lastError);
                    showError('Failed to run: ' + chrome.runtime.lastError.message);
                } else {
                    console.log('Enx running successfully');
                }
            });
        } else {
            showError('Enx is not supported on this page');
        }
    });
}

function showError(message) {
    const errorDiv = document.getElementById('error');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
}
