"use client";

import { useState } from "react";

export default function CopyLinkButton({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    if (typeof navigator !== "undefined") {
      navigator.clipboard.writeText(`https://earlyinsider.com/blog/${slug}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="w-[40px] h-[40px] border border-[#c6c5d9] flex items-center justify-center hover:bg-[#f6f3f2] text-[14px]"
    >
      {copied ? (
        <svg className="w-[14px] h-[14px] text-[#006d34]" viewBox="0 0 14 14" fill="none">
          <path d="M2 7l4 4L12 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      ) : (
        "Copy"
      )}
    </button>
  );
}
