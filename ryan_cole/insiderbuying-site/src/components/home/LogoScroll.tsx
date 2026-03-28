"use client";

const LOGOS = [
  "NVIDIA", "Apple", "Microsoft", "Amazon", "Meta", "Tesla",
  "Google", "JPMorgan", "Goldman Sachs", "Berkshire Hathaway",
  "Johnson & Johnson", "UnitedHealth", "Visa", "Mastercard",
  "Pfizer", "Eli Lilly", "Broadcom", "AMD", "Netflix", "Costco",
];

export function LogoScroll() {
  return (
    <section className="bg-white py-5 border-y border-[var(--color-border-light)] overflow-hidden">
      <p className="text-center text-xs text-[color:var(--color-muted)] mb-4">
        Tracking insider activity across 17,325+ publicly traded companies
      </p>
      <div className="relative">
        <div className="flex animate-scroll gap-16 whitespace-nowrap">
          {/* Double the logos for seamless loop */}
          {[...LOGOS, ...LOGOS].map((name, i) => (
            <span
              key={i}
              className="text-sm font-medium text-[color:var(--color-muted)] opacity-50 hover:opacity-100 transition-opacity shrink-0"
            >
              {name}
            </span>
          ))}
        </div>
      </div>

      <style jsx>{`
        @keyframes scroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .animate-scroll {
          animation: scroll 40s linear infinite;
        }
      `}</style>
    </section>
  );
}
