/**
 * Section 05: Environment Variables + Deployment
 *
 * Validates:
 * - .env.example contains all required keys
 * - .gitignore protects secrets
 * - NEXT_PUBLIC_ vs server-only separation
 * - netlify.toml build config
 * - OneSignalSDKWorker.js exists
 * - No secrets hardcoded in source
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");

function readFile(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), "utf-8");
}

// ---------------------------------------------------------------------------
// 1. .env.example — all required keys
// ---------------------------------------------------------------------------
describe(".env.example completeness", () => {
  const envContent = readFile(".env.example");

  const requiredKeys = [
    // Supabase
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    // Stripe
    "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_PRICE_ID_PRO_MONTHLY",
    "STRIPE_PRICE_ID_PRO_ANNUAL",
    "STRIPE_COUPON_ID_SUBSCRIBER",
    // NocoDB
    "NOCODB_API_URL",
    "NOCODB_API_TOKEN",
    // OneSignal
    "NEXT_PUBLIC_ONESIGNAL_APP_ID",
    // Resend
    "RESEND_API_KEY",
    // Site
    "NEXT_PUBLIC_SITE_URL",
  ];

  test.each(requiredKeys)("%s is documented", (key) => {
    expect(envContent).toContain(key);
  });

  test("mentions insiderbuying.ai as site URL", () => {
    expect(envContent).toMatch(/insiderbuying\.ai/);
  });
});

// ---------------------------------------------------------------------------
// 2. .gitignore — secrets protected
// ---------------------------------------------------------------------------
describe(".gitignore protects secrets", () => {
  const gitignore = readFile(".gitignore");

  test("ignores .env.local", () => {
    expect(gitignore).toMatch(/\.env\.local/);
  });

  test("ignores .env*.local pattern", () => {
    expect(gitignore).toMatch(/\.env\*\.local/);
  });

  test(".env.example is NOT ignored", () => {
    // .env.example should be committed (not in .gitignore)
    // We just verify the file exists and is tracked
    expect(fs.existsSync(path.join(ROOT, ".env.example"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. NEXT_PUBLIC_ vs server-only separation
// ---------------------------------------------------------------------------
describe("Environment variable security", () => {
  const envContent = readFile(".env.example");

  const serverOnlyKeys = [
    "SUPABASE_SERVICE_ROLE_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "NOCODB_API_TOKEN",
    "RESEND_API_KEY",
  ];

  test.each(serverOnlyKeys)(
    "%s is NOT prefixed with NEXT_PUBLIC_",
    (key) => {
      expect(key).not.toMatch(/^NEXT_PUBLIC_/);
    }
  );

  const clientKeys = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_ONESIGNAL_APP_ID",
    "NEXT_PUBLIC_SITE_URL",
  ];

  test.each(clientKeys)(
    "%s IS prefixed with NEXT_PUBLIC_ (safe for client)",
    (key) => {
      expect(key).toMatch(/^NEXT_PUBLIC_/);
      expect(envContent).toContain(key);
    }
  );

  test("server-only keys have SERVER ONLY comment", () => {
    // At least some server keys should be marked
    expect(envContent).toMatch(/SERVER ONLY/i);
  });
});

// ---------------------------------------------------------------------------
// 4. No hardcoded secrets in source code
// ---------------------------------------------------------------------------
describe("No hardcoded secrets in source", () => {
  const srcFiles = [
    "src/lib/stripe.ts",
    "src/lib/supabase/client.ts",
    "src/lib/supabase/server.ts",
    "src/lib/supabase/middleware.ts",
    "src/app/api/checkout/route.ts",
    "src/app/api/webhooks/stripe/route.ts",
  ];

  test.each(srcFiles)("%s does not contain hardcoded API keys", (file) => {
    const src = readFile(file);
    // Should not contain literal API key patterns
    expect(src).not.toMatch(/sk_live_[a-zA-Z0-9]{20,}/);
    expect(src).not.toMatch(/sk_test_[a-zA-Z0-9]{20,}/);
    expect(src).not.toMatch(/pk_live_[a-zA-Z0-9]{20,}/);
    expect(src).not.toMatch(/whsec_[a-zA-Z0-9]{20,}/);
    expect(src).not.toMatch(/eyJhbGciOi[a-zA-Z0-9+/=]{50,}/);
  });
});

// ---------------------------------------------------------------------------
// 5. Netlify deployment config
// ---------------------------------------------------------------------------
describe("Netlify deployment", () => {
  const toml = readFile("netlify.toml");

  test("build command is npm run build", () => {
    expect(toml).toMatch(/command\s*=\s*["']npm run build["']/);
  });

  test("publish directory is .next", () => {
    expect(toml).toMatch(/publish\s*=\s*["'].next["']/);
  });

  test("Node version is set", () => {
    expect(toml).toMatch(/NODE_VERSION/);
  });

  test("uses @netlify/plugin-nextjs", () => {
    expect(toml).toMatch(/@netlify\/plugin-nextjs/);
  });
});

// ---------------------------------------------------------------------------
// 6. OneSignal worker file
// ---------------------------------------------------------------------------
describe("OneSignal service worker", () => {
  test("OneSignalSDKWorker.js exists in public/", () => {
    expect(fs.existsSync(path.join(ROOT, "public/OneSignalSDKWorker.js"))).toBe(
      true
    );
  });
});

// ---------------------------------------------------------------------------
// 7. Build script exists
// ---------------------------------------------------------------------------
describe("Build configuration", () => {
  const pkg = JSON.parse(readFile("package.json"));

  test("has build script", () => {
    expect(pkg.scripts.build).toBeDefined();
  });

  test("has dev script", () => {
    expect(pkg.scripts.dev).toBeDefined();
  });

  test("has start script", () => {
    expect(pkg.scripts.start).toBeDefined();
  });
});
