"use client";

import { Fragment, type ReactNode } from "react";

import { useSection, type SectionId } from "@/components/section-nav";

import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

type Props = {
    title: string;
    endContent?: ReactNode;
    links?: {
        label: string;
        href: SectionId;
    }[];
};

export const PageTitle = ({ title, endContent, links }: Props) => {
    const { setSection } = useSection();

    return (
        <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-lg font-medium sm:text-xl">{title}</p>
            <div className="flex flex-wrap items-center gap-3">
                {endContent}
                <Breadcrumb className="max-sm:hidden">
                    <BreadcrumbList>
                        <BreadcrumbItem>
                            <BreadcrumbLink render={<button type="button" onClick={() => setSection("overview")}>Money</button>} />
                        </BreadcrumbItem>
                        <BreadcrumbSeparator />
                        {links?.map((link, index) => (
                            <Fragment key={index}>
                                <BreadcrumbItem>
                                    <BreadcrumbLink
                                        render={
                                            <button type="button" onClick={() => setSection(link.href)}>
                                                {link.label}
                                            </button>
                                        }
                                    />
                                </BreadcrumbItem>
                                <BreadcrumbSeparator />
                            </Fragment>
                        ))}
                        <BreadcrumbItem>
                            <BreadcrumbPage>{title}</BreadcrumbPage>
                        </BreadcrumbItem>
                    </BreadcrumbList>
                </Breadcrumb>
            </div>
        </div>
    );
};
