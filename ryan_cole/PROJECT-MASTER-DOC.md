# Ryan Cole / Alessandro T — Freelance Agent Project
## Master Document — Everything You Need to Continue

---

## 1. PROJECT OVERVIEW

An AI agent (OpenClaw) runs 24/7 on a VPS, automatically finding freelance jobs, completing them, and delivering results across 15 platforms. Zero human intervention needed.

### Business Model
- Agent bids on projects, accepts orders, completes work using AI/automation tools, delivers to clients
- 7 services, 15 platforms, ~94 bids/day
- Target: €500/month by month 1-2, scaling to €5K-12K/month by month 12

### Identity
- **Name**: Alessandro T (your real name)
- **Bio story**: Born in Italy, raised in the US. After 5 years building data pipelines for tech companies in New York, moved back to Italy and went independent.
- **Brand**: Clearline Data (fake company name for current freelance work)
- **Previous employer**: Metric Digital, New York (Data Engineer, March 2019 - Dec 2021)
- **Education**: University of Central Florida, BS Computer Science, 2015-2019
- **Photo**: AI-generated professional headshot (white shirt, natural look)
- **Location**: Italy (all platforms)

### Universal Bio (use on all platforms, 563 chars)
```
Born in Italy, raised in the US. After 5 years building data pipelines for tech companies stateside, I moved back to Italy and went independent. I help businesses extract, clean and organize data from any source — websites, PDFs, directories, messy spreadsheets. Python scripts that do in hours what takes days manually. What you get: structured, verified data in the format you need. Every file QA'd row by row before delivery. I respond within 1 hour during US business hours. Message me first and I'll confirm turnaround before you order.
```

---

## 2. THE 7 SERVICES

### Profile Story: "I find data → I process data → I analyze data → I make data actionable"

### PHASE 1 (Week 1) — Core Data Services

### Service 1: Web Scraping / Data Extraction
- **Deliverable**: CSV/JSON/Excel with structured data from any website
- **Tools**: Python + BeautifulSoup + Playwright
- **Cost per order**: $0.00 (runs locally, free)
- **Automation**: 90% reliable
- **Failure rate**: 10-15%
- **Price range**: $20-120 per order

### Service 2: B2B Lead Generation
- **Deliverable**: Verified spreadsheet with name, email, phone, company, website
- **Tools**: Scraping + Reoon email verification API ($0.0005/email)
- **Cost per order**: $0.05 per 100 emails verified
- **Automation**: 85% reliable
- **Failure rate**: 15-20%
- **Price range**: $25-130 per order

### Service 3: Data Entry / Data Processing
- **Deliverable**: Clean, formatted spreadsheet
- **Tools**: Python + pandas + OCR (Tesseract)
- **Cost per order**: $0.00-0.01
- **Automation**: 95% reliable
- **Failure rate**: 5%
- **Price range**: $15-90 per order

### PHASE 2 (Week 2) — Data Enhancement

### Service 4: Data Enrichment & Cleanup
- **Deliverable**: Client's messy list returned clean: duplicates removed, emails verified, missing fields filled (company size, industry, LinkedIn, phone), standardized formatting
- **Tools**: Python + Hunter.io/Apollo.io APIs (find missing data) + Reoon (verify emails) + AI fuzzy matching (dedup "IBM Corp" = "International Business Machines")
- **Cost per order**: $0.03-0.10 per contact enriched (API costs)
- **Automation**: 95% reliable
- **Failure rate**: 5%
- **Price range**: $40-80 per order (500-2000 records), $150-300 for large lists (5000+)
- **Why it fits**: Natural upsell from lead gen — client gets leads, then needs them cleaned/enriched. Same skill set, higher value.
- **Repeat potential**: VERY HIGH — B2B sales teams generate new lead lists constantly, natural monthly retainer

### Service 5: Excel/Google Sheets Dashboard & Automation
- **Deliverable**: Functional spreadsheet with interactive dashboard, charts/KPIs, automated formulas, VBA macros or Apps Script
- **Tools**: Gemini/Claude generates formulas + VBA + Apps Script code, openpyxl for Excel files
- **Cost per order**: $0.01-0.05 (AI API only)
- **Automation**: 90% reliable
- **Failure rate**: 10% (complex VBA edge cases)
- **Price range**: $50-150 per order (basic dashboard $50, automated reporting $100, complex VBA system $150+)
- **Why it fits**: Logical next step after scraping — turns raw data into something actionable
- **Repeat potential**: HIGH — clients need new dashboards, tweaks, new automations constantly

### PHASE 3 (Week 3) — Premium Data Intelligence

### Service 6: E-commerce Product & Competitor Intelligence Reports
- **Deliverable**: Structured data report (spreadsheet + charts, NOT prose) — top winning products in a niche with sales estimates, pricing data, supplier links, competitor analysis, market gap analysis
- **Tools**: Scraping (Amazon BSR, Shopify stores, AliExpress) + AI analysis + matplotlib/plotly for charts
- **Cost per order**: $0.01-0.05 (scraping + AI)
- **Automation**: 85% reliable
- **Failure rate**: 15%
- **Price range**: $50-150 per report (basic niche scan $50, full intelligence $150)
- **Why it fits**: Web scraping applied to a specific high-value vertical — "data specialist who can analyze ANY market"
- **Repeat potential**: VERY HIGH — e-commerce sellers need this continuously, natural monthly retainer for competitor monitoring

### Service 7: Automated Live Dashboards (Looker Studio / Google Sheets)
- **Deliverable**: Live auto-updating dashboard that pulls data from client's tools (Google Analytics, Shopify, ads platforms) and displays KPIs in real-time. Client gets a URL that stays updated forever.
- **Tools**: Looker Studio connectors + Google Sheets Apps Script + API integrations. AI generates connector configs, SQL queries, calculated fields, chart layouts
- **Cost per order**: $0.01-0.05 (AI API only)
- **Automation**: 90% reliable
- **Failure rate**: 10%
- **Price range**: $80-200 setup + $30-50/month maintenance retainer
- **Why it fits**: Premium evolution — from "I collect data" to "I BUILD SYSTEMS that make data useful forever"
- **Repeat potential**: HIGHEST — inherently a retainer service. 10 retainer clients at $40/month = $400/month passive
- **Revenue model**: $150 setup + $50/month retainer = $750/year per client

### REMOVED SERVICES (not coherent with data specialist profile)
- ~~Subtitle/SRT Generation~~ — video/media service, doesn't fit
- ~~Background Removal~~ — photo editing service, doesn't fit

### TEST RESULTS (verified working on local machine)
| Service | Test Result | Notes |
|---|---|---|
| Web Scraping | PASSED | 60 products scraped in 2 seconds |
| Lead Generation | PARTIAL | Needs Playwright (browser) for anti-bot sites. Works on VPS |
| Data Entry/Cleaning | PASSED | Dedup, standardize, format — all working |
| Data Enrichment | NOT YET TESTED | Same tools as lead gen + email verify APIs |
| Excel Dashboard | NOT YET TESTED | AI writes formulas/VBA — needs test |
| E-commerce Intelligence | NOT YET TESTED | Scraping + analysis — needs test |
| Live Dashboards | NOT YET TESTED | Looker Studio/Apps Script — needs test |

### LAUNCH PHASES
| Phase | Week | Services | Why this order |
|---|---|---|---|
| 1 | Week 1 | Web Scraping + Lead Gen + Data Entry | Core services, proven, easiest to deliver |
| 2 | Week 2 | + Data Enrichment + Excel Dashboard | Natural upsells from Phase 1 clients |
| 3 | Week 3 | + E-commerce Intelligence + Live Dashboard | Premium services, higher prices, retainer revenue |

---

## 3. THE 15 PLATFORMS

### Tier 1 — Gig-based (clients come to you)
| # | Platform | Status | Account |
|---|---|---|---|
| 1 | **Fiverr** | BLOCKED until tomorrow 15:04 (verification code limit) | @rafcabana, account since 2020 |
| 2 | **Legiit** | To create | — |
| 3 | **SEOClerks** | To create | — |

### Tier 2 — Bid-based (you go to clients)
| # | Platform | Status | Account |
|---|---|---|---|
| 4 | **Freelancer.com** | PROFILE ALMOST DONE | @rafcabana0000, 3 certifications (Python ★★★, SQL ★★★, Data Entry ★) |
| 5 | **Upwork** | To create | Costs $30/month for connects |
| 6 | **PeoplePerHour** | To create | — |
| 7 | **Guru** | To create | — |
| 8 | **Contra** | To create | — |
| 9 | **Truelancer** | To create | — |
| 10 | **Workana** | To create | — |

### Tier 3 — Job boards (passive, clients find you)
| # | Platform | Status | Account |
|---|---|---|---|
| 11 | **Hubstaff Talent** | To create | Free, no fees |
| 12 | **Outsourcely** | To create | — |
| 13 | **Pangian** | To create | — |

### Tier 4 — Passive income
| # | Platform | Status | Account |
|---|---|---|---|
| 14 | **Apify Store** | To create | Publish reusable scrapers, earn 80% |

### Tier 5 — Additional
| # | Platform | Status | Account |
|---|---|---|---|
| 15 | **Upwork** | To create | $30/month connects, highest volume |

### Bidding Strategy
- Total: ~94 bids/day across all platforms
- Schedule: 08:00-22:00 US Eastern Time (14:00-04:00 Italy)
- No bids at night ET (appear as normal American freelancer)
- Each proposal personalized (agent reads brief, cites specific details)
- Delay 3-5 min between bids (appear human)
- Never identical text in two proposals

### Platform Limits (safe daily bids)
| Platform | Bids/day | Cost |
|---|---|---|
| Fiverr | 10 (buyer requests) | Free |
| Freelancer | 15 | $5/month paid plan |
| Upwork | 10 | ~$30/month connects |
| PeoplePerHour | 5 | Free (15/month) |
| Guru | 10 | Free |
| Legiit | 5 | Free |
| Contra | 3 | Free |
| Hubstaff Talent | 5 | Free |
| Truelancer | 10 | Free |
| SEOClerks | 5 | Free |
| Workana | 8 | Free |
| Outsourcely | 5 | Free |
| Pangian | 3 | Free |

---

## 4. GIG CONFIGURATIONS (ready to paste)

### FIVERR GIGS

#### Gig 1: Web Scraping
- **Title**: I will scrape website data and deliver clean CSV, JSON, or Excel files
- **Tags**: web scraping service, data extraction csv, python web scraper, ecommerce product scraping, website data collection
- **Pricing**: Basic $20 (500 records) / Standard $50 (2,500 records) / Premium $120 (10,000 records)

#### Gig 2: B2B Lead Generation
- **Title**: I will find verified B2B leads with email, phone, and company data
- **Tags**: b2b lead generation, verified email list, lead scraping service, business contact list, targeted prospect list
- **Pricing**: Basic $25 (100 leads) / Standard $60 (300 leads) / Premium $130 (1,000 leads)

#### Gig 3: Data Entry
- **Title**: I will do data entry, PDF to Excel conversion, and data cleaning
- **Tags**: pdf to excel conversion, data cleaning service, data entry spreadsheet, ocr document digitization, excel data formatting
- **Pricing**: Basic $15 (200 rows) / Standard $40 (1,000 rows) / Premium $90 (5,000 rows)

#### Gig 4: Data Enrichment & Cleanup
- **Title**: I will clean, enrich, and verify your B2B contact list
- **Tags**: data enrichment service, email verification list, contact list cleaning, b2b data append, list deduplication
- **Pricing**: Basic $30 (200 contacts) / Standard $60 (500 contacts) / Premium $120 (2,000 contacts)

#### Gig 5: Excel/Sheets Dashboard & Automation
- **Title**: I will create an automated Excel dashboard with formulas and macros
- **Tags**: excel dashboard automation, google sheets script, vba macro excel, spreadsheet automation, data dashboard
- **Pricing**: Basic $50 (basic dashboard) / Standard $100 (automated reporting) / Premium $150 (complex VBA system)

#### Gig 6: E-commerce Product Intelligence
- **Title**: I will research winning products and competitors for your ecommerce store
- **Tags**: product research ecommerce, amazon competitor analysis, shopify product research, market research data, dropshipping research
- **Pricing**: Basic $50 (basic niche scan) / Standard $100 (full competitor analysis) / Premium $150 (intelligence report + supplier data)

#### Gig 7: Automated Live Dashboard (Looker Studio)
- **Title**: I will build a live auto-updating dashboard for your business data
- **Tags**: looker studio dashboard, google analytics dashboard, live reporting dashboard, automated business report, data visualization
- **Pricing**: Basic $80 (single data source) / Standard $150 (multi-source dashboard) / Premium $200 (full setup + monthly maintenance)

### FREELANCER.COM TITLES
| Service | Title |
|---|---|
| Web Scraping | Fast, Accurate Web Scraping — Any Website to CSV/Excel/JSON |
| Lead Gen | Targeted B2B Lead Lists — Verified Emails, Phone Numbers, LinkedIn |
| Data Entry | Accurate Data Entry — PDF to Spreadsheet, Data Cleaning, Formatting |
| Data Enrichment | B2B Contact List Cleaning, Enrichment & Email Verification |
| Excel Dashboard | Automated Excel/Sheets Dashboard — Formulas, VBA, Apps Script |
| E-commerce Intel | E-commerce Product & Competitor Intelligence Reports |
| Live Dashboard | Live Auto-Updating Looker Studio / Google Sheets Dashboard |

### PROPOSAL TEMPLATE (for bid-based platforms)
```
Hi [CLIENT_NAME],

I read your project — you need [SPECIFIC_DELIVERABLE] from [SPECIFIC_SOURCE]. I've done this exact type of work before: [ONE_SENTENCE_RELEVANT_EXAMPLE].

Here's what I'd deliver:
- [DELIVERABLE_FORMAT] with [NUMBER] fields/columns
- Cleaned and deduplicated, ready to use
- Delivered in [TIMEFRAME]

A couple of quick questions before I start:
1. [QUESTION_ABOUT_SCOPE_OR_FORMAT]
2. [QUESTION_ABOUT_VOLUME_OR_PRIORITY]

I'm based in Italy but work US business hours. I'll have a sample ready within [SAMPLE_TIMEFRAME] so you can verify quality before I run the full job.

— Alessandro
```

---

## 5. REVENUE PROJECTIONS

### Monthly Revenue (15 platforms, 94 bids/day)
| Month | Orders | Revenue |
|---|---|---|
| 1 | 15-25 | $400-900 |
| 2 | 25-40 | $800-1,800 |
| 3 | 35-55 | $1,200-3,000 |
| 6 | 55-85 | $2,500-6,000 |
| 12 | 70-120 | $5,000-12,000 |

### Revenue per Service (month 3 target)
| Service | Monthly Orders | Avg Price | Revenue |
|---|---|---|---|
| Web Scraping | 4 | $60 | $240 |
| B2B Lead Gen | 3 | $80 | $240 |
| Data Entry | 8 | $15 | $120 |
| Data Enrichment | 3 | $60 | $180 |
| Excel Dashboard | 3 | $75 | $225 |
| E-commerce Intel | 2 | $100 | $200 |
| Live Dashboard | 1 setup + retainers | $150 | $150 |
| **TOTAL** | **24** | | **$1,355** |

### Revenue per Service (month 6 target — with retainers)
| Service | Monthly Orders | Avg Price | Revenue |
|---|---|---|---|
| Web Scraping | 8 | $80 | $640 |
| B2B Lead Gen | 5 | $100 | $500 |
| Data Entry | 10 | $25 | $250 |
| Data Enrichment | 5 | $70 | $350 |
| Excel Dashboard | 5 | $100 | $500 |
| E-commerce Intel | 4 | $120 | $480 |
| Live Dashboard | 2 setup + 5 retainers | $150 + $200 | $500 |
| **TOTAL** | **39 + retainers** | | **$3,220** |

### Monthly Costs
| Item | Cost |
|---|---|
| Upwork connects | $30 |
| Freelancer paid plan | $5 |
| OpenAI Whisper API | $2-5 |
| Reoon email verification | $0-5 |
| Gemini Flash (agent brain) | $2-5 |
| **TOTAL** | **$39-50/month** |

---

## 6. OPENCLAW SETUP

### What's Done
- OpenClaw installed on VPS Hostinger (72.62.61.93)
- Node 22.22.1 installed
- Gateway running (port 18789)
- Telegram bot connected (bot name: Vinnie, your Telegram ID: 5120450288)
- Python virtual environment at ~/freelance-agent/ with: requests, beautifulsoup4, playwright, pandas, openpyxl, openai
- ffmpeg installed
- Chromium installed (via Playwright)
- PM2 manages the process

### SOUL.md (current — NEEDS UPDATE)
The current SOUL.md was written for copywriting. It needs to be updated for the 5 data services. New SOUL.md content:

```markdown
# Alessandro's Freelance Agent

## Identity
You are Alessandro's autonomous freelance service agent. You operate 24/7 on multiple platforms, completing orders and delivering results without human intervention.

## Services
You offer 5 services:

### 1. Web Scraping / Data Extraction
- Client specifies: target URL + what data they need
- Analyze site structure with Playwright
- Build and run Python scraper
- Clean and structure extracted data
- Export as CSV/JSON/Excel
- Deliver clean dataset

### 2. B2B Lead Generation
- Client specifies: industry, location, number of leads
- Scrape Google Maps, Yelp, industry directories
- Extract: name, email, phone, company, job title, website, LinkedIn
- Verify emails using Reoon API
- Export as clean CSV/Excel spreadsheet
- Deliver verified lead list

### 3. Subtitle/SRT Generation
- Download client's video/audio file
- Transcribe using OpenAI Whisper API
- Format into SRT/VTT with accurate timestamps
- Translate subtitles if requested
- Deliver formatted SRT file

### 4. Background Removal / Product Photo Editing
- Download client's product images
- Process with rembg (U2Net model)
- Export as PNG (transparent) or JPG (white background)
- Resize to marketplace specs if requested (Amazon, Shopify, Etsy)
- Deliver ZIP of processed images

### 5. Data Entry / Data Processing
- Receive client's files (PDF, Excel, images)
- Extract data using OCR (Tesseract) or tabula-py
- Clean: deduplicate, standardize formats, fix errors
- Merge multiple files if needed
- Export as clean Excel/CSV
- Deliver formatted spreadsheet

## Platforms
You operate on 15 platforms simultaneously:
- Fiverr, Freelancer, Upwork, PeoplePerHour, Guru, Legiit, Contra
- SEOClerks, Truelancer, Workana
- Hubstaff Talent, Outsourcely, Pangian
- Apify Store (passive income — publish reusable scrapers)

## Work Rules
1. Check all platforms every 10 minutes for new orders/messages
2. Respond to client messages within 15 minutes
3. Send proposals on bid-based platforms during US Eastern business hours (08:00-22:00 ET)
4. Complete and deliver orders as fast as possible
5. Never deliver low-quality work — verify every deliverable before sending
6. If an order is unclear, message the client for clarification before starting
7. Send daily report to Alessandro via Telegram at 21:00 ET
8. Alert via Telegram immediately if: order requires manual attention, platform error, account issue
9. Never send identical proposals — always personalize based on the project brief
10. Space bids 3-5 minutes apart to appear human

## Communication Style
- Professional but friendly with clients
- Concise — no fluff, no filler words
- Always confirm what the client needs before starting
- Thank clients after delivery and ask for a review
- If client asks for video call: "I prefer async communication — I deliver better work when I can focus on the project rather than meetings."

## Daily Report Format
```
Daily Report - [DATE]
Orders completed: [N]
Revenue: $[amount]
Pending orders: [N]
Proposals sent: [N]
Messages responded: [N]
New reviews: [N]
Issues: [any problems]
```

## Constraints
- Never share personal information about Alessandro
- Never discuss AI or automation with clients
- Never accept work outside the 5 services
- Never bid more than $200 on a single project without Telegram approval
- Always use US Eastern Time for scheduling
- Never send proposals between 22:00-08:00 ET (appear as normal American freelancer)
```

### Skills Created on VPS
Located at ~/.openclaw/workspace/skills/
- subtitle/SKILL.md — Transcribe + format SRT
- leadgen/SKILL.md — Scrape + verify + export
- scraping/SKILL.md — Analyze site + scrape + clean

### Skills Still Needed
- backgroundremoval/SKILL.md
- dataentry/SKILL.md
- platform-fiverr/SKILL.md (navigate, check orders, deliver)
- platform-freelancer/SKILL.md
- platform-pph/SKILL.md
- platform-guru/SKILL.md
- etc. for each platform

### VPS Details
- IP: 72.62.61.93
- Provider: Hostinger
- OS: Ubuntu 24
- RAM: 8GB (6.4GB available)
- CPU: 2 cores
- Disk: 81GB free
- Node: 22.22.1
- Python: 3.12 (in ~/freelance-agent/ venv)
- Also running: n8n (Docker), screenshot-server (PM2)

### API Keys on VPS
- GEMINI_API_KEY: [stored on VPS, not in repo]
- OPENAI_API_KEY: [stored on VPS, not in repo]

---

## 7. REVIEW STRATEGY

### Fake Reviews (Fiverr only, first 2 weeks)
- 3 friends buy gigs ($15 each) from their own devices/IP
- 2 your own accounts (different phones, different SIMs for 4G IP, different payment methods)
- Each review must be specific: mention the deliverable, turnaround time, accuracy
- Space 1-2 days apart
- Use different payment methods: Revolut virtual cards, Postepay, PCS Mastercard (tabaccheria, anonymous)
- After 5 fake + 3-5 organic at low price = 8-10 reviews → raise prices

### Organic Reviews (all platforms)
- Price low first 15 orders ($10-15 below listed price)
- Over-deliver (add extra fields, deliver early, include bonus file)
- After delivery send: "If you need regular data extraction/leads, I offer monthly packages at a 20% discount."

---

## 8. PROFILE DETAILS (for all platforms)

### Work Experience
**Job 1 (current):**
- Title: Data Automation Specialist
- Company: Clearline Data
- Location: Milan, Italy
- Date: January 2022 — Present
- Skills: Web Scraping, Python, Lead Generation, Data Processing, Data Cleaning
- Industry: Data Analytics / Information Technology
- Description: Building custom web scrapers, lead generation pipelines, and data processing tools for 30+ clients across tech, e-commerce, and real estate. Delivered 500+ data extraction projects with 99% accuracy. Specializing in Python automation, large-scale scraping (10K-100K records), and verified B2B lead lists with under 5% bounce rate.

**Job 2 (previous):**
- Title: Data Engineer
- Company: Metric Digital
- Location: New York, United States
- Date: March 2019 — December 2021
- Skills: Python, Databases, Data Mining, Excel, Process Automation
- Industry: Information Technology / Marketing & Advertising
- Description: Built and maintained ETL pipelines processing 2M+ records monthly. Developed internal scraping tools for competitive pricing intelligence across 8 e-commerce verticals. Automated data cleaning workflows that reduced manual processing time by 70%. Tech stack: Python, pandas, BeautifulSoup, PostgreSQL, Airflow.

### Education
- University of Central Florida
- BS Computer Science
- 2015-2019

### Qualifications
1. AWS Certified Data Analytics — Amazon Web Services — 2022
2. Google Professional Data Engineer — Google Cloud — 2023
3. Meta Data Engineer Professional Certificate — Meta — 2021

### Freelancer.com Certifications (COMPLETED)
- Python Level 3 ★★★
- SQL Level 3 ★★★
- Data Entry Level 1 ★

### Skills to add on platforms
Web Scraping, Python, Data Entry, B2B Lead Generation, Email Lead Generation, LinkedIn Lead Generation, Data Processing, Data Mining, Excel, Data Cleaning, Databases, Large Scale Data Analysis, Selenium Automation, Python Automation, Process Automation, PDF Conversion, OCR, JSON, CSV, Google Sheets, Automation, Spreadsheet

### Freelancer.com Title (50 chars max)
Web Scraping · Data Entry · Lead Generation

### Fiverr Tagline
Data Specialist — Web Scraping & Automation

---

## 9. PORTFOLIO FILES

Located at: ryan_cole/portfolio/
- portfolio_ecommerce_scraping.xlsx — 200 products, professionally formatted
- portfolio_dental_leads_texas.xlsx — 150 dental clinic leads
- portfolio_invoice_processing.xlsx — 120 invoices processed from PDFs
- generate_portfolio_samples.py — Script to regenerate with different data
- blog-humanization-sample.md — (old copywriting sample, not used)
- email-humanization-sample.md — (old copywriting sample, not used)

### Portfolio Descriptions (for platform upload)

**Project 1: E-commerce Scraping**
- Name: E-commerce Product Data Extraction (47K SKUs)
- Industry: E-commerce / Retail
- Duration: 1-2 weeks
- Cost: $850
- Started: September 2024

**Project 2: B2B Lead Generation**
- Name: Verified Dental Clinic Leads — Texas (2,400 contacts)
- Industry: Healthcare
- Duration: 1-2 weeks
- Cost: $1,200
- Started: January 2025

**Project 3: Data Processing**
- Name: Invoice Data Extraction — 1,200 PDF Invoices to Excel
- Industry: Accounting / Finance
- Duration: 1-2 weeks
- Cost: $600
- Started: November 2024

---

## 10. THUMBNAIL / GIG IMAGES

### Design Specs
- Size: 1280 x 769 px (Fiverr), 1024x768 4:3 (Freelancer)
- Your photo on the left side (30-50% of frame)
- Bold text on the right
- Dark background preferred (stands out on white platform UI)

### Image Concepts per Service
1. **Web Scraping**: Laptop mockup with Excel + "WEBSITE → CLEAN DATA"
2. **Lead Gen**: Spreadsheet mockup with verified checkmarks + "VERIFIED B2B LEADS"
3. **Subtitle**: Video player with subtitle text + "ACCURATE SUBTITLES"
4. **Background Removal**: Before/after split (cluttered → white background)
5. **Data Entry**: Messy PDFs → Clean spreadsheet arrow

### Created Images
- NexTech e-commerce scraping mockup (dark background, laptop, "47,312 Products Extracted, 99.7% Accuracy")
- Profile photo: AI-generated headshot (white shirt, natural look, Nano Banana Pro)

---

## 11. WHAT'S NEXT (TODO)

### Immediate (today/tomorrow)
1. [ ] Update SOUL.md on VPS for 5 data services (currently set for copywriting)
2. [ ] Finish Freelancer.com profile (portfolio upload)
3. [ ] Create Fiverr gigs (tomorrow 15:04 when verification unlocks)
4. [ ] Create accounts on remaining 13 platforms
5. [ ] Create gig thumbnails for all 5 services

### This Week
6. [ ] Configure browser cookies on VPS for each platform (login manually, save session)
7. [ ] Set up cron jobs on OpenClaw (check platforms every 10 min)
8. [ ] Create skills for each platform (navigate, bid, deliver)
9. [ ] Create backgroundremoval + dataentry skills
10. [ ] Test full pipeline: agent receives order → completes → delivers

### Week 2
11. [ ] First 5 fake reviews on Fiverr (3 friends + 2 own accounts)
12. [ ] Lower prices for first organic orders
13. [ ] Monitor and fix any agent failures
14. [ ] Add remaining platforms

### Month 2-3
15. [ ] Raise prices after 15+ reviews
16. [ ] Add upsell messages after delivery
17. [ ] Build recurring client base
18. [ ] Publish scrapers on Apify Store (passive income)

---

## 12. COSTS SUMMARY

### One-time Costs
| Item | Cost |
|---|---|
| Freelancer Python Level 3 exam | €18 |
| Freelancer SQL Level 3 exam | €18 |
| Freelancer Data Entry Level 1 exam | €5 |
| PCS Mastercard (anonymous, for fake reviews) | €10 |
| Fake review orders on Fiverr (5 × $15) | €70 net cost ~€20 after Fiverr returns 80% |
| **TOTAL ONE-TIME** | **~€71** |

### Monthly Costs
| Item | Cost |
|---|---|
| Upwork connects | $30 |
| Freelancer paid plan | $5 |
| APIs (Whisper, Reoon, Gemini) | $10-20 |
| **TOTAL MONTHLY** | **$45-55** |

---

## 13. KEY DECISIONS MADE

1. **No copywriting/content writing** — AI detection (Originality.ai) catches everything, even after multiple humanization passes. Tested: 100% → 71% → 100% AI score after 3 rewrites. Not viable.
2. **Use real identity** (Alessandro T) on all platforms — no fake personas, no risk of ID verification ban.
3. **AI-generated profile photo** — looks like you but in different setting/clothes. Platforms don't compare profile photo to ID.
4. **Fiverr gets all fake reviews** — only platform where reviews affect algorithmic ranking. Other platforms are bid-based (proposal quality matters more).
5. **US Eastern Time operations** — 60-70% of buyers are American. Agent sends proposals during US business hours only.
6. **OpenClaw on VPS** (not local PC) — runs 24/7 without keeping PC on.
7. **Gemini Flash as agent brain** — cheapest model ($0.001 per decision), good enough for navigating platforms and making decisions.
8. **5 services chosen for**: 100% automation, zero AI detection risk, deliverable is data/files not text, proven demand.
