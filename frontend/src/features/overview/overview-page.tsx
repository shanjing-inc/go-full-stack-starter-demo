import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Card, CardHeader, CardTitle, CardContent } from "@shanjing/shadcnui-dashboard";
import { adapter } from "../../app/dashboard-adapter";

export function OverviewPage() {
    const [data, setData] = useState<{ shops: number; backend: string } | null>(null);
    const [error, setError] = useState("");
    useEffect(() => {
        const c = new AbortController();
        queueMicrotask(() => {
            if (c.signal.aborted) return;
            adapter
                .getSystemData<{ shops: number; backend: string }>("overview", c.signal)
                .then((d) => {
                    if (!c.signal.aborted) setData(d);
                })
                .catch(() => {
                    if (!c.signal.aborted) setError("概览读取失败");
                });
        });
        return () => c.abort();
    }, []);
    return (
        <>
            <h1 className="text-2xl font-semibold">系统概览</h1>
            {error && <p role="alert">{error}</p>}
            <div className="grid gap-4 md:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>后端运行栈</CardTitle>
                    </CardHeader>
                    <CardContent>{data?.backend ?? "加载中"}</CardContent>
                </Card>
                <Card>
                    <CardHeader>
                        <CardTitle>店铺数量</CardTitle>
                    </CardHeader>
                    <CardContent data-testid="shop-count">{data?.shops ?? "加载中"}</CardContent>
                </Card>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>团队复用边界</CardTitle>
                </CardHeader>
                <CardContent>
                    公共 Dashboard 提供壳层、导航、主题和组件。应用维护菜单、路由、业务页面及 API
                    适配。
                </CardContent>
            </Card>
            <Link to="/shops">进入店铺列表</Link>
        </>
    );
}
