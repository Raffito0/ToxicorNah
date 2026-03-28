/**
 * JSON-LD structured data builders for SEO.
 * Each function returns a plain object suitable for <script type="application/ld+json">.
 */

export interface ArticleJsonLdInput {
  headline: string;
  description?: string;
  datePublished: string;
  dateModified?: string;
  authorName?: string;
  images?: string[];
  url: string;
}

export function buildArticleJsonLd(article: ArticleJsonLdInput) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.headline,
    description: article.description || '',
    datePublished: article.datePublished,
    dateModified: article.dateModified || article.datePublished,
    author: {
      '@type': 'Person',
      name: article.authorName || 'Ryan Cole',
    },
    publisher: {
      '@type': 'Organization',
      name: 'EarlyInsider',
      url: 'https://earlyinsider.com',
    },
    images: article.images || [],
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': article.url,
    },
  };
}

export interface WebPageJsonLdInput {
  name: string;
  description: string;
  url: string;
}

export function buildWebPageJsonLd(page: WebPageJsonLdInput) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: page.name,
    description: page.description,
    url: page.url,
    publisher: {
      '@type': 'Organization',
      name: 'EarlyInsider',
      url: 'https://earlyinsider.com',
    },
  };
}

export interface ProductJsonLdInput {
  name: string;
  description: string;
  price: string;
  currency?: string;
  url: string;
}

export function buildProductJsonLd(product: ProductJsonLdInput) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description,
    url: product.url,
    offers: {
      '@type': 'Offer',
      price: product.price,
      priceCurrency: product.currency || 'USD',
      availability: 'https://schema.org/InStock',
    },
  };
}

export interface FAQItem {
  question: string;
  answer: string;
}

export function buildFAQJsonLd(faqs: FAQItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    })),
  };
}
