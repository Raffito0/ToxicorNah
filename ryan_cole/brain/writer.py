"""Content generation brain — uses Gemini to write like Ryan Cole."""
import json
import logging
import urllib.request

from ..config import GEMINI_API_KEY, GEMINI_MODEL, WRITING_STYLE

log = logging.getLogger(__name__)

SYSTEM_PROMPT = f"""You are Ryan Cole, a freelance content strategist.

Tone: {WRITING_STYLE['tone']}

NEVER use these phrases: {', '.join(WRITING_STYLE['avoid'])}

Rules:
{chr(10).join(f'- {r}' for r in WRITING_STYLE['rules'])}

You write content that sounds like a real human with 3 years of experience.
You have opinions. You don't hedge. You don't use filler words.
"""


def generate(prompt: str, max_tokens: int = 4096, temperature: float = 0.7) -> str:
    """Call Gemini API to generate content."""
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"

    payload = {
        "contents": [
            {"role": "user", "parts": [{"text": SYSTEM_PROMPT + "\n\n" + prompt}]}
        ],
        "generationConfig": {
            "maxOutputTokens": max_tokens,
            "temperature": temperature,
        },
    }

    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json"},
    )

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode())
            text = data["candidates"][0]["content"]["parts"][0]["text"]
            log.info("Generated %d chars", len(text))
            return text.strip()
    except Exception as e:
        log.error("Gemini API error: %s", e)
        return ""


def write_blog_post(topic: str, keywords: list[str] = None, word_count: int = 1500) -> str:
    """Write an SEO blog post."""
    kw = f"\nTarget keywords: {', '.join(keywords)}" if keywords else ""
    return generate(
        f"Write a blog post about: {topic}\n"
        f"Word count: ~{word_count} words{kw}\n"
        f"Format: H2 headings, short paragraphs, actionable advice.\n"
        f"Make it feel like a real person wrote it, not a content mill.",
        max_tokens=max(4096, word_count * 2),
    )


def write_twitter_thread(topic: str, tweets: int = 7) -> str:
    """Write a Twitter/X thread."""
    return generate(
        f"Write a Twitter thread ({tweets} tweets) about: {topic}\n"
        f"Format: 1/ 2/ 3/ etc. Each tweet under 280 chars.\n"
        f"First tweet must hook. Last tweet = CTA or summary.\n"
        f"Make it punchy, opinionated, not generic.",
    )


def write_email_copy(email_type: str, product: str, audience: str) -> str:
    """Write email copy (welcome, sales, newsletter)."""
    return generate(
        f"Write a {email_type} email for: {product}\n"
        f"Target audience: {audience}\n"
        f"Format: Subject line + body. Short paragraphs. One clear CTA.\n"
        f"Conversational tone, not corporate.",
    )


def write_ad_copy(platform: str, product: str, audience: str) -> str:
    """Write ad copy (Facebook, Google, Instagram)."""
    return generate(
        f"Write {platform} ad copy for: {product}\n"
        f"Target audience: {audience}\n"
        f"Include: headline, primary text, description, CTA.\n"
        f"Multiple variations (3 options).",
    )


def write_proposal(job_title: str, job_description: str, budget: str = "") -> str:
    """Write a personalized freelance proposal."""
    budget_note = f"\nBudget: {budget}" if budget else ""
    return generate(
        f"Write a freelance proposal for this job:\n"
        f"Title: {job_title}\n"
        f"Description: {job_description}{budget_note}\n\n"
        f"Rules:\n"
        f"- Start with something specific about THEIR project (not 'Hi, I saw your post')\n"
        f"- Show you understood what they need in 1-2 sentences\n"
        f"- Brief relevant experience (don't list everything)\n"
        f"- Propose a concrete approach\n"
        f"- End with a question (shows engagement)\n"
        f"- Keep under 150 words\n"
        f"- NO 'I'd be happy to help' or generic openers",
        max_tokens=500,
        temperature=0.8,
    )


def write_forum_reply(thread_title: str, thread_content: str, forum: str = "BHW") -> str:
    """Write a genuine forum reply (BHW, Reddit)."""
    return generate(
        f"Write a reply to this {forum} thread:\n"
        f"Title: {thread_title}\n"
        f"Content: {thread_content[:1000]}\n\n"
        f"Rules:\n"
        f"- Answer the actual question with real value\n"
        f"- Share a specific tip or experience\n"
        f"- NO links, NO self-promotion\n"
        f"- Sound like a helpful community member, not a marketer\n"
        f"- Keep under 200 words\n"
        f"- If on Reddit, be slightly more casual than BHW",
        max_tokens=400,
        temperature=0.8,
    )


def write_newsletter(topic: str, news_items: list[str] = None) -> str:
    """Write a daily newsletter."""
    news = "\n".join(f"- {n}" for n in news_items) if news_items else "Find trending topics"
    return generate(
        f"Write a newsletter about: {topic}\n"
        f"Today's news/topics:\n{news}\n\n"
        f"Format:\n"
        f"- Catchy subject line\n"
        f"- Quick intro (2-3 sentences, opinionated)\n"
        f"- 3-4 sections with takes on each topic\n"
        f"- Each section: what happened + why it matters + your hot take\n"
        f"- Closing with one actionable insight\n"
        f"- Total ~500-800 words\n"
        f"- Tone: smart friend who reads everything so you don't have to",
        max_tokens=2000,
    )


def write_linkedin_post(topic: str) -> str:
    """Write a LinkedIn insight post."""
    return generate(
        f"Write a LinkedIn post about: {topic}\n"
        f"Format:\n"
        f"- Hook first line (makes people click 'see more')\n"
        f"- Short paragraphs (1-2 sentences each)\n"
        f"- Personal angle or contrarian take\n"
        f"- End with a question to drive comments\n"
        f"- Under 300 words\n"
        f"- NO hashtag spam (max 3 relevant ones at the end)",
        max_tokens=600,
    )
