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

function login(username, password) {
    // Replace with your actual login API call
    fetch('https://enx.wiloon.com/login', {
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
        if (data.success) {
            // Login successful
            chrome.storage.local.set({isLoggedIn: true, username: username}, function() {
                showLoggedInState();
            });
        } else {
            // Login failed
            showError(data.message || 'Login failed, please try again');
        }
    })
    .catch(error => {
        showError('An error occurred during login');
        console.error('Error:', error);
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
        chrome.storage.local.remove(['isLoggedIn', 'username'], function() {
            location.reload();
        });
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
