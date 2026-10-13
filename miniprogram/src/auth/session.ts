import Taro from "@tarojs/taro";
import { GRAPHQL_ENDPOINT } from "../config/endpoint";

const AUTH_ORIGIN = GRAPHQL_ENDPOINT.replace(/\/api\/graphql\/member$/u, "");
// 按后端地址隔离会话，开发／生产端点切换时分别使用对应 token。
export const AUTH_TOKEN_STORAGE_KEY = `go-starter:member-auth:${AUTH_ORIGIN}`;

function validToken(value: unknown): value is string {
    return typeof value === "string" && value.length > 0 && !/\s/u.test(value);
}
export function getAuthToken(): string {
    if (!AUTH_ORIGIN) return "";
    try {
        const value: unknown = Taro.getStorageSync(AUTH_TOKEN_STORAGE_KEY);
        return validToken(value) ? value : "";
    } catch {
        return "";
    }
}
// 延迟到达的旧会话响应只能清除自身 token，保留后续登录产生的新会话。
export function clearAuthToken(expectedToken: string): void {
    if (getAuthToken() === expectedToken) Taro.removeStorageSync(AUTH_TOKEN_STORAGE_KEY);
}

function responseMessage(data: unknown, fallback: string): string {
    if (data && typeof data === "object" && "message" in data && typeof data.message === "string")
        return data.message || fallback;
    return fallback;
}
async function authRequest(
    path: string,
    token?: string,
    data?: { email: string; password: string },
) {
    if (!AUTH_ORIGIN)
        throw new Error("请在 miniprogram/.env 配置 TARO_APP_GRAPHQL_ENDPOINT 后重新构建");
    try {
        return await Taro.request<unknown>({
            url: `${AUTH_ORIGIN}/api/auth/${path}`,
            method: "POST",
            timeout: 15000,
            data,
            header: {
                "Content-Type": "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
        });
    } catch (cause) {
        const message =
            cause && typeof cause === "object" && "errMsg" in cause ? String(cause.errMsg) : "";
        throw new Error(
            message.toLowerCase().includes("timeout")
                ? "登录服务请求超时，请重试"
                : "登录服务网络请求失败，请检查服务地址和网络",
        );
    }
}
export async function signIn(email: string, password: string): Promise<void> {
    const normalized = email.trim();
    if (!normalized || normalized.length > 255) throw new Error("请输入邮箱（最多 255 字符）");
    if (!password) throw new Error("请输入密码");
    const response = await authRequest("sign-in/email", undefined, { email: normalized, password });
    const data = response.data;
    const token = data && typeof data === "object" && "token" in data ? data.token : undefined;
    if (response.statusCode < 200 || response.statusCode >= 300 || !validToken(token))
        throw new Error(responseMessage(data, `登录失败（${response.statusCode}），请重试`));
    try {
        Taro.setStorageSync(AUTH_TOKEN_STORAGE_KEY, token);
    } catch {
        throw new Error("保存登录会话失败，请检查小程序存储后重试");
    }
}
export async function signOut(): Promise<void> {
    const token = getAuthToken();
    if (!token) return;
    const response = await authRequest("sign-out", token);
    if (
        response.statusCode === 401 ||
        (response.statusCode >= 200 &&
            response.statusCode < 300 &&
            response.data &&
            typeof response.data === "object" &&
            "success" in response.data &&
            response.data.success === true)
    ) {
        clearAuthToken(token);
        return;
    }
    throw new Error(
        responseMessage(response.data, `退出登录失败（${response.statusCode}），请重试`),
    );
}
