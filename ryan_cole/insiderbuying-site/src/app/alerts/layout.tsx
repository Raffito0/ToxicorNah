import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Live Insider Alerts | EarlyInsider",
  description:
    "Real-time SEC Form 4 insider trading alerts with AI-powered conviction scoring. Track what executives are buying and selling as it happens.",
  openGraph: {
    title: "Live Insider Alerts | EarlyInsider",
    description:
      "Real-time SEC Form 4 insider trading alerts with AI-powered conviction scoring.",
    url: "https://earlyinsider.com/alerts",
  },
};

export default function AlertsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
