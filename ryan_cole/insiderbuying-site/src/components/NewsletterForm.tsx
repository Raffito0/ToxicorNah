"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface NewsletterFormProps {
  source: string;
}

export default function NewsletterForm({ source }: NewsletterFormProps) {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("newsletter_subscribers")
      .insert({ email, source });
    // Duplicate email (unique constraint) — treat as success
    if (error && error.code !== "23505") {
      setLoading(false);
      return;
    }
    setSubmitted(true);
    setLoading(false);
  }

  if (submitted) {
    return (
      <p className="text-[12px] font-normal leading-[20px] text-[#9ba2ff]">
        Subscribed! Check <strong className="text-white">{email}</strong> for updates.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-[12px] pt-[12px]">
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email address"
        className="w-full h-[44px] px-[12px] bg-white text-[14px] font-normal text-[#1a1a1a] placeholder:text-[#a0a8b1]"
      />
      <button
        type="submit"
        disabled={loading}
        className="w-full h-[40px] bg-white flex items-center justify-center text-[12px] font-medium leading-[16px] text-[#000592] disabled:opacity-50"
      >
        {loading ? "..." : "SUBSCRIBE"}
      </button>
    </form>
  );
}
