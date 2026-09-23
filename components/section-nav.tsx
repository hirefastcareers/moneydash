"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

export const SECTIONS = ["overview", "cashflow", "balances", "goals", "routine", "statements"] as const;

export type SectionId = (typeof SECTIONS)[number];

export const SECTION_LABELS: Record<SectionId, string> = {
    overview: "Overview",
    cashflow: "Cash flow",
    balances: "Balances",
    goals: "Goals",
    routine: "Routine",
    statements: "Statements",
};

const SectionContext = createContext<{
    section: SectionId;
    setSection: (id: SectionId) => void;
} | null>(null);

export function SectionProvider({ children }: { children: ReactNode }) {
    const [section, setSection] = useState<SectionId>("overview");
    return <SectionContext.Provider value={{ section, setSection }}>{children}</SectionContext.Provider>;
}

export function useSection() {
    const value = useContext(SectionContext);
    if (!value) throw new Error("useSection must be used within SectionProvider");
    return value;
}

export function isSectionId(value: string): value is SectionId {
    return (SECTIONS as readonly string[]).includes(value);
}
