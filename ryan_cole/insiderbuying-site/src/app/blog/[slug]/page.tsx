import Link from "next/link";
import { notFound } from "next/navigation";
import CopyLinkButton from "@/components/blog/CopyLinkButton";

const NOCODB_API_URL = process.env.NOCODB_API_URL!;
const NOCODB_READONLY_TOKEN = process.env.NOCODB_READONLY_TOKEN!;

const VERDICT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  BUY: { bg: "#dcfce7", text: "#166534", border: "#22c55e" },
  SELL: { bg: "#fee2e2", text: "#991b1b", border: "#ef4444" },
  CAUTION: { bg: "#fef3c7", text: "#92400e", border: "#f59e0b" },
  WAIT: { bg: "#dbeafe", text: "#1e40af", border: "#3b82f6" },
  NO_TRADE: { bg: "#f3f4f6", text: "#374151", border: "#6b7280" },
};

interface Article {
  id: number;
  title_text: string;
  slug: string;
  body_html: string;
  hero_image_url?: string;
  og_image_url?: string;
  verdict_type: string;
  verdict_text: string;
  ticker: string;
  meta_description: string;
  published_at: string;
  word_count: number;
  key_takeaways?: string;
  related_articles?: string;
  author_name?: string;
  company_name?: string;
  sector?: string;
}

interface RelatedArticle {
  id: number;
  slug: string;
  title: string;
  verdict_type: string;
  meta_description: string;
}

async function fetchArticle(slug: string): Promise<Article | null> {
  const cleanSlug = slug.replace(/[^a-zA-Z0-9\-_]/g, "").slice(0, 200);
  const where = `(slug,eq,${cleanSlug})~and(status,eq,published)`;
  const url = `${NOCODB_API_URL}/Articles?where=${encodeURIComponent(where)}&limit=1`;

  const res = await fetch(url, {
    headers: { "xc-auth": NOCODB_READONLY_TOKEN },
    next: { revalidate: 600 },
  });

  if (!res.ok) return null;
  const data = await res.json();
  return data?.list?.[0] || null;
}

function parseKeyTakeaways(kt?: string): string[] {
  if (!kt) return [];
  try {
    const parsed = JSON.parse(kt);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseRelatedArticles(ra?: string): RelatedArticle[] {
  if (!ra || ra === "null") return [];
  try {
    const parsed = JSON.parse(ra);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function extractH2Headings(html: string): string[] {
  if (!html) return [];
  const matches = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/gi) || [];
  return matches.map((m) => m.replace(/<[^>]+>/g, "").trim());
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = await fetchArticle(slug);
  if (!article) return { title: "Article Not Found" };

  return {
    title: article.title_text,
    description: article.meta_description,
    openGraph: {
      title: article.title_text,
      description: article.meta_description,
      type: "article",
      publishedTime: article.published_at,
      images: article.og_image_url ? [{ url: article.og_image_url, width: 1200, height: 630 }] : [],
      url: `https://earlyinsider.com/blog/${article.slug}`,
    },
  };
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = await fetchArticle(slug);

  if (!article) notFound();

  const takeaways = parseKeyTakeaways(article.key_takeaways);
  const related = parseRelatedArticles(article.related_articles);
  const headings = extractH2Headings(article.body_html);
  const readingTime = Math.max(1, Math.ceil((article.word_count || 0) / 200));
  const vc = VERDICT_COLORS[article.verdict_type] || VERDICT_COLORS.NO_TRADE;

  const formattedDate = article.published_at
    ? new Date(article.published_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : "";

  return (
    <div className="bg-[#fcf9f8] pt-[48px] md:pt-[128px] pb-[1px]">
      {/* JSON-LD */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Article",
            headline: article.title_text,
            description: article.meta_description,
            datePublished: article.published_at,
            author: { "@type": "Person", name: article.author_name || "EarlyInsider" },
            publisher: {
              "@type": "Organization",
              name: "EarlyInsider",
              logo: { "@type": "ImageObject", url: "https://earlyinsider.com/logo.png" },
            },
            image: article.hero_image_url ? [article.hero_image_url] : [],
          }),
        }}
      />

      <div className="max-w-[1152px] mx-auto flex gap-[48px] lg:gap-[80px] px-[16px] md:px-[32px]">
        {/* ARTICLE */}
        <article className="flex-1 min-w-0">

          {/* HEADER */}
          <div className="mb-[24px]">
            <div className="flex items-center gap-[8px] mb-[16px]">
              <span
                className="px-[12px] py-[4px] text-[12px] font-bold rounded"
                style={{ backgroundColor: vc.bg, color: vc.text }}
              >
                {article.verdict_type}
              </span>
              <span className="text-[12px] font-medium text-[#5c6670] font-mono">{article.ticker}</span>
              {article.sector && <span className="text-[12px] text-[#5c6670]">{article.sector}</span>}
            </div>

            <h1 className="font-[var(--font-montaga)] text-[28px] md:text-[38px] font-normal leading-[1.2] md:leading-[42px] text-[#1a1a1a] mb-[12px]">
              {article.title_text}
            </h1>
            <p className="text-[16px] md:text-[18px] font-normal leading-[26px] text-[#5c6670] mb-[24px]">
              {article.meta_description}
            </p>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between py-[20px] border-y border-[#c6c5d9] gap-[12px]">
              <div className="flex items-center gap-[12px]">
                <div className="w-[40px] h-[40px] rounded-full bg-[#f0eded]" />
                <div>
                  <p className="text-[14px] font-semibold text-[#1a1a1a]">{article.author_name || "EarlyInsider"}</p>
                  <p className="text-[12px] text-[#5c6670]">{article.company_name && `Covering ${article.company_name}`}</p>
                </div>
              </div>
              <div className="flex items-center gap-[16px] ml-[52px] sm:ml-0">
                <span className="text-[13px] text-[#454556]">{formattedDate}</span>
                <span className="text-[13px] text-[#454556]">{readingTime} min read</span>
              </div>
            </div>
          </div>

          {/* HERO IMAGE */}
          {article.hero_image_url && (
            <figure className="mb-[24px]">
              <img src={article.hero_image_url} alt={article.title_text} className="w-full rounded-[4px]" />
            </figure>
          )}

          {/* KEY TAKEAWAYS */}
          {takeaways.length > 0 && (
            <div className="bg-[#f8fafc] border border-[#e2e8f0] rounded-[8px] p-[24px] mb-[32px]">
              <h2 className="text-[18px] font-bold text-[#1a1a1a] mb-[16px]">Key Takeaways</h2>
              <ul className="flex flex-col gap-[12px]">
                {takeaways.map((t, i) => (
                  <li key={i} className="flex items-start gap-[12px]">
                    <svg className="w-[20px] h-[20px] shrink-0 mt-[2px]" viewBox="0 0 20 20" fill={vc.border}><circle cx="10" cy="10" r="10"/><path d="M6 10l3 3 5-5" stroke="white" strokeWidth="2" fill="none"/></svg>
                    <span className="text-[15px] leading-[24px] text-[#1c1b1b]">{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ARTICLE BODY */}
          <div
            className="prose prose-lg max-w-none mb-[48px] [&_h2]:font-[var(--font-montaga)] [&_h2]:text-[26px] [&_h2]:md:text-[32px] [&_h2]:font-normal [&_h2]:leading-[1.2] [&_h2]:text-[#1a1a1a] [&_h2]:mt-[36px] [&_h2]:mb-[20px] [&_p]:text-[16px] [&_p]:md:text-[17px] [&_p]:leading-[28px] [&_p]:text-[#1c1b1b] [&_p]:mb-[24px] [&_table]:w-full [&_th]:bg-[#f1f5f9] [&_th]:p-[12px] [&_th]:text-left [&_th]:text-[13px] [&_th]:font-bold [&_td]:p-[12px] [&_td]:text-[14px] [&_td]:border-b [&_td]:border-[#e2e8f0] [&_blockquote]:bg-[#f1f1f1] [&_blockquote]:border-l-[3px] [&_blockquote]:border-[#000592] [&_blockquote]:p-[24px] [&_blockquote]:italic [&_a]:text-[#000592] [&_a]:underline"
            dangerouslySetInnerHTML={{ __html: article.body_html }}
          />

          {/* VERDICT */}
          <div className="border-t-[3px] pt-[24px] mb-[48px]" style={{ borderColor: vc.border }}>
            <div className="flex items-center gap-[12px] mb-[16px]">
              <span className="text-[20px] font-bold" style={{ color: vc.text }}>Our Verdict:</span>
              <span className="text-[20px] font-bold px-[12px] py-[4px] rounded" style={{ backgroundColor: vc.bg, color: vc.text }}>
                {article.verdict_type}
              </span>
            </div>
            <p className="text-[17px] leading-[28px] text-[#1c1b1b]">{article.verdict_text}</p>
          </div>

          {/* SHARE */}
          <div className="flex items-center justify-between py-[20px] border-y border-[#c6c5d9] mb-[32px]">
            <span className="font-[var(--font-montaga)] text-[18px] text-[#454556]">Share this Insight</span>
            <div className="flex gap-[12px]">
              <a
                href={`https://twitter.com/intent/tweet?url=${encodeURIComponent(`https://earlyinsider.com/blog/${article.slug}`)}&text=${encodeURIComponent(article.title_text)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-[40px] h-[40px] border border-[#c6c5d9] flex items-center justify-center hover:bg-[#f6f3f2] text-[14px]"
              >
                X
              </a>
              <a
                href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(`https://earlyinsider.com/blog/${article.slug}`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-[40px] h-[40px] border border-[#c6c5d9] flex items-center justify-center hover:bg-[#f6f3f2] text-[14px]"
              >
                in
              </a>
              <CopyLinkButton slug={article.slug} />
            </div>
          </div>

          {/* RELATED ARTICLES */}
          {related.length > 0 && (
            <div className="pt-[24px] pb-[40px]">
              <h4 className="font-[var(--font-montaga)] text-[26px] md:text-[32px] font-normal leading-[1.2] text-[#1c1b1b] mb-[24px] md:mb-[32px]">Related Articles</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[20px] md:gap-[24px]">
                {related.slice(0, 4).map((r) => {
                  const rvc = VERDICT_COLORS[r.verdict_type] || VERDICT_COLORS.NO_TRADE;
                  return (
                    <Link key={r.id} href={`/blog/${r.slug}`} className="group">
                      <div className="flex items-center gap-[6px] mb-[8px]">
                        <span className="text-[11px] font-bold px-[6px] py-[1px] rounded" style={{ backgroundColor: rvc.bg, color: rvc.text }}>
                          {r.verdict_type}
                        </span>
                      </div>
                      <p className="text-[16px] font-medium leading-[22px] text-[#1a1a1a] group-hover:text-[#000592] transition-colors mb-[6px]">
                        {r.title}
                      </p>
                      <p className="text-[13px] leading-[18px] text-[#5c6670] line-clamp-2">{r.meta_description}</p>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {/* AUTHOR BIO */}
          <div className="bg-white flex flex-col sm:flex-row gap-[20px] md:gap-[32px] p-[24px] md:p-[32px] mb-[48px]">
            <div className="w-[64px] h-[64px] md:w-[80px] md:h-[80px] rounded-full bg-[#f0eded] border-[2px] border-white shadow shrink-0" />
            <div className="flex flex-col gap-[6px]">
              <p className="font-[var(--font-montaga)] text-[20px] md:text-[22px] font-normal leading-[28px] text-[#1c1b1b]">
                {article.author_name || "EarlyInsider"}
              </p>
              <p className="text-[14px] font-normal leading-[23px] text-[#454556]">
                {article.author_name === "Dexter Research"
                  ? "AI-assisted financial research powered by real-time market data, SEC filings, and proprietary analysis algorithms."
                  : "Independent equity analyst covering public markets with a focus on insider transactions, valuation, and dividend sustainability."}
              </p>
            </div>
          </div>
        </article>

        {/* SIDEBAR */}
        <aside className="w-[280px] shrink-0 hidden lg:flex flex-col gap-[40px]">
          {/* Table of Contents */}
          {headings.length > 0 && (
            <div className="bg-white p-[32px] sticky top-[100px]">
              <p className="font-[var(--font-montaga)] text-[20px] font-normal text-[#454556] pb-[16px] border-b border-[#c6c5d9] mb-[23px]">Contents</p>
              <nav className="flex flex-col gap-[15px]">
                {headings.map((h, i) => (
                  <span key={i} className="text-[13px] leading-[20px] text-[#454556] hover:text-[#000592] cursor-pointer">
                    {String(i + 1).padStart(2, "0")}. {h}
                  </span>
                ))}
              </nav>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
