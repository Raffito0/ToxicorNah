import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Reports | EarlyInsider",
  description:
    "Deep-dive stock reports, sector analysis bundles, and dividend research powered by SEC insider data and AI-driven financial modeling.",
};

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
