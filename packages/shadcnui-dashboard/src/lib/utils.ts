import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

/**
 * 根据用户名或邮箱生成头像占位符的首字母缩写
 * 优先使用 name 的前两个字符，如果 name 为空则使用 email 的前两个字符
 * @param name - 用户名
 * @param email - 用户邮箱
 * @returns 两个字符的大写首字母缩写
 */
export function getInitials(name: null | string | undefined, email: null | string | undefined) {
    const normalizedName = (name ?? "").trim();

    if (normalizedName) {
        return normalizedName.slice(0, 2).toUpperCase();
    }

    return (email ?? "U").slice(0, 2).toUpperCase();
}
