import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Contact | EarlyInsider",
  description:
    "Get in touch with the EarlyInsider team for support, partnership inquiries, or press requests.",
};

export default function ContactPage() {
  return (
    <div className="bg-[var(--color-bg-alt)]">
      <section className="bg-[var(--color-bg-alt)] pt-[var(--section-y-hero-mobile)] pb-[var(--section-y-hero-mobile)] md:pt-[var(--section-y-hero)] md:pb-[var(--section-y-hero)] px-[20px] md:px-[32px]">
        <div className="max-w-[800px] mx-auto text-center">
          <h1 className="font-[var(--font-montaga)] text-[39px] md:text-[54px] font-normal leading-[1.1] text-[color:var(--color-text)] mb-[var(--gap-tight)] md:mb-[24px]">Contact Us</h1>
          <p className="text-[16px] md:text-[18px] font-normal leading-[28px] text-[color:var(--color-text-secondary)]">
            We&apos;d love to hear from you. Reach out to our team for support, partnerships, or press inquiries.
          </p>
        </div>
      </section>

      <section className="bg-white pt-[48px] pb-[var(--section-y-mobile)] md:pt-[var(--section-y-mobile)] md:pb-[var(--section-y)] px-[20px] md:px-[32px]">
        <div className="max-w-[600px] mx-auto">
          <div className="flex flex-col gap-[40px]">
            <div>
              <h2 className="font-[var(--font-montaga)] text-[20px] font-bold leading-[28px] text-[color:var(--color-text)] mb-[8px]">General Support</h2>
              <p className="text-[16px] leading-[26px] text-[color:var(--color-text-secondary)]">For account issues, billing questions, or technical support.</p>
              <a href="mailto:support@earlyinsider.com" className="text-[16px] font-medium text-[color:var(--color-primary)] hover:underline mt-[8px] inline-block">support@earlyinsider.com</a>
            </div>
            <div>
              <h2 className="font-[var(--font-montaga)] text-[20px] font-bold leading-[28px] text-[color:var(--color-text)] mb-[8px]">Enterprise & Partnerships</h2>
              <p className="text-[16px] leading-[26px] text-[color:var(--color-text-secondary)]">For institutional partnerships, API access, or custom data solutions.</p>
              <a href="mailto:enterprise@earlyinsider.com" className="text-[16px] font-medium text-[color:var(--color-primary)] hover:underline mt-[8px] inline-block">enterprise@earlyinsider.com</a>
            </div>
            <div>
              <h2 className="font-[var(--font-montaga)] text-[20px] font-bold leading-[28px] text-[color:var(--color-text)] mb-[8px]">Press & Media</h2>
              <p className="text-[16px] leading-[26px] text-[color:var(--color-text-secondary)]">For media inquiries, interviews, or data citation requests.</p>
              <a href="mailto:press@earlyinsider.com" className="text-[16px] font-medium text-[color:var(--color-primary)] hover:underline mt-[8px] inline-block">press@earlyinsider.com</a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
