import type { VercelRequest, VercelResponse } from '@vercel/node';

const SUPABASE_URL = 'https://iilqnbumccqxlyloerzd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlpbHFuYnVtY2NxeGx5bG9lcnpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg3MjMwMjgsImV4cCI6MjA4NDI5OTAyOH0.N8eGP4U2bGIJdW9MvyaQ5xGKLa4cVuJTwDfbXn8eGsg';

const CRAWLER_REGEX = /facebookexternalhit|Facebot|Twitterbot|LinkedInBot|WhatsApp|Slackbot|TelegramBot|Googlebot|bingbot|Discordbot|iMessageBot|Applebot/i;

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return res.status(404).send('Not found');
  }

  const ua = req.headers['user-agent'] || '';
  const isCrawler = CRAWLER_REGEX.test(ua);

  if (!isCrawler) {
    // For real users, serve the SPA index.html
    // Vercel will handle this via the fallback rewrite
    return res.redirect(302, `/?share=${id}`);
  }

  // For crawlers, fetch data from Supabase and return OG-tagged HTML
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/shared_analyses?id=eq.${id}&select=soul_type_title,soul_type_tagline,og_image_url,overall_score`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
      }
    );

    const rows = await response.json();
    if (!rows || rows.length === 0) {
      return res.status(404).send('Not found');
    }

    const data = rows[0];
    const title = escapeHtml(`${data.soul_type_title} — Toxic or Nah?`);
    const description = escapeHtml(data.soul_type_tagline);
    const image = data.og_image_url || '';
    const pageUrl = `https://toxicor-nah.vercel.app/share/${id}`;

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <title>${title}</title>
  <meta property="og:title" content="${title}"/>
  <meta property="og:description" content="${description}"/>
  <meta property="og:image" content="${image}"/>
  <meta property="og:url" content="${pageUrl}"/>
  <meta property="og:type" content="website"/>
  <meta property="og:site_name" content="Toxic or Nah?"/>
  <meta name="twitter:card" content="summary_large_image"/>
  <meta name="twitter:title" content="${title}"/>
  <meta name="twitter:description" content="${description}"/>
  <meta name="twitter:image" content="${image}"/>
  <meta name="theme-color" content="#111111"/>
</head>
<body style="background:#111111">
  <script>window.location.href="${pageUrl}";</script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).send(html);
  } catch (err) {
    console.error('Edge Function error:', err);
    return res.status(500).send('Internal error');
  }
}
