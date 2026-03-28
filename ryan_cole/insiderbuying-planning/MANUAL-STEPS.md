# InsiderBuying.ai — Manual Steps Checklist

All steps that require manual action (dashboard access, account creation, DNS, API keys, etc.)
Organized by category. Check off as you complete them.

## Account Creation & Signups

- [ ] Create Supabase project "insiderbuying-ai" (Unit 01, Section 02)
- [ ] Create Stripe account + complete business verification (Unit 01, Section 03)
- [ ] Create Resend account at resend.com (Unit 01, Section 05)
- [ ] Create OneSignal app (Web Push, site URL: earlyinsider.com) (Unit 01, Section 04)
- [ ] Create Airtable base "InsiderBuying.ai" with Insider_Alerts + Monitor_State tables (Unit 04, Section 01)
- [ ] Create X (Twitter) account @insiderbuying or chosen handle (Unit 06, Section 02)
- [ ] Create Reddit account + warm with genuine engagement for 2 weeks before outreach (Unit 06, Section 04)
- [ ] Create Reddit app at reddit.com/prefs/apps for API access (Unit 06, Section 04)
- [ ] Create Beehiiv account for newsletter (Unit 06, Section 01)
- [ ] Sign up for Hunter.io free tier (25 searches/month) (Unit 07, Section 01)
- [ ] Sign up for Snov.io free tier (50 credits/month) (Unit 07, Section 01)
- [ ] Sign up for Apollo.io free tier (60 credits/month) (Unit 07, Section 01)
- [ ] Create Gmail account for outreach (ryan@earlyinsider.com), enable 2FA + App Password (Unit 07, Section 02)
- [ ] Sign up for Financial Datasets API at financialdatasets.ai (Unit 03, Section 02)
- [ ] Sign up for DataForSEO at dataforseo.com (Unit 03, Section 03)
- [ ] Sign up for twitterapi.io monitoring service (~$30/mo) (Unit 06, Section 03)

## API Keys & Tokens

### Supabase (Unit 01, Section 02)
- [ ] `NEXT_PUBLIC_SUPABASE_URL` — from Project Settings > API
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` — from Project Settings > API
- [ ] `SUPABASE_SERVICE_ROLE_KEY` — from Project Settings > API

### Stripe (Unit 01, Section 03)
- [ ] `STRIPE_SECRET_KEY` — from Stripe Dashboard > Developers > API keys
- [ ] `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — same location
- [ ] `STRIPE_WEBHOOK_SECRET` — from webhook endpoint config
- [ ] `STRIPE_PRICE_ID_PRO_MONTHLY` — after creating $24/mo product
- [ ] `STRIPE_PRICE_ID_PRO_ANNUAL` — after creating $228/yr product
- [ ] `STRIPE_COUPON_ID_SUBSCRIBER` — create coupon "SUBSCRIBER12" ($12 off, once)

### NocoDB (Unit 01, Section 01)
- [ ] `NOCODB_API_TOKEN` — create in NocoDB UI > Team & Auth > API Tokens (write access)
- [ ] `NOCODB_READ_TOKEN` — create Viewer-role token for Next.js read-only queries

### Email & Messaging
- [ ] `RESEND_API_KEY` — from Resend dashboard after domain verification (Unit 01, Section 05)
- [ ] `NEXT_PUBLIC_ONESIGNAL_APP_ID` — from OneSignal dashboard (Unit 01, Section 04)
- [ ] `ONESIGNAL_REST_API_KEY` — from OneSignal Settings > Keys & IDs (Unit 04, Section 09)
- [ ] `TELEGRAM_BOT_TOKEN` — from @BotFather (Unit 03, Section 08)
- [ ] `TELEGRAM_CHAT_ID` — from Telegram bot setup (Unit 03, Section 08)
- [ ] `BEEHIIV_API_KEY` — from Beehiiv Settings (Unit 06, Section 01)
- [ ] `BEEHIIV_PUBLICATION_ID` — from Beehiiv dashboard (Unit 06, Section 01)

### AI & Data APIs
- [ ] `ANTHROPIC_API_KEY` — from Anthropic Console (Unit 03, Section 04)
- [ ] `FINANCIAL_DATASETS_API_KEY` — from financialdatasets.ai (Unit 03, Section 02)
- [ ] `DATAFORSEO_LOGIN` + `DATAFORSEO_PASSWORD` — from DataForSEO (Unit 03, Section 03)
- [ ] `KIE_API_KEY` — kie.ai Nano Banana Pro for image generation (Unit 03, Section 05)

### Cloudflare R2 (Unit 03, Section 05)
- [ ] `R2_ACCOUNT_ID` — from Cloudflare dashboard
- [ ] `R2_ACCESS_KEY_ID` — from R2 API tokens
- [ ] `R2_SECRET_ACCESS_KEY` — from R2 API tokens
- [ ] `R2_PUBLIC_URL` — public bucket URL

### Social Media APIs
- [ ] `X_API_KEY` + `X_API_SECRET` — from X Developer Portal (Unit 06, Section 02)
- [ ] `X_ACCESS_TOKEN` + `X_ACCESS_SECRET` — from X Developer Portal (Unit 06, Section 02)
- [ ] `TWITTERAPI_IO_KEY` — from twitterapi.io subscription (Unit 06, Section 03)
- [ ] `REDDIT_CLIENT_ID` + `REDDIT_CLIENT_SECRET` — from reddit.com/prefs/apps (Unit 06, Section 04)

### Outreach & SEO
- [ ] `HUNTER_IO_KEY` — from Hunter.io dashboard (Unit 07, Section 01)
- [ ] `SNOV_IO_KEY` — from Snov.io dashboard (Unit 07, Section 01)
- [ ] `APOLLO_IO_KEY` — from Apollo.io dashboard (Unit 07, Section 01)
- [ ] `GMAIL_EMAIL` + `GMAIL_APP_PASSWORD` — Gmail + 2FA App Password (Unit 07, Section 02)
- [ ] `GOOGLE_SEARCH_CONSOLE_KEY` — service account for GSC API (Unit 07, Section 03)

### Google Services
- [ ] `GOOGLE_INDEXING_SERVICE_ACCOUNT` — base64 JSON key for Indexing API (Unit 04, spec)
- [ ] Verify earlyinsider.com in Google Search Console (Unit 07, Section 03)
- [ ] Add service account email as Owner in GSC (Unit 04, spec)

## DNS & Domain Configuration

- [ ] Point earlyinsider.com DNS to Netlify nameservers (Unit 01, Section 05)
- [ ] Add SPF TXT record for Resend: `v=spf1 include:_spf.resend.com ~all` (Unit 01, Section 05)
- [ ] Add DKIM CNAME records from Resend dashboard (Unit 01, Section 05)
- [ ] Add DMARC TXT record: `v=DMARC1; p=quarantine;` (Unit 01, Section 05)
- [ ] Wait 24-48 hours for DNS propagation and verify in Resend (Unit 01, Section 05)

## Dashboard Configuration

### Stripe (Unit 01, Section 03)
- [ ] Create Product "InsiderBuying Pro" with Monthly ($24/mo) and Annual ($228/yr) prices
- [ ] Create webhook endpoint: `https://earlyinsider.com/api/webhooks/stripe`
- [ ] Subscribe to events: checkout.session.completed, customer.subscription.*, invoice.paid, invoice.payment_failed
- [ ] Enable Customer Portal (Settings > Billing > Customer Portal)

### Supabase (Unit 01, Section 02)
- [ ] Enable Realtime on insider_alerts table: `ALTER PUBLICATION supabase_realtime ADD TABLE insider_alerts;`
- [ ] Configure Email/Password auth with email confirmation
- [ ] Configure Google OAuth with client ID + secret
- [ ] Set redirect URL: `https://earlyinsider.com/api/auth/callback`
- [ ] Set site URL: `https://earlyinsider.com`
- [ ] Apply schema migration for insider_alerts_v2 (Unit 04, Section 00)

### Airtable (Unit 04, Section 01)
- [ ] Create Insider_Alerts table with all fields per spec
- [ ] Create Monitor_State table with seed records (name='market', name='afterhours')

### OneSignal (Unit 01, Section 04)
- [ ] Download `OneSignalSDKWorker.js` and place in `public/` directory
- [ ] Configure Web Push settings

## Environment Variables

### Local Development (.env.local)
- [ ] Create `.env.local` from `.env.example` with all keys above (Unit 01, Section 05)
- [ ] Verify `.env.local` is in `.gitignore` (Unit 01, Section 05)

### Netlify Production
- [ ] Set all production environment variables in Netlify UI (Unit 01, Section 05)
- [ ] Use live Stripe keys (not test keys) for production

### n8n Workflow Environment
- [ ] Set all n8n environment variables (30+ keys) in n8n UI > Settings > Environment Variables (Units 03-07)

### VPS Docker
- [ ] Set NocoDB credentials in docker-compose.yml (Unit 01, Section 01)

## Deployment & Infrastructure

- [ ] SSH to VPS (72.62.61.93), deploy NocoDB + PostgreSQL via docker-compose (Unit 01, Section 01)
- [ ] Create all 12 NocoDB tables with correct field types (Unit 01, Section 01)
- [ ] Connect GitHub repo to Netlify (Unit 01, Section 05)
- [ ] Set Netlify build command: `npm run build`, publish dir: `.next`, Node 20 (Unit 01, Section 05)
- [ ] Trigger initial Netlify deploy (Unit 01, Section 05)
- [ ] Update Stripe webhook to live URL after deploy (Unit 01, Section 05)
- [ ] Ensure Puppeteer/screenshot server running on VPS at port 3456 (Unit 05, Section 02)

## n8n Workflow Imports

### Content Engine (Unit 03)
- [ ] Import Dexter Research Agent workflow (webhook trigger)
- [ ] Import W1 Keyword Selection workflow (Sunday midnight EST)
- [ ] Import W2 Article Generation workflow (8AM, 1PM, 6PM EST daily)
- [ ] Import W12 Image Generation workflow (webhook, called by W2)
- [ ] Import W13 Cross-Linking workflow (webhook, called by W2)

### SEC Alerts (Unit 04)
- [ ] Import W4-market SEC Monitor workflow (every 15 min, market hours only)
- [ ] Import W4-afterhours SEC Monitor workflow (every 60 min, always)
- [ ] Import W5 Alert Delivery sub-workflow (triggered by W4 for score >= 6)

### Data & Reports (Unit 05)
- [ ] Import W3 Data Studies workflow (1st and 15th of each month)
- [ ] Import W15 Premium Report PDF workflow (Stripe webhook trigger)
- [ ] Import W16 Lead Magnet PDF workflow (last day of each month)

### Newsletter & Social (Unit 06)
- [ ] Import W6 Weekly Newsletter workflow (Monday 7AM EST)
- [ ] Import W7 X Auto-Post workflow (triggered by W2 and W4)
- [ ] Import W8 X Engagement Monitor workflow (every 15 min)
- [ ] Import W9 Reddit Monitor workflow (every 2 hours)

### Outreach & SEO (Unit 07)
- [ ] Import W10 Prospect Finder workflow (weekly, Tuesday)
- [ ] Import W11 Outreach Email Sender workflow (daily Mon-Fri, 9AM EST)
- [ ] Import W14 SEO Monitoring workflow (daily, 6AM EST)

## Verification & Smoke Tests

### Infrastructure (Unit 01)
- [ ] Homepage loads at earlyinsider.com (200 response)
- [ ] API routes respond (not 404)
- [ ] Auth flow works: signup → login → protected pages → logout
- [ ] Stripe checkout creates subscription
- [ ] Resend email delivery works (send test email)
- [ ] OneSignal push notifications work

### Content Engine (Unit 03)
- [ ] Anthropic API key works (ping with minimal prompt)
- [ ] Financial Datasets API key works (test GET for AAPL)
- [ ] DataForSEO credentials work (test keyword volume POST)
- [ ] R2 upload works (test file)
- [ ] Full pipeline: insert keyword → Dexter → article → blog page

### SEC Alerts (Unit 04)
- [ ] SEC EDGAR API responds
- [ ] Test alert flows through scoring → analysis → delivery
- [ ] Alert appears on /alerts page in real-time
- [ ] AI analysis blurred for free users, visible for Pro

### Social & Outreach (Units 06-07)
- [ ] X API authentication works
- [ ] Reddit API authentication works
- [ ] Gmail SMTP sends test email
- [ ] Google Search Console API returns data
- [ ] Beehiiv newsletter send works

### Email Warmup (Unit 07)
- [ ] First 2 weeks: max 5 outreach emails/day
- [ ] Gradually increase to 10/day
- [ ] Monitor deliverability and bounce rates
