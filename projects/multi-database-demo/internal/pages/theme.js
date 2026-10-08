// 在样式加载前恢复主题，避免深色页面闪烁。
(() => {
    let theme = "light";
    try {
        theme = localStorage.getItem("site:theme") === "dark" ? "dark" : "light";
    } catch {
        // 存储受限时使用默认主题。
    }
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
})();
