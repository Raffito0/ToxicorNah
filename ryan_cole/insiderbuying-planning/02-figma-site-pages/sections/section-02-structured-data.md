# Section 02: Structured Data (JSON-LD)

## Objective
Add JSON-LD structured data to key pages: ArticleJsonLd on /blog/[slug], WebPageJsonLd on /about and /methodology, ProductJsonLd on /pricing.

## Implementation

### 1. ArticleJsonLd on /blog/[slug]
The page already has JSON-LD via a script tag. Verify it includes: headline, datePublished, dateModified, author, publisher, images, description.

### 2. WebPageJsonLd helper
Create `src/lib/structured-data.ts` with helper functions:
- buildArticleJsonLd(article) — returns Article schema object
- buildWebPageJsonLd(page) — returns WebPage schema object
- buildProductJsonLd(product) — returns Product schema object
- buildFAQJsonLd(faqs) — returns FAQPage schema object
Each returns a plain object that can be serialized into a <script type="application/ld+json"> tag.

### 3. Add to /about and /methodology
Add WebPage JSON-LD with name, description, url.

### 4. Add to /pricing
Add Product JSON-LD for Pro subscription with name, description, offers (price, currency, availability).

## Tests
- Test: buildArticleJsonLd returns object with @type 'Article' and required fields
- Test: buildWebPageJsonLd returns object with @type 'WebPage'
- Test: buildProductJsonLd returns object with @type 'Product' and offers
- Test: buildFAQJsonLd returns object with @type 'FAQPage' and mainEntity array
- Test: All builders handle missing optional fields gracefully

## Acceptance Criteria
- [ ] /blog/[slug] has valid ArticleJsonLd
- [ ] /about has WebPageJsonLd
- [ ] /methodology has WebPageJsonLd
- [ ] /pricing has ProductJsonLd
