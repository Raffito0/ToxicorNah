import { NextRequest, NextResponse } from "next/server";

const NOCODB_API_URL = process.env.NOCODB_API_URL || "";
const NOCODB_READONLY_TOKEN = process.env.NOCODB_READONLY_TOKEN || "";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const cleanSlug = slug.replace(/[^a-zA-Z0-9\-_]/g, "").slice(0, 200);

  if (!cleanSlug) {
    return NextResponse.json({ error: "Invalid slug" }, { status: 400 });
  }

  const where = `(slug,eq,${cleanSlug})~and(status,eq,published)`;
  const url = `${NOCODB_API_URL}/Articles?where=${encodeURIComponent(where)}&limit=1`;

  const res = await fetch(url, {
    headers: { "xc-auth": NOCODB_READONLY_TOKEN },
    next: { revalidate: 600 },
  });

  if (!res.ok) {
    return NextResponse.json({ error: "Failed to fetch article" }, { status: 502 });
  }

  const data = await res.json();
  const article = data?.list?.[0];

  if (!article) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  return NextResponse.json(article);
}
