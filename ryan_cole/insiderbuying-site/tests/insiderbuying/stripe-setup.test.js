/**
 * Section 03: Stripe Products + Webhook Setup
 *
 * Validates the Stripe integration infrastructure:
 * - stripe.ts singleton, env guard
 * - checkout route: auth, priceId, coupon passthrough
 * - webhook route: signature verification, all 6 event types
 * - .env.example documents every required Stripe var
 */

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// 1. stripe.ts — singleton & env guard
// ---------------------------------------------------------------------------
describe("src/lib/stripe.ts", () => {
  const stripePath = path.resolve(
    __dirname,
    "../../src/lib/stripe.ts"
  );
  let src;

  beforeAll(() => {
    src = fs.readFileSync(stripePath, "utf-8");
  });

  test("exports getStripe function", () => {
    expect(src).toMatch(/export\s+function\s+getStripe/);
  });

  test("throws if STRIPE_SECRET_KEY is missing", () => {
    expect(src).toMatch(/STRIPE_SECRET_KEY/);
    expect(src).toMatch(/throw\s+new\s+Error/);
  });

  test("uses singleton pattern (caches instance)", () => {
    // Should have a module-level variable and a null-check
    expect(src).toMatch(/_stripe/);
    expect(src).toMatch(/if\s*\(\s*!_stripe\s*\)/);
  });
});

// ---------------------------------------------------------------------------
// 2. checkout route — POST /api/checkout
// ---------------------------------------------------------------------------
describe("src/app/api/checkout/route.ts", () => {
  const routePath = path.resolve(
    __dirname,
    "../../src/app/api/checkout/route.ts"
  );
  let src;

  beforeAll(() => {
    src = fs.readFileSync(routePath, "utf-8");
  });

  test("requires authenticated user (checks supabase auth)", () => {
    expect(src).toMatch(/auth\.getUser/);
    expect(src).toMatch(/Unauthorized/);
  });

  test("validates priceId is present", () => {
    expect(src).toMatch(/priceId/);
    expect(src).toMatch(/Missing priceId|!priceId/);
  });

  test("creates subscription-mode checkout session", () => {
    expect(src).toMatch(/mode:\s*["']subscription["']/);
  });

  test("passes coupon to Stripe discounts when provided", () => {
    expect(src).toMatch(/coupon/);
    expect(src).toMatch(/discounts/);
  });

  test("returns checkout session URL", () => {
    expect(src).toMatch(/session\.url/);
  });

  test("sets success and cancel URLs", () => {
    expect(src).toMatch(/success_url/);
    expect(src).toMatch(/cancel_url/);
  });
});

// ---------------------------------------------------------------------------
// 3. webhook route — POST /api/webhooks/stripe
// ---------------------------------------------------------------------------
describe("src/app/api/webhooks/stripe/route.ts", () => {
  const routePath = path.resolve(
    __dirname,
    "../../src/app/api/webhooks/stripe/route.ts"
  );
  let src;

  beforeAll(() => {
    src = fs.readFileSync(routePath, "utf-8");
  });

  test("verifies stripe-signature header", () => {
    expect(src).toMatch(/stripe-signature/);
    expect(src).toMatch(/constructEvent/);
  });

  test("rejects requests without signature", () => {
    expect(src).toMatch(/Missing signature/);
  });

  test("handles checkout.session.completed", () => {
    expect(src).toMatch(/checkout\.session\.completed/);
  });

  test("handles customer.subscription.updated", () => {
    expect(src).toMatch(/customer\.subscription\.updated/);
  });

  test("handles customer.subscription.deleted", () => {
    expect(src).toMatch(/customer\.subscription\.deleted/);
  });

  test("handles customer.subscription.created", () => {
    expect(src).toMatch(/customer\.subscription\.created/);
  });

  test("handles invoice.paid", () => {
    expect(src).toMatch(/invoice\.paid/);
  });

  test("handles invoice.payment_failed", () => {
    expect(src).toMatch(/invoice\.payment_failed/);
  });

  test("upserts subscription on checkout complete", () => {
    expect(src).toMatch(/subscriptions.*upsert|upsert.*subscriptions/s);
  });

  test("updates profile tier on checkout complete", () => {
    expect(src).toMatch(/subscription_tier.*pro|pro.*subscription_tier/s);
  });

  test("sets canceled status on subscription deleted", () => {
    expect(src).toMatch(/canceled/);
  });

  test("sets past_due status on payment failed", () => {
    expect(src).toMatch(/past_due/);
  });

  test("returns { received: true } on success", () => {
    expect(src).toMatch(/received:\s*true/);
  });

  test("checks Supabase errors and returns 500 on DB failure", () => {
    // Every handler should destructure { error } and check it
    const errorChecks = (src.match(/if\s*\(\s*\w*[Ee]rr/g) || []).length;
    expect(errorChecks).toBeGreaterThanOrEqual(5); // at least 5 error checks
  });

  test("returns 500 status on DB errors (enables Stripe retry)", () => {
    expect(src).toMatch(/status:\s*500/);
  });

  test("warns when customer.subscription.created has no userId", () => {
    expect(src).toMatch(/console\.warn.*no userId/);
  });

  test("uses resolveId helper for ID extraction", () => {
    expect(src).toMatch(/function\s+resolveId/);
  });

  test("uses PLAN_PRO constant instead of hardcoded string", () => {
    expect(src).toMatch(/PLAN_PRO/);
  });
});

// ---------------------------------------------------------------------------
// 4. .env.example — all Stripe vars documented
// ---------------------------------------------------------------------------
describe(".env.example — Stripe variables", () => {
  const envPath = path.resolve(
    __dirname,
    "../../.env.example"
  );
  let envContent;

  beforeAll(() => {
    envContent = fs.readFileSync(envPath, "utf-8");
  });

  const requiredVars = [
    "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_PRICE_ID_PRO_MONTHLY",
    "STRIPE_PRICE_ID_PRO_ANNUAL",
    "STRIPE_COUPON_ID_SUBSCRIBER",
  ];

  test.each(requiredVars)("%s is documented in .env.example", (varName) => {
    expect(envContent).toContain(varName);
  });
});

// ---------------------------------------------------------------------------
// 5. Pricing expectations (from spec)
// ---------------------------------------------------------------------------
describe("Pricing spec compliance", () => {
  const checkoutSrc = fs.readFileSync(
    path.resolve(__dirname, "../../src/app/api/checkout/route.ts"),
    "utf-8"
  );

  test("checkout route references price IDs from env (not hardcoded)", () => {
    // Should NOT contain hardcoded price_xxx strings
    expect(checkoutSrc).not.toMatch(/price_[a-zA-Z0-9]{10,}/);
    // Should accept priceId from request body
    expect(checkoutSrc).toMatch(/priceId/);
  });

  test("coupon is optional (not always applied)", () => {
    // Should have conditional logic for coupon
    expect(checkoutSrc).toMatch(/if\s*\(\s*coupon\s*\)/);
  });
});
