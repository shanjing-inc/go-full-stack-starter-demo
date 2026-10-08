import { useEffect, useState, type ReactNode } from "react";
import { CircleAlertIcon, GalleryVerticalEndIcon, UserRoundIcon } from "lucide-react";
import { Link, useLocation } from "react-router";
import type { DashboardAdapter, DashboardSession } from "./adapter.js";
import { AdapterContext, SessionContext } from "./dashboard-context.js";
import { navigationPageTitle, permittedNavigation, type DashboardNavItem } from "./navigation.js";
import { DashboardPreferences } from "./preferences.js";
import { NavMain } from "./components/nav-main.js";
import { TeamSwitcher } from "./components/team-switcher.js";
import { FontSizeSelector } from "./components/font-size-selector.js";
import { ThemeToggle } from "./components/theme-toggle.js";
import { NavUser } from "./components/nav-user.js";
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from "./ui/breadcrumb.js";
import { Separator } from "./ui/separator.js";
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarHeader,
    SidebarInset,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarProvider,
    SidebarRail,
    SidebarTrigger,
} from "./ui/sidebar.js";
import { Skeleton } from "./ui/skeleton.js";

type ShellProps = {
    adapter: DashboardAdapter;
    navItems: DashboardNavItem[];
    children: ReactNode;
    title: string;
    /** 应用提供共享会话时，壳层直接消费该状态。 */
    session?: DashboardSession | null;
};

function Shell({ adapter, navItems, children, title, session: suppliedSession }: ShellProps) {
    const { pathname } = useLocation();
    const [loadedSession, setSession] = useState<DashboardSession | null>(null);
    const [error, setError] = useState("");
    const [signingOut, setSigningOut] = useState(false);

    const session = suppliedSession === undefined ? loadedSession : suppliedSession;
    useEffect(() => {
        if (suppliedSession !== undefined) return;
        const controller = new AbortController();
        setSession(null);
        setError("");
        queueMicrotask(() => {
            if (controller.signal.aborted) return;
            adapter
                .getSession(controller.signal)
                .then((data) => {
                    if (!controller.signal.aborted) setSession(data);
                })
                .catch(() => {
                    if (!controller.signal.aborted) setError("会话读取失败");
                });
        });
        return () => controller.abort();
    }, [adapter, suppliedSession]);

    async function logout() {
        if (signingOut) return;
        setError("");
        setSigningOut(true);
        try {
            await adapter.signOut();
            setSession({ user: null, permissions: [] });
        } catch {
            setError("退出失败");
        } finally {
            setSigningOut(false);
        }
    }

    const visible = permittedNavigation(navItems, session?.permissions ?? []);
    const pageTitle = navigationPageTitle(visible, pathname);
    return (
        <AdapterContext value={adapter}>
            <SessionContext value={session}>
                <SidebarProvider>
                    <Sidebar collapsible="icon" autoCollapse="large">
                        <SidebarHeader>
                            <TeamSwitcher
                                teams={[
                                    {
                                        name: title,
                                        logo: <GalleryVerticalEndIcon className="size-4" />,
                                        plan: "工作空间",
                                    },
                                ]}
                            />
                        </SidebarHeader>
                        <SidebarContent>
                            <NavMain items={visible} />
                        </SidebarContent>
                        <SidebarFooter>
                            {session?.user ? (
                                <NavUser
                                    user={session.user}
                                    signingOut={signingOut}
                                    onSignOut={logout}
                                    error={error}
                                />
                            ) : error || session ? (
                                <SidebarMenu>
                                    <SidebarMenuItem>
                                        <SidebarMenuButton
                                            size="lg"
                                            tooltip={error || "访客"}
                                            aria-label={error || "访客"}
                                        >
                                            {error ? <CircleAlertIcon /> : <UserRoundIcon />}
                                            <span>{error || "访客"}</span>
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                </SidebarMenu>
                            ) : (
                                <Skeleton className="h-12 w-full group-data-[collapsible=icon]:size-8 lg:max-xl:group-data-[auto-collapse=large]:size-8" />
                            )}
                            {error && (
                                <p
                                    role="alert"
                                    className="px-2 text-sm text-destructive group-data-[collapsible=icon]:sr-only lg:max-xl:group-data-[auto-collapse=large]:sr-only"
                                >
                                    {error}
                                </p>
                            )}
                        </SidebarFooter>
                        <SidebarRail />
                    </Sidebar>
                    <SidebarInset className="min-h-svh bg-background">
                        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
                            <SidebarTrigger className="-ml-1" />
                            <Separator orientation="vertical" className="mr-2 h-4 self-center!" />
                            <Breadcrumb>
                                <BreadcrumbList>
                                    <BreadcrumbItem className="hidden md:block">
                                        <BreadcrumbLink asChild>
                                            <Link to="/">{title}</Link>
                                        </BreadcrumbLink>
                                    </BreadcrumbItem>
                                    <BreadcrumbSeparator className="hidden md:block" />
                                    <BreadcrumbItem>
                                        <BreadcrumbPage>{pageTitle}</BreadcrumbPage>
                                    </BreadcrumbItem>
                                </BreadcrumbList>
                            </Breadcrumb>
                            <div className="ml-auto flex items-center gap-2">
                                <FontSizeSelector />
                                <ThemeToggle />
                            </div>
                        </header>
                        {session?.mode === "development" && (
                            <div className="border-b bg-amber-50 px-6 py-2 text-sm text-amber-900">
                                开发演示模式 · 当前身份由 demo 适配器提供
                            </div>
                        )}
                        <main className="flex flex-1 flex-col gap-6 p-4 md:p-6">{children}</main>
                    </SidebarInset>
                </SidebarProvider>
            </SessionContext>
        </AdapterContext>
    );
}

export function Dashboard({ storageKey, ...props }: ShellProps & { storageKey?: string }) {
    return (
        <DashboardPreferences storageKey={storageKey}>
            <Shell {...props} />
        </DashboardPreferences>
    );
}
