# Section 04: Per-Page SEO Meta Tags

## Objective
Ensure all pages export proper Next.js metadata (title, description, openGraph, twitter) using the App Router metadata API.

## Implementation

### 1. Audit existing metadata
Check each page for exported metadata object. Most pages already have them from the initial build.

### 2. Create shared metadata helpers
In `src/lib/seo-config.ts`, add:
- buildPageMetadata(title, description, path) — returns Metadata object with title, description, openGraph, twitter, canonical
- Use consistent patterns across all pages

### 3. Ensure all pages have metadata
For each page that's missing metadata exports, add them:
- /signup: title "Sign Up", description about creating account
- /login: title "Log In", description about accessing account
- /alerts: title "Live Insider Alerts", description about real-time SEC filings
- /reports: title "Reports", description about data studies and premium reports
- /blog: title "Blog", description about insider trading analysis articles
- /pricing: title "Pricing", description about Free vs Pro plans
- /about: title "About", description about company mission
- /faq: title "FAQ", description about common questions
- /methodology: title "Methodology", description about scoring system
- /free-report: title "Free Report", description about monthly lead magnet

## Tests
- Test: buildPageMetadata returns object with title, description, openGraph
- Test: buildPageMetadata generates correct canonical URL
- Test: All page.tsx files export metadata (check file contents)

## Acceptance Criteria
- [ ] Every page has title, description, OG tags
- [ ] Canonical URLs are correct for all pages
- [ ] No duplicate or missing meta descriptions
