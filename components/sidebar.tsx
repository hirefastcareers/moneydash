"use client";

import {
    BadgeCheckIcon,
    BellIcon,
    ChevronsUpDownIcon,
    CreditCardIcon,
    LogOutIcon,
    UserIcon,
    WalletIcon,
} from "lucide-react";

import { demoAdminMenuItems } from "@/components/items";
import { useSection } from "@/components/section-nav";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@/components/ui/sidebar";

import { NavItem } from "./nav-item";

export const DemoAdminSidebar = () => {
    const { setSection } = useSection();

    return (
        <Sidebar>
            <SidebarHeader className="flex-row items-center gap-2.5 p-4">
                <button type="button" onClick={() => setSection("overview")} className="flex items-center gap-2.5">
                    <div className="bg-primary text-primary-foreground flex size-7.5 items-center justify-center rounded-md text-xl font-medium">
                        <WalletIcon className="size-4.5" />
                    </div>
                    <p className="text-xl font-semibold">Money</p>
                </button>
            </SidebarHeader>
            <SidebarContent>
                <SidebarMenu className="mt-2 mb-2 gap-0.5 px-2">
                    {demoAdminMenuItems.map((item, index) => (
                        <NavItem item={item} key={index} />
                    ))}
                </SidebarMenu>
            </SidebarContent>
            <SidebarFooter className="border-t p-1">
                <SidebarMenu>
                    <SidebarMenuItem>
                        <DropdownMenu>
                            <DropdownMenuTrigger
                                render={
                                    <SidebarMenuButton
                                        size="lg"
                                        className="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground">
                                        <Avatar className="size-8">
                                            <AvatarFallback>Y</AvatarFallback>
                                        </Avatar>
                                        <div className="grid flex-1 text-left text-sm leading-tight">
                                            <span className="truncate font-semibold">You</span>
                                            <span className="text-muted-foreground truncate text-xs">This browser</span>
                                        </div>
                                        <ChevronsUpDownIcon className="ms-auto size-4" />
                                    </SidebarMenuButton>
                                }
                            />
                            <DropdownMenuContent
                                className="w-(--anchor-width) min-w-56 rounded-lg"
                                side="top"
                                align="start"
                                sideOffset={4}>
                                <div className="flex items-center gap-2.5 p-2 text-left text-sm">
                                    <Avatar className="size-8">
                                        <AvatarFallback>Y</AvatarFallback>
                                    </Avatar>
                                    <div className="grid flex-1 text-left text-sm leading-tight">
                                        <span className="truncate font-semibold">You</span>
                                        <span className="text-muted-foreground truncate text-xs">This browser</span>
                                    </div>
                                </div>
                                <DropdownMenuSeparator />
                                <DropdownMenuGroup>
                                    <DropdownMenuItem>
                                        <UserIcon />
                                        <span>Profile</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem>
                                        <BadgeCheckIcon />
                                        <span>Account</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem>
                                        <CreditCardIcon />
                                        <span>Billing</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem>
                                        <BellIcon />
                                        <span>Notifications</span>
                                    </DropdownMenuItem>
                                </DropdownMenuGroup>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem variant="destructive">
                                    <LogOutIcon />
                                    <span>Sign Out</span>
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarFooter>
        </Sidebar>
    );
};
