import { NextRequest, NextResponse } from "next/server";

const NOCODB_API_URL = process.env.NOCODB_API_URL || "";
const NOCODB_READONLY_TOKEN = process.env.NOCODB_READONLY_TOKEN || "";

const VALID_VERDICT_TYPES = ["BUY", "SELL", "CAUTION", "WAIT", "NO_TRADE"];
const VALID_BLOGS = ["insiderbuying", "deepstockanalysis", "dividenddeep"];
const PAGE_SIZE = 12;
const INJECTION_RE = /[~()]/;

const LIST_FIELDS = [
  "id", "title_text", "slug", "hero_image_url", "verdict_type", "ticker",
  "meta_description", "published_at", "word_count", "key_takeaways",
  "sector", "company_name", "author_name",
].join(",");

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  // Sanitize inputs
  const blog = VALID_BLOGS.includes(params.get("blog") || "") ? params.get("blog")! : "insiderbuying";
  const page = Math.max(1, parseInt(params.get("page") || "1") || 1);
  const offset = (page - 1) * PAGE_SIZE;

  let where = `(blog,eq,${blog})~and(status,eq,published)`;

  const verdictType = params.get("verdict_type");
  if (verdictType && VALID_VERDICT_TYPES.includes(verdictType)) {
    where += `~and(verdict_type,eq,${verdictType})`;
  }

  const sector = params.get("sector")?.replace(/[^A-Za-z0-9 &\-]/g, "").slice(0, 50);
  if (sector && !INJECTION_RE.test(sector)) {
    where += `~and(sector,eq,${sector})`;
  }

  const ticker = params.get("ticker")?.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 5);
  if (ticker && !INJECTION_RE.test(ticker)) {
    where += `~and(ticker,like,${ticker})`;
  }

  const url = `${NOCODB_API_URL}/Articles?where=${encodeURIComponent(where)}&sort=-published_at&limit=${PAGE_SIZE}&offset=${offset}&fields=${LIST_FIELDS}`;

  const res = await fetch(url, {
    headers: { "xc-auth": NOCODB_READONLY_TOKEN },
    next: { revalidate: 300 },
  });

  if (!res.ok) {
    return NextResponse.json({ error: "Failed to fetch articles" }, { status: 502 });
  }

  const data = await res.json();
  return NextResponse.json(data);
}
