import { defineStackbitConfig, SiteMapEntry } from "@stackbit/types";
import { GitContentSource } from "@stackbit/cms-git";

export default defineStackbitConfig({
  stackbitVersion: "~0.6.0",
  ssgName: "nextjs",
  nodeVersion: "20",
  devCommand: "node_modules/.bin/next dev -- --port {PORT} --hostname 127.0.0.1",

  contentSources: [
    new GitContentSource({
      rootPath: __dirname,
      contentDirs: ["content"],
      models: [
        /* ── PAGE MODELS ── */
        {
          name: "HomePage",
          type: "page",
          label: "Home Page",
          filePath: "content/pages/home.json",
          urlPath: "/",
          fields: [
            { name: "heroHeadline", type: "string", label: "Hero Headline", required: true },
            { name: "heroSubheadline", type: "string", label: "Hero Subheadline", required: true },
            { name: "heroTrustLine", type: "string", label: "Hero Trust Line" },
            { name: "heroPrimaryCta", type: "string", label: "Primary CTA Text" },
            { name: "heroSecondaryCta", type: "string", label: "Secondary CTA Text" },
            { name: "alertFeedHeader", type: "string", label: "Alert Feed Header" },
            { name: "alertFeedSubline", type: "string", label: "Alert Feed Subline" },
            { name: "howItWorksHeader", type: "string", label: "How It Works Header" },
            {
              name: "howItWorksSteps",
              type: "list",
              label: "How It Works Steps",
              items: {
                type: "object",
                fields: [
                  { name: "title", type: "string", label: "Step Title" },
                  { name: "desc", type: "string", label: "Step Description" },
                ],
              },
            },
            { name: "statsHeader", type: "string", label: "Stats Section Header" },
            {
              name: "stats",
              type: "list",
              label: "Stats",
              items: {
                type: "object",
                fields: [
                  { name: "value", type: "string", label: "Value" },
                  { name: "label", type: "string", label: "Label" },
                  { name: "desc", type: "string", label: "Description" },
                  { name: "source", type: "string", label: "Source" },
                ],
              },
            },
            { name: "reportsHeader", type: "string", label: "Reports Section Header" },
            { name: "reportsSubheadline", type: "string", label: "Reports Subheadline" },
            { name: "pricingHeader", type: "string", label: "Pricing Header" },
            { name: "pricingSubheadline", type: "string", label: "Pricing Subheadline" },
            { name: "pricingLossFraming", type: "string", label: "Pricing Loss Framing Line" },
            { name: "ctaHeadline", type: "string", label: "Final CTA Headline" },
            { name: "ctaSubheadline", type: "string", label: "Final CTA Subheadline" },
            { name: "ctaButtonText", type: "string", label: "Final CTA Button" },
            {
              name: "styles",
              type: "style",
              styles: {
                self: {
                  padding: "x0:8:2",
                },
              },
            },
          ],
        },
        {
          name: "AboutPage",
          type: "page",
          label: "About Page",
          filePath: "content/pages/about.json",
          urlPath: "/about",
          fields: [
            { name: "title", type: "string", label: "Page Title" },
            { name: "subtitle", type: "string", label: "Subtitle" },
            { name: "solutionTitle", type: "string", label: "Solution Section Title" },
            { name: "solutionParagraphs", type: "list", label: "Solution Paragraphs", items: { type: "string" } },
            { name: "ctaHeadline", type: "string", label: "CTA Headline" },
            { name: "ctaButton", type: "string", label: "CTA Button Text" },
          ],
        },
        {
          name: "PricingPage",
          type: "page",
          label: "Pricing Page",
          filePath: "content/pages/pricing.json",
          urlPath: "/pricing",
          fields: [
            { name: "headline", type: "string", label: "Headline" },
            { name: "subheadline", type: "string", label: "Subheadline" },
            { name: "ctaHeadline", type: "string", label: "Bottom CTA Headline" },
            { name: "ctaBody", type: "string", label: "Bottom CTA Body" },
          ],
        },
        {
          name: "HowItWorksPage",
          type: "page",
          label: "How It Works Page",
          filePath: "content/pages/how-it-works.json",
          urlPath: "/how-it-works",
          fields: [
            { name: "headline", type: "string", label: "Hero Headline" },
            { name: "body", type: "string", label: "Hero Body" },
            { name: "ctaHeadline", type: "string", label: "CTA Headline" },
            { name: "ctaButton", type: "string", label: "CTA Button Text" },
          ],
        },
        {
          name: "FreeReportPage",
          type: "page",
          label: "Free Report Page",
          filePath: "content/pages/free-report.json",
          urlPath: "/free-report",
          fields: [
            { name: "reportName", type: "string", label: "Report Name" },
            { name: "headline", type: "string", label: "Headline" },
            { name: "subheadline", type: "string", label: "Subheadline" },
            { name: "ctaButton", type: "string", label: "CTA Button Text" },
            { name: "ctaSubtext", type: "string", label: "CTA Sub-text" },
            { name: "trustLine", type: "string", label: "Trust Line" },
          ],
        },
        {
          name: "BlogPage",
          type: "page",
          label: "Blog Page",
          filePath: "content/pages/blog.json",
          urlPath: "/blog",
          fields: [
            { name: "title", type: "string", label: "Page Title" },
            { name: "subheadline", type: "string", label: "Subheadline" },
            { name: "newsletterHeading", type: "string", label: "Newsletter Heading" },
            { name: "newsletterDesc", type: "string", label: "Newsletter Description" },
            { name: "newsletterButton", type: "string", label: "Newsletter CTA" },
          ],
        },
        {
          name: "MethodologyPage",
          type: "page",
          label: "Methodology Page",
          filePath: "content/pages/methodology.json",
          urlPath: "/methodology",
          fields: [
            { name: "headline", type: "string", label: "Headline" },
            { name: "intro", type: "string", label: "Intro Paragraph" },
          ],
        },

        /* ── COMPONENT MODELS ── */
        {
          name: "Section",
          type: "object",
          label: "Section",
          fields: [
            { name: "heading", type: "string", label: "Heading" },
            { name: "body", type: "string", label: "Body Text" },
            {
              name: "styles",
              type: "style",
              styles: {
                self: {
                  padding: "x0:12:1",
                  margin: "x0:12:1",
                },
                heading: {
                  fontSize: ["x-small", "small", "medium", "large", "x-large", "xx-large"],
                  fontWeight: ["400", "500", "600", "700"],
                  textAlign: ["left", "center", "right"],
                },
                body: {
                  fontSize: ["x-small", "small", "medium", "large"],
                  textAlign: ["left", "center", "right"],
                },
              },
            },
          ],
        },

        /* ── GLOBAL CONFIG ── */
        {
          name: "SiteConfig",
          type: "data",
          label: "Site Configuration",
          filePath: "content/data/config.json",
          fields: [
            { name: "tagline", type: "string", label: "Footer Tagline" },
            { name: "disclaimer", type: "string", label: "Footer Disclaimer" },
            { name: "copyright", type: "string", label: "Copyright Line" },
          ],
        },
        {
          name: "GlobalStyles",
          type: "data",
          label: "Global Styles",
          filePath: "content/data/styles.json",
          fields: [
            {
              name: "primaryColor",
              type: "color",
              label: "Primary Color (Navy)",
            },
            {
              name: "accentGreen",
              type: "color",
              label: "Accent Green (Buy Signal)",
            },
            {
              name: "accentRed",
              type: "color",
              label: "Accent Red (Sell Signal)",
            },
            {
              name: "bgColor",
              type: "color",
              label: "Background Color",
            },
            {
              name: "bgAlt",
              type: "color",
              label: "Alt Background Color",
            },
            {
              name: "textColor",
              type: "color",
              label: "Text Color",
            },
            {
              name: "textSecondary",
              type: "color",
              label: "Text Secondary Color",
            },
          ],
        },
      ],
    }),
  ],

  siteMap: ({ documents }): SiteMapEntry[] => {
    return documents
      .filter((doc) => doc.modelName && ["HomePage", "AboutPage", "PricingPage", "HowItWorksPage", "FreeReportPage", "BlogPage", "MethodologyPage"].includes(doc.modelName))
      .map((doc) => ({
        stableId: doc.id,
        urlPath: (doc.fields?.urlPath as unknown as string) || "/",
        document: doc,
      }));
  },
});
