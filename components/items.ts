import {
    ArrowLeftRightIcon,
    FileTextIcon,
    LandmarkIcon,
    LayoutDashboardIcon,
    ListChecksIcon,
    TargetIcon,
    type LucideIcon,
} from "lucide-react";

import type { SectionId } from "@/components/section-nav";

export type MenuItem = {
    label: string;
    isTitle?: boolean;
    icon?: LucideIcon;
    href?: SectionId;
    items?: MenuItem[];
    external?: boolean;
    tag?: "coming-soon" | "new" | "trend" | "pro";
};

export const demoAdminMenuItems: MenuItem[] = [
    {
        label: "Money",
        isTitle: true,
    },
    {
        label: "Overview",
        icon: LayoutDashboardIcon,
        href: "overview",
    },
    {
        label: "Cash flow",
        icon: ArrowLeftRightIcon,
        href: "cashflow",
    },
    {
        label: "Balances",
        icon: LandmarkIcon,
        href: "balances",
    },
    {
        label: "Goals",
        icon: TargetIcon,
        href: "goals",
    },
    {
        label: "Routine",
        icon: ListChecksIcon,
        href: "routine",
    },
    {
        label: "Statements",
        icon: FileTextIcon,
        href: "statements",
    },
];
