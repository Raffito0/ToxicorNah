<!-- PROJECT_CONFIG
runtime: typescript-npm
test_command: npx jest
END_PROJECT_CONFIG -->

<!-- SECTION_MANIFEST
section-01-next-seo-setup
section-02-structured-data
section-03-next-sitemap
section-04-seo-meta-tags
section-05-faq-jsonld
END_MANIFEST -->

# Implementation Sections Index

## Context
All 11 pages are already fully built and functional. This unit focuses on the remaining SEO foundation work: installing next-seo and next-sitemap, adding structured data (JSON-LD), and ensuring all pages have proper meta tags.

## Dependency Graph

| Section | Depends On | Blocks | Parallelizable |
|---------|------------|--------|----------------|
| section-01-next-seo-setup | - | 02, 04 | Yes |
| section-02-structured-data | 01 | - | Yes |
| section-03-next-sitemap | - | - | Yes |
| section-04-seo-meta-tags | 01 | - | Yes |
| section-05-faq-jsonld | 01 | - | Yes |

## Execution Order

1. section-01-next-seo-setup, section-03-next-sitemap (parallel — independent)
2. section-02-structured-data, section-04-seo-meta-tags, section-05-faq-jsonld (parallel after 01)

## Section Summaries

### section-01-next-seo-setup
Install next-seo, configure DefaultSeo in layout.tsx with site-wide OG tags, Twitter cards, site name, default image.

### section-02-structured-data
Add ArticleJsonLd to /blog/[slug], WebPageJsonLd to /about and /methodology, ProductJsonLd to /pricing.

### section-03-next-sitemap
Install next-sitemap, create config file, add postbuild script, generate robots.txt and sitemap.xml with proper priorities.

### section-04-seo-meta-tags
Ensure all pages have proper per-page title, description, canonical URL, and OG tags via NextSeo component.

### section-05-faq-jsonld
Add FAQPageJsonLd structured data to /faq page with all FAQ items for Google rich results.
