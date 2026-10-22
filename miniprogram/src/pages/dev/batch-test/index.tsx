import { Title, Text } from "../../../components/ui/typography";
import { useRef, useState } from "react";
import { View } from "@tarojs/components";
import { useUnload } from "@tarojs/taro";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Card } from "../../../components/ui/card";
import { Tag } from "../../../components/ui/tag";
import { EmptyState } from "../../../components/ui/empty-state";
import { ThemePage } from "../../../components/theme/theme-page";
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
    const [authFailed, setAuthFailed] = useState(false);
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
        setAuthFailed(false);
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
                setAuthFailed(true);
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
                if (GRAPHQL_ENDPOINT && !hasSession) {
                    setAuthMessage("登录已失效，请重新登录后重试");
                    setAuthFailed(true);
                }
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
        <ThemePage>
            <Title>批量请求测试</Title>
            <Text className="mt-2 block" size="caption" theme="secondary">
                验证 BatchHttpLink 与 Member 端点批量协议（10ms 窗口合并）
            </Text>
            <Text className="mt-4 block break-all" size="caption" theme="secondary">
                端点：{GRAPHQL_ENDPOINT || "待配置"}
            </Text>
            <Card className="mt-6" title="账号登录" description="Member 端点需登录态，* 表示必填。">
                <Tag variant={signedIn ? "success" : "neutral"}>
                    {signedIn ? "已登录" : "未登录"}
                </Tag>
                {!signedIn && (
                    <View className="mt-4">
                        <Input
                            id="login-email"
                            label="邮箱 *"
                            placeholder="邮箱"
                            value={email}
                            disabled={loading || authenticating}
                            onInput={(event) => setEmail(event.detail.value)}
                        />
                        <Input
                            id="login-password"
                            label="密码 *"
                            borderless
                            placeholder="密码"
                            password
                            value={password}
                            disabled={loading || authenticating}
                            onInput={(event) => setPassword(event.detail.value)}
                        />
                    </View>
                )}
                <View className="mt-4">
                    <Button
                        fullWidth
                        variant={signedIn ? "ghost" : "default"}
                        disabled={loading || authenticating}
                        loading={authenticating}
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
                </View>
                {authMessage && (
                    <View className="mt-3">
                        {authFailed ? (
                            <Text className="block" size="caption" theme="error">
                                {authMessage}
                            </Text>
                        ) : (
                            <Tag variant="success">{authMessage}</Tag>
                        )}
                    </View>
                )}
            </Card>
            <Card className="mt-6" title="店铺查询">
                <Input
                    id="shop-query"
                    label="店铺 ID 或 slug *"
                    borderless
                    layout="vertical"
                    customStyle="--td-input-label-max-width: 100%;"
                    tips={error}
                    invalid={!!error}
                    placeholder="可输入数字 ID 或店铺标识"
                    value={value}
                    disabled={loading || authenticating}
                    onInput={(event) => setValue(event.detail.value)}
                />
                <View className="mt-4 flex flex-col gap-3">
                    <Button
                        fullWidth
                        disabled={loading || authenticating}
                        onClick={() => void run(false)}
                    >
                        发送单次请求
                    </Button>
                    <Button
                        fullWidth
                        variant="outline"
                        disabled={loading || authenticating}
                        onClick={() => void run(true)}
                    >
                        发送 {BATCH_SIZE} 条并发请求
                    </Button>
                </View>
                <Text className="mt-4 block" size="caption" theme="secondary">
                    {summary}
                </Text>
                {loading && (
                    <Tag className="mt-3" variant="brand">
                        请求中…
                    </Tag>
                )}
                {!rows.length && !error && !loading && (
                    <EmptyState title="等待查询" description="输入店铺信息，结果将在下方展示" />
                )}
            </Card>
            {rows.map((row) => (
                <Card key={row.index} className="mt-4">
                    <Title level="h5">
                        请求 {row.index} · {row.durationMs} ms
                    </Title>
                    <View className="mt-2">
                        {!row.error && row.shop ? (
                            <Tag variant="success">成功：{row.shop.name ?? row.shop.id}</Tag>
                        ) : (
                            <Text className="block" theme={row.error ? "error" : "secondary"}>
                                {row.error ?? "暂无匹配店铺"}
                            </Text>
                        )}
                    </View>
                </Card>
            ))}
        </ThemePage>
    );
}
