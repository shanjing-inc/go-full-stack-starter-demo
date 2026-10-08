import { ChevronsUpDownIcon, LogOutIcon } from "lucide-react";
import type { DashboardUser } from "../adapter.js";
import { cn, getInitials } from "../lib/utils.js";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar.js";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "../ui/dropdown-menu.js";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "../ui/sidebar.js";

function UserAvatar({ user }: { user: DashboardUser }) {
    return (
        <Avatar className="size-8 rounded-lg">
            <AvatarImage src={user.avatar} alt={user.name} />
            <AvatarFallback className="rounded-lg">
                {getInitials(user.name, user.email)}
            </AvatarFallback>
        </Avatar>
    );
}

export function NavUser({
    user,
    signingOut,
    onSignOut,
    error,
}: {
    user: DashboardUser;
    signingOut: boolean;
    error: string;
    onSignOut: () => Promise<void>;
}) {
    const { isMobile } = useSidebar();
    return (
        <SidebarMenu>
            <SidebarMenuItem>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <SidebarMenuButton
                            size="lg"
                            aria-label={`用户菜单：${user.name || user.email}`}
                            title={error || undefined}
                            className={cn(
                                "data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground",
                                error && "ring-1 ring-destructive",
                            )}
                        >
                            <UserAvatar user={user} />
                            <div className="grid flex-1 text-left text-sm/tight">
                                <span className="truncate font-medium">{user.name}</span>
                                <span className="truncate text-xs">{user.email}</span>
                            </div>
                            <ChevronsUpDownIcon className="ml-auto size-4" />
                        </SidebarMenuButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
                        side={isMobile ? "bottom" : "right"}
                        align="end"
                        sideOffset={4}
                    >
                        <DropdownMenuLabel className="p-0 font-normal">
                            <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                                <UserAvatar user={user} />
                                <div className="grid min-w-0 flex-1 text-left text-sm/tight">
                                    <span className="truncate font-medium">{user.name}</span>
                                    <span className="truncate text-xs">{user.email}</span>
                                </div>
                            </div>
                        </DropdownMenuLabel>
                        {error && <p className="px-2 py-1.5 text-sm text-destructive">{error}</p>}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            disabled={signingOut}
                            onSelect={() => {
                                void onSignOut();
                            }}
                        >
                            <LogOutIcon />
                            {signingOut ? "正在退出…" : "退出"}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </SidebarMenuItem>
        </SidebarMenu>
    );
}
