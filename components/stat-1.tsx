import type { CSSProperties, ReactNode } from "react";
import { ArrowDownRightIcon, ArrowUpRightIcon, MinusIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export type Stat1Props = {
    title: string;
    value: ReactNode;
    changeValue: string | number;
    direction?: "up" | "down" | "neutral";
    className?: string;
    style?: CSSProperties;
};

export const Stat1 = ({ title, value, changeValue, direction = "up", className, style }: Stat1Props) => {
    const variants = {
        up: {
            Icon: ArrowUpRightIcon,
            color: "text-green-500",
        },
        down: {
            Icon: ArrowDownRightIcon,
            color: "text-destructive",
        },
        neutral: {
            Icon: MinusIcon,
            color: "text-muted-foreground",
        },
    };

    const { Icon, color } = variants[direction];

    return (
        <Card className={cn("@container/card gap-4 py-4", className)} style={style}>
            <CardHeader className="px-4">
                <CardDescription className="font-medium">{title}</CardDescription>
                <CardTitle className="text-2xl font-semibold @[600px]/card:text-4xl @[800px]/card:text-5xl">
                    {value}
                </CardTitle>
            </CardHeader>
            <CardFooter className={cn("flex-row items-center gap-1 px-4 text-sm font-medium", color)}>
                <Icon className="size-4" />
                <span>{changeValue}</span>
            </CardFooter>
        </Card>
    );
};
