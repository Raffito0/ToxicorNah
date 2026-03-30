import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Blog | EarlyInsider",
  description:
    "Insider trading analysis articles, data studies, and SEC filing breakdowns. Expert analysis of what corporate executives are buying and selling.",
  openGraph: {
    title: "Blog | EarlyInsider",
    description:
      "Insider trading analysis articles, data studies, and SEC filing breakdowns.",
    url: "https://earlyinsider.com/blog",
  },
};

export default function BlogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
