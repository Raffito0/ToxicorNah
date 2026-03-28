const STEPS = [
  {
    step: "01",
    title: "We Scan",
    description: "Our system monitors every SEC Form 4 filing in real-time, 24/7. No delays, no manual checks.",
    icon: "📡",
  },
  {
    step: "02",
    title: "AI Filters",
    description: "AI analyzes each trade for conviction, historical patterns, and market context. Only significant trades pass.",
    icon: "🧠",
  },
  {
    step: "03",
    title: "You Get Alerted",
    description: "Receive instant alerts via email, push notification, or dashboard. Within 60 seconds of the SEC filing.",
    icon: "⚡",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="bg-white py-20">
      <div className="mx-auto max-w-[1100px] px-6">
        <h2 className="text-3xl text-center text-[color:var(--color-text)] mb-12">
          How It Works
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {STEPS.map((step) => (
            <div key={step.step} className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 flex items-center justify-center rounded-full bg-[var(--color-bg-alt)] text-2xl">
                {step.icon}
              </div>
              <div className="text-xs font-bold text-[color:var(--color-accent-green)] font-[var(--font-mono)] mb-2">
                STEP {step.step}
              </div>
              <h3 className="text-xl text-[color:var(--color-text)] mb-3">
                {step.title}
              </h3>
              <p className="text-sm text-[color:var(--color-muted)] leading-relaxed">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
