# Section 03: next-sitemap Configuration

## Objective
Install next-sitemap, create configuration for automatic sitemap and robots.txt generation with proper priorities.

## Implementation

### 1. Install next-sitemap
npm install next-sitemap

### 2. Create next-sitemap.config.js
At project root:
- siteUrl: 'https://earlyinsider.com'
- generateRobotsTxt: true
- changefreq defaults: 'daily' for dynamic pages, 'weekly' for static
- priority: 1.0 homepage, 0.8 blog articles, 0.6 static pages
- exclude: ['/api/*', '/_next/*']
- robotsTxtOptions: additionalSitemaps (for future Google News sitemap)

### 3. Update package.json
Add postbuild script: "postbuild": "next-sitemap"

### 4. Remove existing sitemap.ts
The manual src/app/sitemap.ts can be removed since next-sitemap auto-generates.
Or keep both — next-sitemap generates at build time, sitemap.ts is runtime. Decision: keep next-sitemap only (build-time is better for static routes).

## Tests
- Test: next-sitemap.config.js exports siteUrl as 'https://earlyinsider.com'
- Test: config has generateRobotsTxt: true
- Test: package.json has postbuild script containing 'next-sitemap'
- Test: config excludes /api/* routes

## Acceptance Criteria
- [ ] next-sitemap installed
- [ ] Config file at project root
- [ ] postbuild script generates sitemap.xml and robots.txt
- [ ] Old sitemap.ts removed or disabled
