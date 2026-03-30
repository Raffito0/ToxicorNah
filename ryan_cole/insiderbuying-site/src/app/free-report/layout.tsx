import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Free Monthly Report | EarlyInsider",
  description:
    "Download our free monthly insider trading backtest report. Data-driven analysis of insider buying performance over the past 30 days.",
  openGraph: {
    title: "Free Monthly Report | EarlyInsider",
    description:
      "Free monthly insider trading backtest report with performance data.",
    url: "https://earlyinsider.com/free-report",
  },
};

export default function FreeReportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
