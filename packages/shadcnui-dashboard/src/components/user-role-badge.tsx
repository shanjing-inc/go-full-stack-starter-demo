const roleToneClassNames = {
    indigo: "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300",
    sky: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300",
    zinc: "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-300",
};

// 与参考后台保持相同配色；组合角色保留完整名称。
export function UserRoleBadge({ role }: { role: null | string | undefined }) {
    const label = role ?? "unknown";
    const tone =
        label.toLowerCase() === "admin"
            ? "indigo"
            : label.toLowerCase() === "member"
              ? "sky"
              : "zinc";

    return (
        <span
            className={`inline-flex h-6 items-center rounded-md border px-2 text-xs font-medium ${roleToneClassNames[tone]}`}
        >
            {label}
        </span>
    );
}
