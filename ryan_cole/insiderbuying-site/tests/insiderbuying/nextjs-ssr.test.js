/**
 * Section 04: Next.js SSR Conversion
 *
 * Validates SSR infrastructure:
 * - next.config.ts has no static export
 * - Supabase client/server/middleware helpers exist and are correct
 * - Root middleware wires updateSession
 * - All API routes exist with correct patterns
 * - OneSignal init component exists
 * - Netlify config is correct
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");

function readFile(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), "utf-8");
}

function fileExists(relPath) {
  return fs.existsSync(path.join(ROOT, relPath));
}

// ---------------------------------------------------------------------------
// 1. next.config.ts — no static export
// ---------------------------------------------------------------------------
describe("next.config.ts", () => {
  const src = readFile("next.config.ts");

  test("does NOT have output: export", () => {
    expect(src).not.toMatch(/output:\s*["']export["']/);
  });

  test("exports a config object", () => {
    expect(src).toMatch(/export\s+default\s+nextConfig/);
  });
});

// ---------------------------------------------------------------------------
// 2. Supabase client helpers
// ---------------------------------------------------------------------------
describe("src/lib/supabase/client.ts", () => {
  const src = readFile("src/lib/supabase/client.ts");

  test("uses createBrowserClient from @supabase/ssr", () => {
    expect(src).toMatch(/createBrowserClient/);
    expect(src).toMatch(/@supabase\/ssr/);
  });

  test("reads NEXT_PUBLIC_SUPABASE_URL env var", () => {
    expect(src).toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  test("exports createClient function", () => {
    expect(src).toMatch(/export\s+(async\s+)?function\s+createClient/);
  });
});

describe("src/lib/supabase/server.ts", () => {
  const src = readFile("src/lib/supabase/server.ts");

  test("uses createServerClient from @supabase/ssr", () => {
    expect(src).toMatch(/createServerClient/);
    expect(src).toMatch(/@supabase\/ssr/);
  });

  test("uses cookies from next/headers", () => {
    expect(src).toMatch(/from\s+["']next\/headers["']/);
    expect(src).toMatch(/cookies/);
  });

  test("has try/catch for setAll (Server Components read-only)", () => {
    expect(src).toMatch(/catch/);
  });

  test("implements getAll and setAll cookie methods", () => {
    expect(src).toMatch(/getAll/);
    expect(src).toMatch(/setAll/);
  });
});

describe("src/lib/supabase/middleware.ts", () => {
  const src = readFile("src/lib/supabase/middleware.ts");

  test("exports updateSession function", () => {
    expect(src).toMatch(/export\s+async\s+function\s+updateSession/);
  });

  test("refreshes session with getUser()", () => {
    expect(src).toMatch(/auth\.getUser/);
  });

  test("protects routes that require auth", () => {
    expect(src).toMatch(/PROTECTED_PATHS/);
  });

  test("redirects unauthenticated users to /login", () => {
    expect(src).toMatch(/\/login/);
    expect(src).toMatch(/redirect/);
  });

  test("protects /checkout path", () => {
    expect(src).toMatch(/\/checkout/);
  });

  test("sets cookies on both request and response", () => {
    expect(src).toMatch(/request\.cookies\.set/);
    expect(src).toMatch(/supabaseResponse\.cookies\.set/);
  });
});

// ---------------------------------------------------------------------------
// 3. Root middleware
// ---------------------------------------------------------------------------
describe("middleware.ts (root)", () => {
  const src = readFile("middleware.ts");

  test("imports updateSession from supabase middleware", () => {
    expect(src).toMatch(/updateSession/);
    expect(src).toMatch(/supabase\/middleware/);
  });

  test("exports middleware function", () => {
    expect(src).toMatch(/export\s+async\s+function\s+middleware/);
  });

  test("has route matcher config", () => {
    expect(src).toMatch(/matcher/);
  });

  test("excludes static files from middleware", () => {
    expect(src).toMatch(/_next/);
    expect(src).toMatch(/favicon\.ico/);
  });
});

// ---------------------------------------------------------------------------
// 4. API routes
// ---------------------------------------------------------------------------
describe("API routes exist", () => {
  test("auth callback route", () => {
    expect(fileExists("src/app/api/auth/callback/route.ts")).toBe(true);
  });

  test("stripe webhook route", () => {
    expect(fileExists("src/app/api/webhooks/stripe/route.ts")).toBe(true);
  });

  test("checkout route", () => {
    expect(fileExists("src/app/api/checkout/route.ts")).toBe(true);
  });

  test("alerts subscribe route", () => {
    expect(fileExists("src/app/api/alerts/subscribe/route.ts")).toBe(true);
  });
});

describe("src/app/api/auth/callback/route.ts", () => {
  const src = readFile("src/app/api/auth/callback/route.ts");

  test("handles GET requests", () => {
    expect(src).toMatch(/export\s+async\s+function\s+GET/);
  });

  test("extracts code from URL params", () => {
    expect(src).toMatch(/code/);
    expect(src).toMatch(/searchParams/);
  });

  test("exchanges code for session", () => {
    expect(src).toMatch(/exchangeCodeForSession/);
  });

  test("redirects to /alerts on success", () => {
    expect(src).toMatch(/\/alerts/);
  });

  test("redirects to /login on error", () => {
    expect(src).toMatch(/\/login.*error/);
  });
});

describe("src/app/api/alerts/subscribe/route.ts", () => {
  const src = readFile("src/app/api/alerts/subscribe/route.ts");

  test("handles GET requests (read preferences)", () => {
    expect(src).toMatch(/export\s+async\s+function\s+GET/);
  });

  test("handles PUT requests (update preferences)", () => {
    expect(src).toMatch(/export\s+async\s+function\s+PUT/);
  });

  test("requires authentication", () => {
    expect(src).toMatch(/auth\.getUser/);
    expect(src).toMatch(/Unauthorized/);
  });

  test("uses allowlist for update fields", () => {
    expect(src).toMatch(/email_enabled/);
    expect(src).toMatch(/push_enabled/);
    expect(src).toMatch(/min_significance_score/);
  });
});

// ---------------------------------------------------------------------------
// 5. OneSignal
// ---------------------------------------------------------------------------
describe("OneSignal setup", () => {
  test("OneSignalSDKWorker.js exists in public/", () => {
    expect(fileExists("public/OneSignalSDKWorker.js")).toBe(true);
  });

  const src = readFile("src/components/OneSignalInit.tsx");

  test("is a client component", () => {
    expect(src).toMatch(/["']use client["']/);
  });

  test("uses useRef to prevent double init", () => {
    expect(src).toMatch(/useRef/);
    expect(src).toMatch(/initialized/);
  });

  test("reads NEXT_PUBLIC_ONESIGNAL_APP_ID", () => {
    expect(src).toMatch(/NEXT_PUBLIC_ONESIGNAL_APP_ID/);
  });

  test("calls OneSignal.init()", () => {
    expect(src).toMatch(/\.init\(/);
  });

  test("links Supabase user to OneSignal via login()", () => {
    expect(src).toMatch(/\.login\(/);
  });
});

// ---------------------------------------------------------------------------
// 6. Netlify config
// ---------------------------------------------------------------------------
describe("netlify.toml", () => {
  const src = readFile("netlify.toml");

  test("build command is npm run build", () => {
    expect(src).toMatch(/command\s*=\s*["']npm run build["']/);
  });

  test("publish directory is .next", () => {
    expect(src).toMatch(/publish\s*=\s*["'].next["']/);
  });

  test("includes @netlify/plugin-nextjs", () => {
    expect(src).toMatch(/@netlify\/plugin-nextjs/);
  });
});

// ---------------------------------------------------------------------------
// 7. Dependencies in package.json
// ---------------------------------------------------------------------------
describe("package.json dependencies", () => {
  const pkg = JSON.parse(readFile("package.json"));
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

  test("@supabase/supabase-js installed", () => {
    expect(allDeps["@supabase/supabase-js"]).toBeDefined();
  });

  test("@supabase/ssr installed", () => {
    expect(allDeps["@supabase/ssr"]).toBeDefined();
  });

  test("stripe installed", () => {
    expect(allDeps["stripe"]).toBeDefined();
  });

  test("react-onesignal installed", () => {
    expect(allDeps["react-onesignal"]).toBeDefined();
  });

  test("@netlify/plugin-nextjs installed", () => {
    expect(allDeps["@netlify/plugin-nextjs"]).toBeDefined();
  });
});
