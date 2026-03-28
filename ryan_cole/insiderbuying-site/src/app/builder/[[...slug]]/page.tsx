"use client";

import { useEffect, useState } from "react";
import { Content, fetchOneEntry, isPreviewing } from "@builder.io/sdk-react";

const BUILDER_API_KEY = "9547722ddcb045788c11c833b33bff32";

export default function BuilderPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const [content, setContent] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [resolvedSlug, setResolvedSlug] = useState<string[]>([]);

  useEffect(() => {
    params.then((p) => {
      const slug = p.slug || [];
      setResolvedSlug(slug);
      const urlPath = "/builder/" + slug.join("/");

      fetchOneEntry({
        model: "page",
        apiKey: BUILDER_API_KEY,
        userAttributes: { urlPath },
      }).then((result) => {
        setContent(result);
        setLoading(false);
      });
    });
  }, [params]);

  if (loading) return null;

  if (!content && !isPreviewing()) {
    return <div className="p-20 text-center text-lg">Page not found</div>;
  }

  return (
    <Content
      content={content}
      model="page"
      apiKey={BUILDER_API_KEY}
    />
  );
}
