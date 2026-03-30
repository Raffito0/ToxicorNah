import type { Metadata } from "next";
import { buildFAQJsonLd } from "@/lib/structured-data";

export const metadata: Metadata = {
  title: "FAQ | EarlyInsider",
  description:
    "Frequently asked questions about EarlyInsider: data sources, conviction scoring, pricing plans, security, and account management.",
  openGraph: {
    title: "FAQ | EarlyInsider",
    description:
      "Answers to common questions about EarlyInsider insider trading alerts.",
    url: "https://earlyinsider.com/faq",
  },
};

const FAQ_DATA = [
  { question: "Where does EarlyInsider get its data?", answer: "All insider trading data is sourced directly from SEC EDGAR. EarlyInsider monitors Form 3, Form 4, Form 5, and Schedule 13D/13G filings across 17,325+ public companies." },
  { question: "Is insider trading data legal to use?", answer: "Yes. SEC Form 4 filings are public documents, published on SEC EDGAR by federal mandate under Section 16(a) of the Securities Exchange Act of 1934." },
  { question: "How fast are the alerts?", answer: "Median delivery time is under 60 seconds from the moment a Form 4 filing appears on SEC EDGAR." },
  { question: "What is a conviction score?", answer: "A numeric score from 0 to 100 assigned to each Form 4 filing. The score weighs 7 factors including trade size, executive track record, cluster activity, and timing relative to earnings." },
  { question: "How is EarlyInsider different from OpenInsider?", answer: "OpenInsider displays raw Form 4 data with no analysis. EarlyInsider delivers parsed filings in under 60 seconds, assigns a conviction score, and generates plain-English analysis." },
  { question: "How is my data protected?", answer: "All data is encrypted in transit with TLS 1.3 and at rest with AES-256. Authentication is handled by Supabase Auth with bcrypt-hashed passwords." },
  { question: "Does EarlyInsider sell or share my personal data?", answer: "No. We do not sell, rent, or share your personal information with third parties for marketing purposes." },
  { question: "Can I cancel anytime?", answer: "Yes. Cancel from your account settings page in under 30 seconds. No phone call required, no retention page, no hidden steps." },
  { question: "Is there a free trial for paid plans?", answer: "Analyst and Investor plans include a 14-day free trial with full access to all plan features. No credit card is required to start the trial." },
  { question: "Does EarlyInsider provide financial advice?", answer: "No. EarlyInsider is a data analysis platform, not a registered investment advisor. No alert constitutes a buy, sell, or hold recommendation." },
];

const faqJsonLd = buildFAQJsonLd(FAQ_DATA);

export default function FaqLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      {children}
    </>
  );
}
