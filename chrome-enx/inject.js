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
// click on one word
function popEnxDialogBox(mouseEvent) {
    console.log("pop enx dialog box, inject js")
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

    // 获取目标元素的位置
    const targetRect = eventTarget.getBoundingClientRect();

    // 计算相对于文档的位置
    let posX = targetRect.left + scrollX + (targetRect.width / 2) - (enxWindow.offsetWidth / 2);

    // 计算可用的上方空间（从页面顶部到目标元素）
    const availableSpace = targetRect.top + scrollY - 20; // 20px 的顶部边距

    // 设置最大高度为可用空间减去一些边距
    const maxHeight = Math.max(100, availableSpace - 40); // 最小高度100px，上下各留20px边距
    enxWindow.style.maxHeight = `${maxHeight}px`;

    // 计算弹窗位置（始终在目标元素上方）
    const posY = targetRect.top + scrollY - enxWindow.offsetHeight - 20; // 20px 的间距

    // 确保弹窗不会超出文档左右边界
    posX = Math.max(10, Math.min(posX, document.documentElement.scrollWidth - enxWindow.offsetWidth - 10));

    // 设置位置
    enxWindow.style.left = `${posX}px`;
    enxWindow.style.top = `${posY}px`;

    // 发送消息获取翻译
    window.postMessage({type: "getOneWord", word: SearchKey});
}
