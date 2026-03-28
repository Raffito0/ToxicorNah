const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Section 01: seo-config.ts
// ---------------------------------------------------------------------------
describe('seo-config', () => {
  const configPath = path.join(__dirname, '../../src/lib/seo-config.ts');
  let configContent;

  beforeAll(() => {
    configContent = fs.readFileSync(configPath, 'utf8');
  });

  test('exports buildPageMetadata function', () => {
    expect(configContent).toContain('export function buildPageMetadata');
  });

  test('exports SITE_URL constant', () => {
    expect(configContent).toContain("SITE_URL");
    expect(configContent).toContain('https://earlyinsider.com');
  });

  test('exports SITE_NAME constant', () => {
    expect(configContent).toContain('SITE_NAME');
    expect(configContent).toContain('EarlyInsider');
  });

  test('buildPageMetadata generates canonical URL from path', () => {
    expect(configContent).toContain('canonical');
    expect(configContent).toContain('SITE_URL');
  });

  test('openGraph config includes image with dimensions', () => {
    expect(configContent).toContain('width: 1200');
    expect(configContent).toContain('height: 630');
  });

  test('twitter card type is summary_large_image', () => {
    expect(configContent).toContain('summary_large_image');
  });
});

// ---------------------------------------------------------------------------
// Section 02: structured-data.ts
// ---------------------------------------------------------------------------
describe('structured-data', () => {
  const sdPath = path.join(__dirname, '../../src/lib/structured-data.ts');
  let sdContent;

  beforeAll(() => {
    sdContent = fs.readFileSync(sdPath, 'utf8');
  });

  test('exports buildArticleJsonLd', () => {
    expect(sdContent).toContain('export function buildArticleJsonLd');
  });

  test('buildArticleJsonLd includes @type Article', () => {
    expect(sdContent).toContain("'Article'");
  });

  test('exports buildWebPageJsonLd', () => {
    expect(sdContent).toContain('export function buildWebPageJsonLd');
  });

  test('buildWebPageJsonLd includes @type WebPage', () => {
    expect(sdContent).toContain("'WebPage'");
  });

  test('exports buildProductJsonLd', () => {
    expect(sdContent).toContain('export function buildProductJsonLd');
  });

  test('buildProductJsonLd includes offers with price', () => {
    expect(sdContent).toContain("'Offer'");
    expect(sdContent).toContain('price');
    expect(sdContent).toContain('priceCurrency');
  });

  test('exports buildFAQJsonLd', () => {
    expect(sdContent).toContain('export function buildFAQJsonLd');
  });

  test('buildFAQJsonLd includes @type FAQPage', () => {
    expect(sdContent).toContain("'FAQPage'");
  });

  test('buildFAQJsonLd maps questions to mainEntity', () => {
    expect(sdContent).toContain('mainEntity');
    expect(sdContent).toContain("'Question'");
    expect(sdContent).toContain('acceptedAnswer');
  });

  test('all builders include @context schema.org', () => {
    const matches = sdContent.match(/'https:\/\/schema\.org'/g);
    expect(matches.length).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// Section 03: next-sitemap config
// ---------------------------------------------------------------------------
describe('next-sitemap config', () => {
  const configPath = path.join(__dirname, '../../next-sitemap.config.js');

  test('config file exists', () => {
    expect(fs.existsSync(configPath)).toBe(true);
  });

  test('exports siteUrl as earlyinsider.com', () => {
    const config = require(configPath);
    expect(config.siteUrl).toBe('https://earlyinsider.com');
  });

  test('generateRobotsTxt is true', () => {
    const config = require(configPath);
    expect(config.generateRobotsTxt).toBe(true);
  });

  test('excludes /api/* routes', () => {
    const config = require(configPath);
    expect(config.exclude).toContain('/api/*');
  });

  test('package.json has postbuild script', () => {
    const pkgPath = path.join(__dirname, '../../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    expect(pkg.scripts.postbuild).toContain('next-sitemap');
  });
});

// ---------------------------------------------------------------------------
// Section 04: Per-page metadata
// ---------------------------------------------------------------------------
describe('per-page metadata', () => {
  const pagesDir = path.join(__dirname, '../../src/app');

  test('layout.tsx has metadata export', () => {
    const content = fs.readFileSync(path.join(pagesDir, 'layout.tsx'), 'utf8');
    expect(content).toContain('export const metadata');
  });

  test('layout.tsx has openGraph config', () => {
    const content = fs.readFileSync(path.join(pagesDir, 'layout.tsx'), 'utf8');
    expect(content).toContain('openGraph');
  });

  test('layout.tsx has twitter card config', () => {
    const content = fs.readFileSync(path.join(pagesDir, 'layout.tsx'), 'utf8');
    expect(content).toContain('twitter');
    expect(content).toContain('summary_large_image');
  });

  const pagesWithMetadata = ['about', 'methodology', 'reports', 'contact', 'how-it-works'];
  pagesWithMetadata.forEach((page) => {
    test(`/${page} exports metadata`, () => {
      const content = fs.readFileSync(path.join(pagesDir, page, 'page.tsx'), 'utf8');
      expect(content).toContain('metadata');
    });
  });
});

// ---------------------------------------------------------------------------
// Section 05: FAQ JSON-LD
// ---------------------------------------------------------------------------
describe('FAQ JSON-LD', () => {
  const faqPath = path.join(__dirname, '../../src/app/faq/page.tsx');

  test('faq page exists', () => {
    expect(fs.existsSync(faqPath)).toBe(true);
  });

  test('faq page has FAQ data', () => {
    const content = fs.readFileSync(faqPath, 'utf8');
    expect(content).toContain('FAQ_GROUPS');
  });

  test('faq page has at least 5 questions', () => {
    const content = fs.readFileSync(faqPath, 'utf8');
    const qMatches = content.match(/\bq:/g) || [];
    expect(qMatches.length).toBeGreaterThanOrEqual(5);
  });
});
