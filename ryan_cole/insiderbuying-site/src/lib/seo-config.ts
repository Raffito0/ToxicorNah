import type { Metadata } from 'next';

const SITE_URL = 'https://earlyinsider.com';
const SITE_NAME = 'EarlyInsider';
const DEFAULT_DESCRIPTION =
  'Real-time SEC insider trading alerts with AI-powered analysis. Track what executives are buying and selling before everyone else.';
const DEFAULT_OG_IMAGE = `${SITE_URL}/og-default.png`;

/**
 * Build per-page metadata for Next.js App Router.
 * Generates title, description, openGraph, twitter, and canonical URL.
 */
export function buildPageMetadata(
  title: string,
  description: string,
  path: string
): Metadata {
  const canonical = `${SITE_URL}${path}`;
  return {
    title: `${title} | ${SITE_NAME}`,
    description,
    alternates: { canonical },
    openGraph: {
      title: `${title} | ${SITE_NAME}`,
      description,
      url: canonical,
      siteName: SITE_NAME,
      type: 'website',
      images: [
        {
          url: DEFAULT_OG_IMAGE,
          width: 1200,
          height: 630,
          alt: `${title} — ${SITE_NAME}`,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} | ${SITE_NAME}`,
      description,
    },
  };
}

export { SITE_URL, SITE_NAME, DEFAULT_DESCRIPTION, DEFAULT_OG_IMAGE };
