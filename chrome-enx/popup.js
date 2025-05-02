document.addEventListener('DOMContentLoaded', function() {
    alert('popup.js loaded');
    const loginForm = document.getElementById('loginForm');
    const errorDiv = document.getElementById('error');

    // 检查是否已经登录
    chrome.storage.local.get(['isLoggedIn'], function(result) {
        if (result.isLoggedIn) {
            // 如果已登录，显示已登录状态
            showLoggedInState();
        }
    });

    loginForm.addEventListener('submit', function(e) {
        e.preventDefault();
        
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;

        // 这里添加实际的登录逻辑
        // 示例：调用您的登录 API
        login(username, password);
    });
});

function login(username, password) {
    console.log('Attempting to log in with username:', username);
    alert('login function called with username: ' + username);
    // 这里替换为您的实际登录 API 调用
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
            // 登录成功
            chrome.storage.local.set({isLoggedIn: true, username: username}, function() {
                showLoggedInState();
            });
        } else {
            // 登录失败
            showError(data.message || '登录失败，请重试');
        }
    })
    .catch(error => {
        showError('登录过程中发生错误');
        console.error('Error:', error);
    });
}

function showLoggedInState() {
    const loginForm = document.getElementById('loginForm');
    loginForm.innerHTML = `
        <p>已登录</p>
        <button id="logoutBtn">退出登录</button>
    `;
    
    document.getElementById('logoutBtn').addEventListener('click', function() {
        chrome.storage.local.remove(['isLoggedIn', 'username'], function() {
            location.reload();
        });
    });
}

function showError(message) {
    const errorDiv = document.getElementById('error');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
} 