# Section 01: next-seo Setup

## Objective
Install next-seo and configure DefaultSeo in layout.tsx with site-wide OG tags, Twitter cards, site name, and default image.

## Implementation

### 1. Install next-seo
npm install next-seo

### 2. Create SEO config
Create `src/lib/seo-config.ts`:
- Export DEFAULT_SEO object with:
  - titleTemplate: '%s | EarlyInsider'
  - defaultTitle: 'EarlyInsider — Insider Trading Intelligence'
  - description: 'Real-time SEC insider trading alerts with AI-powered analysis. Track what executives are buying and selling.'
  - canonical: 'https://earlyinsider.com'
  - openGraph: type 'website', locale 'en_US', site_name 'EarlyInsider', images [{url, width:1200, height:630, alt}]
  - twitter: handle '@earlyinsider', cardType 'summary_large_image'

### 3. Add DefaultSeo to layout.tsx
Import DefaultSeo and config, render in layout body (client wrapper needed since next-seo uses Head).

## Tests
- Test: seo-config exports DEFAULT_SEO with all required fields
- Test: DEFAULT_SEO.openGraph.images has at least one image with url, width, height
- Test: DEFAULT_SEO.twitter.cardType is 'summary_large_image'
- Test: titleTemplate contains '%s'

## Acceptance Criteria
- [ ] next-seo installed
- [ ] DefaultSeo renders on all pages
- [ ] OG tags and Twitter cards in page source
