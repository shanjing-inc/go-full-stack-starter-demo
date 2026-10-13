import { useRef, useState } from "react";
import { Button, Input, Text, View } from "@tarojs/components";
import { useUnload } from "@tarojs/taro";
import { GRAPHQL_ENDPOINT } from "../../../config/endpoint";
import { getAuthToken, signIn, signOut } from "../../../auth/session";
import {
    BATCH_SIZE,
    diagnoseBatch,
    errorMessage,
    lookupWhere,
    type DiagnosticRow,
} from "../../../graphql/member/shop";

export default function BatchTestPage() {
    const [value, setValue] = useState("");
    const [loading, setLoading] = useState(false);
    const [rows, setRows] = useState<DiagnosticRow[]>([]);
    const [summary, setSummary] = useState("输入店铺 ID 或 slug，发起单次或批量请求!");
    const [error, setError] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [signedIn, setSignedIn] = useState(getAuthToken() !== "");
    const [authenticating, setAuthenticating] = useState(false);
    const [authMessage, setAuthMessage] = useState("");
    const active = useRef(true);
    const busy = useRef(false);
    useUnload(() => {
        active.current = false;
    });
    async function authenticate(signingOut: boolean) {
        if (busy.current || !active.current) return;
        busy.current = true;
        setAuthenticating(true);
        setAuthMessage("");
        try {
            if (signingOut) await signOut();
            else await signIn(email, password);
            if (active.current) {
                setSignedIn(getAuthToken() !== "");
                setPassword("");
                setRows([]);
                setError("");
                setSummary("输入店铺 ID 或 slug，发起单次或批量请求!");
                setAuthMessage(signingOut ? "已退出登录" : "登录成功，后续请求自动携带会话");
            }
        } catch (cause) {
            if (active.current) {
                setSignedIn(getAuthToken() !== "");
                setAuthMessage(errorMessage(cause));
            }
        } finally {
            busy.current = false;
            if (active.current) setAuthenticating(false);
        }
    }
    async function run(batch: boolean) {
        if (busy.current || !active.current) return;
        busy.current = true;
        setError("");
        setRows([]);
        try {
            const where = lookupWhere(value);
            if (GRAPHQL_ENDPOINT && !getAuthToken()) throw new Error("请先登录，再查询店铺");
            setLoading(true);
            setSummary("请求中…");
            const startedAt = Date.now();
            const result = await diagnoseBatch(where, batch ? BATCH_SIZE : 1);
            if (active.current) {
                setRows(result);
                const hasSession = getAuthToken() !== "";
                setSignedIn(hasSession);
                if (GRAPHQL_ENDPOINT && !hasSession) setAuthMessage("登录已失效，请重新登录后重试");
                const failed = result.filter((row) => row.error).length;
                setSummary(
                    `${batch ? `${BATCH_SIZE} 个并发操作` : "单个操作"} 总耗时 ${Date.now() - startedAt}ms` +
                        (failed > 0 ? `，失败 ${failed} 个` : "，全部成功"),
                );
            }
        } catch (cause) {
            if (active.current) {
                setError(errorMessage(cause));
                setSummary("请检查输入后重试");
            }
        } finally {
            busy.current = false;
            if (active.current) setLoading(false);
        }
    }
    return (
        <View className="min-h-screen px-6 py-8">
            <Text className="block text-3xl font-semibold">批量请求测试</Text>
            <Text className="mt-2 block text-sm text-gray-600">
                验证 BatchHttpLink 与 Member 端点批量协议（10ms 窗口合并）
            </Text>
            <Text className="mt-4 block break-all text-sm text-gray-600">
                端点：{GRAPHQL_ENDPOINT || "待配置"}
            </Text>
            <View className="mt-6 rounded-xl bg-white p-5 shadow-sm">
                <Text className="block text-base font-medium">登录（Member 端点需登录态）</Text>
                <Text className="mt-2 block text-sm text-gray-600">
                    {signedIn ? "已登录" : "未登录"}
                </Text>
                {!signedIn && (
                    <View>
                        <Input
                            className="mt-3 h-12 rounded-lg bg-gray-50 px-4 text-base"
                            placeholder="邮箱"
                            value={email}
                            disabled={loading || authenticating}
                            onInput={(event) => setEmail(event.detail.value)}
                        />
                        <Input
                            className="mt-3 h-12 rounded-lg bg-gray-50 px-4 text-base"
                            placeholder="密码"
                            password
                            value={password}
                            disabled={loading || authenticating}
                            onInput={(event) => setPassword(event.detail.value)}
                        />
                    </View>
                )}
                <Button
                    className="weapp-action-button mt-4 rounded-xl bg-action text-base text-white"
                    disabled={loading || authenticating}
                    onClick={() => void authenticate(signedIn)}
                >
                    {authenticating
                        ? signedIn
                            ? "退出中…"
                            : "登录中…"
                        : signedIn
                          ? "退出登录"
                          : "登录"}
                </Button>
                {authMessage && (
                    <Text className="mt-3 block text-sm text-gray-600">{authMessage}</Text>
                )}
            </View>
            <View className="mt-6 rounded-xl bg-white p-5 shadow-sm">
                <Text className="block text-base font-medium">店铺查询</Text>
                <Input
                    className="mt-3 h-12 rounded-lg bg-gray-50 px-4 text-base"
                    placeholder="店铺 ID 或 slug"
                    value={value}
                    disabled={loading || authenticating}
                    onInput={(event) => setValue(event.detail.value)}
                />
                <Button
                    className="weapp-action-button mt-4 rounded-xl bg-action text-base text-white"
                    disabled={loading || authenticating}
                    onClick={() => void run(false)}
                >
                    发送单次请求
                </Button>
                <Button
                    className="weapp-action-button mt-3 rounded-xl bg-action text-base text-white"
                    disabled={loading || authenticating}
                    onClick={() => void run(true)}
                >
                    发送 {BATCH_SIZE} 条并发请求
                </Button>
                <Text className="mt-4 block text-sm text-gray-600">{summary}</Text>
                {error && <Text className="mt-3 block text-sm text-red-700">{error}</Text>}
            </View>
            {rows.map((row) => (
                <View key={row.index} className="mt-4 rounded-xl bg-white p-5 shadow-sm">
                    <Text className="block text-base font-semibold">
                        请求 {row.index} · {row.durationMs} ms
                    </Text>
                    <Text
                        className={`mt-2 block text-base ${row.error ? "text-red-700" : "text-primary"}`}
                    >
                        {row.error ??
                            (row.shop
                                ? `成功：${row.shop.name ?? row.shop.id}`
                                : "成功：暂无匹配店铺")}
                    </Text>
                </View>
            ))}
        </View>
    );
}
