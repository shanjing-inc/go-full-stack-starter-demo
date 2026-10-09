import "./style.css";

/** 公开 SSR 页只增强局部交互，正文与记录由 Go 输出。 */
const root = document.documentElement;
const themeToggle = document.querySelector<HTMLButtonElement>("[data-theme-toggle]");
function updateThemeLabel() {
    const dark = root.classList.contains("dark");
    const label = dark ? "切换到浅色主题" : "切换到深色主题";
    themeToggle?.setAttribute("aria-label", label);
    themeToggle?.setAttribute("title", label);
    if (themeToggle?.hasAttribute("data-theme-icon")) {
        themeToggle.querySelector<SVGElement>("[data-theme-moon]")?.toggleAttribute("hidden", dark);
        themeToggle.querySelector<SVGElement>("[data-theme-sun]")?.toggleAttribute("hidden", !dark);
    } else if (themeToggle) {
        themeToggle.textContent = dark ? "浅色主题" : "深色主题";
    }
}
themeToggle?.addEventListener("click", () => {
    const theme = root.classList.toggle("dark") ? "dark" : "light";
    root.style.colorScheme = theme;
    try {
        localStorage.setItem("site:theme", theme);
    } catch {
        /* 主题切换保留在当前页面。 */
    }
    updateThemeLabel();
});
updateThemeLabel();

const counter = document.querySelector<HTMLOutputElement>("[data-counter]");
let count = 0;
try {
    const saved = Number(localStorage.getItem("go-demo:counter"));
    if (Number.isSafeInteger(saved)) count = saved;
} catch {
    /* 存储受限时计数器保留在当前页面。 */
}
function updateCounter() {
    if (counter) counter.value = String(count);
}
updateCounter();
document.querySelectorAll<HTMLButtonElement>("[data-counter-action]").forEach((button) => {
    button.addEventListener("click", () => {
        const action = button.dataset.counterAction;
        const next = action === "reset" ? 0 : count + (action === "increment" ? 1 : -1);
        if (Number.isSafeInteger(next)) count = next;
        try {
            localStorage.setItem("go-demo:counter", String(count));
        } catch {
            /* 保留内存状态。 */
        }
        updateCounter();
    });
});

const result = document.querySelector<HTMLElement>("[data-queue-result]");
const modeLabels: Record<string, string> = {
    success: "成功",
    "fail-once": "失败一次",
    "always-fail": "持续失败",
};
const queueTones: Record<string, string> = {
    critical: "border border-destructive/20 bg-destructive/10 text-foreground",
    default: "border border-primary/20 bg-primary/10 text-foreground",
    low: "border border-cyan-500/20 bg-cyan-500/10 text-foreground",
};
type DispatchResult = { queue: string; id?: string; error?: string };

/** 服务端结果通过文本节点写入，颜色仅使用页面预定义的队列样式。 */
function resultCard(row: DispatchResult, mode: string) {
    const card = document.createElement("div");
    card.dataset.queueResultCard = row.queue;
    const ok = Boolean(row.id);
    const tone = ok
        ? queueTones[row.queue] || queueTones.low
        : "border border-amber-500/20 bg-amber-500/10 text-foreground";
    card.className = `rounded-xl p-4 text-sm ${tone}`;
    const form = Array.from(
        document.querySelectorAll<HTMLFormElement>("[data-queue-dispatch]"),
    ).find((item) => item.dataset.queueName === row.queue);
    const title = document.createElement("p");
    title.className = ok ? "font-medium" : "";
    title.textContent = `${form?.dataset.queueDescription || row.queue} 队列任务${ok ? "已写入" : "写入失败"}。`;
    card.append(title);
    if (ok) {
        const id = document.createElement("p");
        id.className = "mt-2 break-all";
        id.append(document.createTextNode("job id:"));
        const code = document.createElement("code");
        code.className = "ml-2 rounded-sm bg-muted px-2 py-1 text-xs text-foreground";
        code.textContent = row.id || "";
        id.append(code);
        card.append(id);
        for (const value of [`queue: ${row.queue}`, `mode: ${mode}`]) {
            const line = document.createElement("p");
            line.className = "mt-2 text-muted-foreground";
            line.textContent = value;
            card.append(line);
        }
    } else {
        const error = document.createElement("p");
        error.className = "mt-2 text-amber-800 dark:text-amber-200";
        error.textContent = row.error || "任务投递失败，请稍后重试";
        card.append(error);
    }
    return card;
}
function resultMessage(message: string, error = false) {
    if (!result) return;
    const card = document.createElement("div");
    card.className = error
        ? "rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive"
        : "rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground";
    if (error) card.setAttribute("role", "alert");
    card.textContent = message;
    result.replaceChildren(card);
}

let dispatching = false;
document.querySelectorAll<HTMLFormElement>("[data-queue-dispatch]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (dispatching) return;
        dispatching = true;
        const controls = Array.from(
            document.querySelectorAll<HTMLButtonElement>("[data-queue-dispatch] button"),
        );
        const wasDisabled = controls.map((control) => control.disabled);
        const submitter = event.submitter as HTMLButtonElement | null;
        const data = new FormData(form);
        const queue = String(data.get("queue") || "");
        const mode = submitter?.value || "success";
        const action = document.querySelector("[data-queue-action]");
        const modeLabel = document.querySelector("[data-queue-mode]");
        const requestedAt = document.querySelector("[data-queue-requested-at]");
        if (action) action.textContent = queue;
        if (modeLabel) modeLabel.textContent = modeLabels[mode] || mode;
        if (requestedAt) requestedAt.textContent = new Date().toISOString();
        controls.forEach((control) => {
            control.disabled = true;
        });
        resultMessage("正在派发任务…");
        result?.setAttribute("aria-busy", "true");
        try {
            const response = await fetch("/api/rest/demo/queue-test", {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ queue, mode }),
            });
            const body = await response.json();
            if (!response.ok) {
                resultMessage(
                    body.message || body.error?.message || "任务投递失败，请检查会话和权限",
                    true,
                );
                return;
            }
            if (result) {
                const grid = document.createElement("div");
                grid.className = "grid gap-4 lg:grid-cols-2";
                for (const row of body.results as DispatchResult[])
                    grid.append(resultCard(row, mode));
                result.replaceChildren(grid);
            }
        } catch {
            resultMessage("任务投递失败，请稍后重试", true);
        } finally {
            controls.forEach((control, index) => {
                control.disabled = wasDisabled[index];
            });
            result?.removeAttribute("aria-busy");
            dispatching = false;
        }
    });
});

const scrollKey = "queue-test:scroll-y";
document.querySelector("[data-refresh-records]")?.addEventListener("click", () => {
    try {
        sessionStorage.setItem(scrollKey, String(window.scrollY));
    } catch {
        /* 刷新继续执行。 */
    }
});
try {
    const saved = sessionStorage.getItem(scrollKey);
    sessionStorage.removeItem(scrollKey);
    if (saved !== null && Number.isFinite(Number(saved)))
        window.scrollTo({ top: Number(saved), behavior: "instant" });
} catch {
    /* 存储受限时保持默认滚动位置。 */
}
