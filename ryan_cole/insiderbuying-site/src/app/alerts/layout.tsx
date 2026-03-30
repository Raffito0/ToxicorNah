import type { Metadata } from "next";
import { EmailCapture } from "@/components/EmailCapture";

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
  return (
    <>
      {children}
      <section className="w-full py-[48px] bg-[var(--color-bg-alt)] border-t border-[var(--color-border)]">
        <div className="max-w-[540px] mx-auto px-[20px] text-center">
          <EmailCapture
            heading="Get the Full Picture"
            subheading="Viewing the delayed feed (15 min). The CEO Alpha Report identifies the highest-conviction trades each month. Free."
            ctaText="Get the Free Report"
            placement="alerts_page"
          />
        </div>
      </section>
    </>
  );
}
