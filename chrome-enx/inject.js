console.log("injected script worked");

function getArticleNode() {
    // gofluent
    let articleClassElement = document.getElementsByClassName("Article");
    if (articleClassElement.length === 0) {
        // infoq
        articleClassElement = document.getElementsByClassName("article__data");
    }
    return articleClassElement
}

function parseEssentialDetails() {
    // main.performance = JSON.parse(JSON.stringify(window.performance)) || null;
    return {};
}

function enxOn() {
    console.log("enx on clicked")
    let essential = parseEssentialDetails();
    window.postMessage({type: "mark", essential});
}

function enxOff() {
    console.log("enx off")
    let essential = parseEssentialDetails();
    window.postMessage({type: "unMark", essential});
}

let baseX = -1;
let baseY = -1;

// copied to content.js, any change sync with the content.js
// todo, try to merge two func int content.js, inject.js
// which one is in use?
function popEnxDialogBox(mouseEvent) {
    const eventTarget = mouseEvent.target;
    const SearchKey = eventTarget.getAttribute("alt");
    const enxWindow = document.getElementById("enx-window");

    // 显示弹窗并添加动画类
    enxWindow.style.display = "block";
    // 强制重绘以确保过渡效果生效
    enxWindow.offsetHeight;
    enxWindow.classList.add("visible");

    // 获取文档滚动位置
    const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
    const scrollY = window.pageYOffset || document.documentElement.scrollTop;

    // 获取弹窗尺寸
    const enxRect = enxWindow.getBoundingClientRect();
    const enxWidth = enxRect.width;
    const enxHeight = enxRect.height;

    // 获取目标元素的位置
    const targetRect = eventTarget.getBoundingClientRect();

    // 计算相对于文档的位置
    let posX = targetRect.left + scrollX + (targetRect.width / 2) - (enxWidth / 2);
    let posY = targetRect.top + scrollY - enxHeight - 20; // 20px 的间距

    // 如果上方空间不足，则显示在目标元素下方
    if (posY < scrollY) {
        posY = targetRect.top + scrollY + targetRect.height + 20;
    }

    // 确保弹窗不会超出文档左右边界
    posX = Math.max(10, Math.min(posX, document.documentElement.scrollWidth - enxWidth - 10));

    // 设置位置
    enxWindow.style.left = `${posX}px`;
    enxWindow.style.top = `${posY}px`;

    // 发送消息获取翻译
    window.postMessage({type: "getOneWord", word: SearchKey});
}
