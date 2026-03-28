import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

export async function POST(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get("secret");
  const slug = request.nextUrl.searchParams.get("slug");

  if (secret !== process.env.REVALIDATION_SECRET) {
    return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
  }

  if (!slug) {
    return NextResponse.json({ error: "Missing slug" }, { status: 400 });
  }

  const cleanSlug = slug.replace(/[^a-zA-Z0-9\-_]/g, "").slice(0, 200);

  revalidatePath(`/blog/${cleanSlug}`);
  revalidatePath("/blog");

  return NextResponse.json({ revalidated: true, slug: cleanSlug });
}
