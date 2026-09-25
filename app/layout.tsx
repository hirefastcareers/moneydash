import type { Metadata } from "next";
import { DM_Sans, Geist_Mono } from "next/font/google";

import { AdminLayout } from "@/components/admin-layout";
import { SectionProvider } from "@/components/section-nav";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import "./globals.css";
import "./fx.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
});

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "Money",
  description: "A personal money dashboard for income, spending, balances, and goals.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("h-full antialiased font-sans", dmSans.variable, fontMono.variable)}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <ThemeProvider>
          <TooltipProvider>
            <SectionProvider>
              <AdminLayout>{children}</AdminLayout>
            </SectionProvider>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
