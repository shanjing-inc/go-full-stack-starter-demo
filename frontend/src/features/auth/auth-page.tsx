import { useEffect, useState, type SubmitEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import {
    Card,
    CardHeader,
    CardTitle,
    CardContent,
    Button,
    Input,
} from "@shanjing/shadcnui-dashboard";
import { safeReturnTo } from "./session-context";

export function AuthPage({ install = false }: { install?: boolean }) {
    const navigate = useNavigate();
    const location = useLocation();
    const initialization = location.state as { initializedEmail?: string } | null;
    const [name, setName] = useState("");
    const [email, setEmail] = useState(initialization?.initializedEmail ?? "");
    const [password, setPassword] = useState("");
    const [token, setToken] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [status, setStatus] = useState<{ installed: boolean; enabled: boolean } | null>(null);
    useEffect(() => {
        const controller = new AbortController();
        setStatus(null);
        setError("");
        fetch("/api/auth/install-status", { signal: controller.signal, credentials: "include" })
            .then(async (response) => {
                if (!response.ok) throw new Error("初始化状态读取失败");
                return response.json();
            })
            .then((current) => {
                if (!controller.signal.aborted) setStatus(current);
            })
            .catch((err) => {
                if (!controller.signal.aborted) setError(err.message);
            });
        return () => controller.abort();
    }, [install]);
    async function submit(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault();
        setBusy(true);
        setError("");
        try {
            const passwordBytes = new TextEncoder().encode(password).length;
            // 旧凭据登录采用独立上限，覆盖原 128 个 UTF-16 码元的多字节密码。
            if (install ? passwordBytes < 8 || passwordBytes > 128 : passwordBytes > 512) {
                throw new Error(install ? "密码长度需要 8–128 字节" : "密码长度最多 512 字节");
            }
            const response = await fetch(
                install ? "/api/auth/initialize" : "/api/auth/sign-in/email",
                {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(
                        install
                            ? { name, email, password, bootstrapToken: token }
                            : { email, password },
                    ),
                },
            );
            const result = await response.json();
            if (!response.ok) throw new Error(result.message || "认证请求失败");
            setPassword("");
            setToken("");
            if (install) {
                setStatus({ installed: true, enabled: false });
                setEmail(result.user.email);
                navigate("/login", {
                    replace: true,
                    state: { initializedEmail: result.user.email },
                });
            } else {
                const returnTo = new URLSearchParams(location.search).get("returnTo");
                if (returnTo === "/test/queue" || returnTo === "/test/bus") {
                    window.location.assign(returnTo);
                } else {
                    navigate(safeReturnTo(returnTo), { replace: true });
                }
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "认证请求失败");
        } finally {
            setBusy(false);
        }
    }
    if (!install && status && !status.installed) {
        return <Navigate to="/install" replace />;
    }
    return (
        <main className="mx-auto max-w-md p-6 pt-16">
            <Card>
                <CardHeader>
                    <CardTitle>
                        <h1>{install ? "初始化管理员" : "邮箱登录"}</h1>
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {!install && initialization?.initializedEmail && status?.installed && (
                        <p role="status" className="mb-4">
                            管理员初始化成功，请使用刚设置的邮箱和密码登录。
                        </p>
                    )}
                    {install && status && !status.enabled ? (
                        <p>{status.installed ? "管理员已初始化" : "初始化入口已关闭"}</p>
                    ) : (
                        <form className="grid gap-4" onSubmit={submit}>
                            {install && (
                                <label className="grid gap-2">
                                    名称
                                    <Input
                                        autoComplete="name"
                                        required
                                        maxLength={255}
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                    />
                                </label>
                            )}
                            <label className="grid gap-2">
                                邮箱
                                <Input
                                    type="email"
                                    autoComplete="username"
                                    required
                                    maxLength={255}
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                />
                            </label>
                            <label className="grid gap-2">
                                密码
                                <Input
                                    type="password"
                                    autoComplete={install ? "new-password" : "current-password"}
                                    required
                                    maxLength={install ? 128 : 512}
                                    aria-describedby={install ? "password-requirements" : undefined}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                />
                            </label>
                            {install && (
                                <p
                                    id="password-requirements"
                                    className="text-sm text-muted-foreground"
                                >
                                    8–128 字节；8 个英文字符或 3 个常用汉字达到最低长度。
                                </p>
                            )}
                            {install && (
                                <label className="grid gap-2">
                                    初始化密钥
                                    <Input
                                        type="password"
                                        autoComplete="off"
                                        required
                                        value={token}
                                        onChange={(e) => setToken(e.target.value)}
                                    />
                                </label>
                            )}
                            <Button disabled={busy || !status} type="submit">
                                {busy ? "提交中" : install ? "创建管理员" : "登录"}
                            </Button>
                        </form>
                    )}
                    {error && (
                        <p role="alert" className="mt-4 text-destructive">
                            {error}
                        </p>
                    )}
                    {install && (
                        <Link className="mt-4 block underline" to="/login">
                            前往登录
                        </Link>
                    )}
                </CardContent>
            </Card>
        </main>
    );
}
