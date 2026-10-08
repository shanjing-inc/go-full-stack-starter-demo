"use client";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible.js";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuTrigger,
} from "../ui/dropdown-menu.js";
import { navigationSubItemActive, type DashboardNavItem } from "../navigation.js";
import {
    SidebarGroup,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarMenuSub,
    SidebarMenuSubButton,
    SidebarMenuSubItem,
    useSidebar,
} from "../ui/sidebar.js";
import { ChevronRightIcon } from "lucide-react";
import { Fragment, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";

export function NavMain({ items }: { items: DashboardNavItem[] }) {
    const location = useLocation();
    const navigate = useNavigate();
    const { isMobile, setOpenMobile } = useSidebar();
    const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

    function closeMobileSidebar() {
        if (isMobile) {
            setOpenMobile(false);
        }
    }

    function isRouteActive(url: string) {
        return location.pathname === url;
    }

    function isRouteWithin(url: string) {
        return location.pathname === url || location.pathname.startsWith(`${url}/`);
    }

    function isSectionActive(item: DashboardNavItem) {
        const isCurrentItemActive =
            item.url !== null &&
            (item.items.length > 0 ? isRouteWithin(item.url) : isRouteActive(item.url));

        return isCurrentItemActive || item.items.some((subItem) => isRouteWithin(subItem.url));
    }

    return (
        <SidebarGroup>
            <SidebarGroupLabel>工作空间</SidebarGroupLabel>
            <SidebarMenu>
                {items.map((item) => {
                    const Icon = item.icon;
                    const sectionActive = isSectionActive(item);
                    const hasSubItems = item.items.length > 0;
                    const sectionOpen = sectionActive || openSections[item.id] === true;

                    if (!hasSubItems) {
                        return (
                            <SidebarMenuItem key={item.id}>
                                <SidebarMenuButton
                                    tooltip={item.title}
                                    isActive={sectionActive}
                                    onClick={() => {
                                        if (item.url) {
                                            navigate(item.url);
                                        }
                                        closeMobileSidebar();
                                    }}
                                >
                                    <Icon />
                                    <span>{item.title}</span>
                                </SidebarMenuButton>
                            </SidebarMenuItem>
                        );
                    }

                    return (
                        <Fragment key={item.id}>
                            <SidebarMenuItem
                                key={`${item.id}-dropdown`}
                                className="hidden group-data-[collapsible=icon]:block lg:max-xl:group-data-[auto-collapse=large]:block"
                            >
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <SidebarMenuButton isActive={sectionActive}>
                                            <Icon />
                                            <span>{item.title}</span>
                                        </SidebarMenuButton>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent
                                        side="right"
                                        align="start"
                                        className="w-40"
                                    >
                                        <DropdownMenuLabel>{item.title}</DropdownMenuLabel>
                                        {item.items.map((subItem) => (
                                            <DropdownMenuItem
                                                key={subItem.id}
                                                asChild
                                                className={
                                                    navigationSubItemActive(
                                                        subItem,
                                                        location.pathname,
                                                    )
                                                        ? "bg-accent text-accent-foreground"
                                                        : undefined
                                                }
                                            >
                                                <Link
                                                    to={subItem.url}
                                                    aria-current={
                                                        navigationSubItemActive(
                                                            subItem,
                                                            location.pathname,
                                                        )
                                                            ? "page"
                                                            : undefined
                                                    }
                                                    onClick={closeMobileSidebar}
                                                >
                                                    <span>{subItem.title}</span>
                                                </Link>
                                            </DropdownMenuItem>
                                        ))}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </SidebarMenuItem>
                            <Collapsible
                                asChild
                                open={sectionOpen}
                                onOpenChange={(open) => {
                                    setOpenSections((currentSections) => ({
                                        ...currentSections,
                                        [item.id]: open,
                                    }));
                                }}
                                className="group/collapsible group-data-[collapsible=icon]:hidden lg:max-xl:group-data-[auto-collapse=large]:hidden"
                            >
                                <SidebarMenuItem>
                                    <CollapsibleTrigger asChild>
                                        <SidebarMenuButton
                                            tooltip={item.title}
                                            isActive={sectionActive}
                                            onClick={() => {
                                                if (!isMobile && item.url) {
                                                    navigate(item.url);
                                                }
                                            }}
                                        >
                                            <Icon />
                                            <span>{item.title}</span>
                                            <ChevronRightIcon className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                                        </SidebarMenuButton>
                                    </CollapsibleTrigger>
                                    <CollapsibleContent>
                                        <SidebarMenuSub>
                                            {item.items.map((subItem) => (
                                                <SidebarMenuSubItem key={subItem.id}>
                                                    <SidebarMenuSubButton
                                                        asChild
                                                        isActive={navigationSubItemActive(
                                                            subItem,
                                                            location.pathname,
                                                        )}
                                                    >
                                                        <Link
                                                            to={subItem.url}
                                                            aria-current={
                                                                navigationSubItemActive(
                                                                    subItem,
                                                                    location.pathname,
                                                                )
                                                                    ? "page"
                                                                    : undefined
                                                            }
                                                            onClick={closeMobileSidebar}
                                                        >
                                                            <span>{subItem.title}</span>
                                                        </Link>
                                                    </SidebarMenuSubButton>
                                                </SidebarMenuSubItem>
                                            ))}
                                        </SidebarMenuSub>
                                    </CollapsibleContent>
                                </SidebarMenuItem>
                            </Collapsible>
                        </Fragment>
                    );
                })}
            </SidebarMenu>
        </SidebarGroup>
    );
}
