# InsiderBuying.ai — Questions & Decisions Made Autonomously

Review these tomorrow morning. If you disagree with any decision, we can fix it.

## Unit 02 — Overall: Pages Already Built

### Question 1
**What I would have asked:** All 11 pages in Unit 02 spec are already fully implemented (signup, login, alerts, reports, blog, blog/[slug], pricing, about, faq, methodology, free-report). Should I rebuild them or focus on the remaining gaps?
**What I decided:** Skip rebuilding pages. Focused Unit 02 on SEO foundation work that's NOT done yet: next-seo setup, structured data JSON-LD, next-sitemap, per-page meta tags, FAQ rich results.
**Why:** The pages are production-ready with auth, payments, real-time feeds, content rendering all working. Rebuilding would waste time and risk regressions.
**Risk if wrong:** If you wanted pixel-perfect Figma matching or design changes, those aren't covered. The SEO work is additive.
**How to fix:** If specific design changes are needed, create targeted tasks per page.

### Question 2
**What I would have asked:** next-seo vs Next.js built-in metadata API — which to use?
**What I decided:** Use both. next-seo for the DefaultSeo global config (easier DX), and verify that all pages also export proper metadata objects for the App Router. The structured data helpers (JSON-LD) are standalone utility functions.
**Why:** The pages already use Next.js metadata exports in some places. next-seo adds value for OpenGraph and Twitter card defaults. Both can coexist.
**Risk if wrong:** Slight redundancy in meta tags. No functional issue.
**How to fix:** Remove next-seo and use only built-in metadata API if preferred.

### Question 3
**What I would have asked:** Should I remove the existing manual sitemap.ts when adding next-sitemap?
**What I decided:** Keep both for now. next-sitemap generates at build time (better for static routes), sitemap.ts works at runtime. Note it in implementation to decide later.
**Why:** Removing sitemap.ts could break current behavior if the build pipeline isn't set up for next-sitemap yet.
**Risk if wrong:** Duplicate sitemaps could confuse search engines.
**How to fix:** Remove sitemap.ts after confirming next-sitemap generates correctly.

## Unit 05 — Section 02: PDF Rendering Approach

### Question 4
**What I would have asked:** Puppeteer directly in n8n vs screenshot server for PDF rendering?
**What I decided:** Use the existing screenshot server pattern (host.docker.internal:3456) since it's already deployed on the VPS. Add a /pdf endpoint if it doesn't exist.
**Why:** Installing Puppeteer in the n8n Docker container is complex and fragile. The screenshot server is already running and proven.
**Risk if wrong:** If the screenshot server doesn't support PDF generation, we'd need to add that endpoint.
**How to fix:** Install puppeteer as a sidecar container if screenshot server approach fails.

## Unit 06 — Section 04: Reddit Comment Quality

### Question 5
**What I would have asked:** Claude Haiku vs Sonnet for Reddit comments?
**What I decided:** Use Claude Sonnet for Reddit comments (as spec says) — quality matters on Reddit. Haiku for X tweets and newsletter summaries where speed > quality.
**Why:** Reddit users are hostile to low-quality marketing. Sonnet produces more nuanced, natural-sounding text. Cost difference is ~$0.20/day — negligible.
**Risk if wrong:** Higher API cost than necessary if Haiku would suffice.
**How to fix:** Switch to Haiku and A/B test quality.

## Unit 07 — Section 01: Email Discovery Tool Priority

### Question 6
**What I would have asked:** Which email discovery tool should be primary?
**What I decided:** Hunter.io first (most reliable for domain search), Snov.io second (good free tier), Apollo third (people search). All free tiers cascade.
**Why:** Hunter has the best domain-to-email accuracy. Snov has more free credits. Apollo is best for people search but less reliable for cold domains.
**Risk if wrong:** If Hunter's 25/month free tier runs out fast, the cascade handles it.
**How to fix:** Reorder the cascade or add a paid tier for the most effective tool.
