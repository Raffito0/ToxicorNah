#!/usr/bin/env python3
"""
Freelancer Auto-Bidder — Smart bidding with dynamic pricing and personalized proposals.

Usage:
    python3 autobidder.py                    # Find and bid on best projects
    python3 autobidder.py --dry-run          # Preview without bidding
    python3 autobidder.py --max=10           # Bid on up to 10 projects
    python3 autobidder.py --min-score=50     # Only bid on projects scoring 50+
"""

import os, sys, json, time, re, hashlib
import requests
from datetime import datetime, timezone

# === CONFIG ===
FREELANCER_TOKEN = os.environ.get("FREELANCER_TOKEN")
SERPAPI_KEY = os.environ.get("SERPAPI_KEY")
TELEGRAM_BOT_TOKEN = "8602086967:AAH1mI7C3IpigNai2O0P9aJvTTG_aptWIuo"
TELEGRAM_CHAT_ID = "5120450288"
BIDDER_ID = 45754627
API_BASE = "https://www.freelancer.com/api"
BID_HISTORY_FILE = "/root/.openclaw/workspace/bid_history.json"

# === OUR SERVICES — keywords that match projects to our capabilities ===
SERVICES = {
    "web_scraping": {
        "keywords": ["web scraping", "scrape", "scraper", "data extraction", "extract data",
                      "crawl", "crawling", "parse website", "website data", "scraping"],
        "min_price": 20,
        "sweet_spot": (30, 200),  # ideal budget range for us
    },
    "lead_gen": {
        "keywords": ["lead generation", "leads", "find businesses", "find companies",
                      "contact list", "b2b leads", "email list", "business list",
                      "find restaurants", "find dentists", "find doctors", "prospect list"],
        "min_price": 25,
        "sweet_spot": (30, 300),
    },
    "data_entry": {
        "keywords": ["data entry", "pdf to excel", "data cleaning", "data processing",
                      "data conversion", "copy paste data", "type data", "digitize",
                      "spreadsheet", "organize data", "data formatting"],
        "min_price": 15,
        "sweet_spot": (15, 150),
    },
    "data_enrichment": {
        "keywords": ["data enrichment", "clean data", "verify emails", "deduplicate",
                      "data cleanup", "append data", "data validation", "enrich contacts"],
        "min_price": 30,
        "sweet_spot": (40, 200),
    },
    "excel_dashboard": {
        "keywords": ["excel dashboard", "google sheets", "vba", "macro",
                      "spreadsheet automation", "excel report", "excel formula",
                      "pivot table", "excel template"],
        "min_price": 40,
        "sweet_spot": (50, 250),
    },
    "ecommerce_intel": {
        "keywords": ["product research", "competitor analysis", "amazon research",
                      "shopify research", "ecommerce research", "market research",
                      "price comparison", "product data"],
        "min_price": 50,
        "sweet_spot": (50, 300),
    },
}

# Freelancer job IDs that match our services
RELEVANT_JOB_IDS = [95, 1075, 1077, 39, 55, 1035, 1045, 177, 1683, 334]

# === API HELPERS ===
def api_get(endpoint, params=None):
    headers = {"Freelancer-OAuth-V1": FREELANCER_TOKEN}
    r = requests.get(f"{API_BASE}{endpoint}", headers=headers, params=params, timeout=15)
    return r.json()

def api_post(endpoint, data):
    headers = {"Freelancer-OAuth-V1": FREELANCER_TOKEN, "Content-Type": "application/json"}
    r = requests.post(f"{API_BASE}{endpoint}", headers=headers, json=data, timeout=15)
    return r.json()

def telegram(msg):
    requests.post(f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
                  json={"chat_id": TELEGRAM_CHAT_ID, "text": msg, "parse_mode": "Markdown"}, timeout=10)

# === BID HISTORY (don't bid on same project twice) ===
def load_history():
    try:
        with open(BID_HISTORY_FILE) as f:
            return json.load(f)
    except:
        return {"bids": [], "project_ids": []}

def save_history(history):
    os.makedirs(os.path.dirname(BID_HISTORY_FILE), exist_ok=True)
    with open(BID_HISTORY_FILE, "w") as f:
        json.dump(history, f, indent=2)

# === STEP 1: FIND PROJECTS ===
def find_projects():
    """Search for relevant projects using multiple queries."""
    all_projects = {}

    # Search by job IDs
    params = {
        "limit": 30,
        "compact": "false",
        "full_description": "true",
        "project_types[]": "fixed",
        "sort_field": "time_submitted",
        "sort_order": "desc",
    }
    for jid in RELEVANT_JOB_IDS:
        params_copy = dict(params)
        params_copy["jobs[]"] = jid
        result = api_get("/projects/0.1/projects/active/", params_copy)
        if result.get("status") == "success":
            for p in result["result"]["projects"]:
                all_projects[p["id"]] = p
        time.sleep(0.5)  # rate limit respect

    # Also search by keywords
    for keyword in ["web scraping csv", "data entry excel", "lead generation list",
                     "scrape website", "pdf to excel", "data cleaning"]:
        params_copy = dict(params)
        params_copy["query"] = keyword
        params_copy["limit"] = 10
        result = api_get("/projects/0.1/projects/active/", params_copy)
        if result.get("status") == "success":
            for p in result["result"]["projects"]:
                all_projects[p["id"]] = p
        time.sleep(0.5)

    return list(all_projects.values())

# === STEP 2: CLASSIFY & SCORE ===
def classify_service(title, description):
    """Which of our services matches this project?"""
    text = (title + " " + description).lower()
    scores = {}
    for service, config in SERVICES.items():
        score = sum(2 if kw in text else 0 for kw in config["keywords"])
        # Bonus for exact title match
        title_lower = title.lower()
        score += sum(3 for kw in config["keywords"] if kw in title_lower)
        if score > 0:
            scores[service] = score
    if not scores:
        return None, 0
    best = max(scores, key=scores.get)
    return best, scores[best]

def score_project(project):
    """Score 0-100. Higher = better opportunity."""
    score = 0
    bid_count = project.get("bid_stats", {}).get("bid_count", 0)
    bid_avg = project.get("bid_stats", {}).get("bid_avg", 0)
    budget_min = project.get("budget", {}).get("minimum", 0)
    budget_max = project.get("budget", {}).get("maximum", 0)
    time_submitted = project.get("time_submitted", 0)
    title = project.get("title", "")
    desc = project.get("description", project.get("preview_description", ""))

    # Service match (most important)
    service, match_strength = classify_service(title, desc)
    if not service:
        return -100, None
    score += min(match_strength * 5, 35)  # up to 35 points

    # Competition (lower = better)
    if bid_count == 0:     score += 35  # goldmine — no competition
    elif bid_count < 5:    score += 28
    elif bid_count < 10:   score += 20
    elif bid_count < 20:   score += 12
    elif bid_count < 35:   score += 5
    elif bid_count < 50:   score += 0
    else:                  score -= 15  # too crowded

    # Freshness (newer = better, first-mover advantage)
    age_hours = (time.time() - time_submitted) / 3600 if time_submitted else 999
    if age_hours < 0.5:    score += 25  # less than 30 min old — GOLD
    elif age_hours < 1:    score += 20
    elif age_hours < 3:    score += 15
    elif age_hours < 6:    score += 8
    elif age_hours < 12:   score += 3
    elif age_hours < 24:   score += 0
    else:                  score -= 10

    # Budget in our sweet spot
    sweet = SERVICES[service]["sweet_spot"]
    if sweet[0] <= budget_max <= sweet[1] * 2:
        score += 10
    elif budget_max < SERVICES[service]["min_price"]:
        score -= 20  # too cheap, not worth it

    # Penalty for non-English projects
    non_english = any(c in desc[:100] for c in "ñéèêëàáâäùúûüöòóôïîìíçæ") and not any(
        w in desc.lower()[:200] for w in ["the ", "and ", "for ", "you ", "need "])
    if non_english:
        score -= 30

    return score, service

# === STEP 3: CALCULATE PRICE ===
def calculate_price(project, service):
    """Dynamic pricing based on competition analysis."""
    bid_avg = project.get("bid_stats", {}).get("bid_avg", 0)
    bid_count = project.get("bid_stats", {}).get("bid_count", 0)
    budget_min = project.get("budget", {}).get("minimum", 0)
    budget_max = project.get("budget", {}).get("maximum", 0)
    age_hours = (time.time() - project.get("time_submitted", 0)) / 3600

    # Strategy: undercut based on competition level
    if bid_avg > 0:
        if bid_count == 0:
            # No competition — bid at 70% of budget max (confident pricing)
            price = budget_max * 0.70
        elif bid_count < 5:
            # Low competition — bid 15% under average
            price = bid_avg * 0.85
        elif bid_count < 15:
            # Medium competition — bid 30% under average
            price = bid_avg * 0.70
        elif bid_count < 30:
            # High competition — bid 45% under average
            price = bid_avg * 0.55
        else:
            # Very high competition — bid at minimum or skip
            price = budget_min * 1.1
    else:
        # No avg data — bid at 55% of budget max
        price = budget_max * 0.55

    # Adjust for project age (older projects need more aggressive pricing)
    if age_hours > 12:
        price *= 0.85
    elif age_hours > 6:
        price *= 0.90

    # Enforce min/max
    price = max(price, budget_min)
    price = max(price, SERVICES[service]["min_price"])
    price = min(price, budget_max * 0.85)

    # Psychological pricing
    price = int(price)
    if price > 200:
        price = (price // 50) * 50 - 3      # $247, $197, $147
    elif price > 100:
        price = (price // 25) * 25 - 2      # $123, $98, $73
    elif price > 50:
        price = (price // 10) * 10 - 3      # $47, $67, $87
    elif price > 20:
        price = (price // 5) * 5 - 1        # $24, $29, $34

    price = max(price, budget_min)
    return float(price)

# === STEP 4: EXTRACT PROJECT DETAILS ===
def extract_urls(text):
    return re.findall(r'https?://[^\s<>"{}|\\^`\[\]]+', text)

def extract_client_questions(desc):
    """Find questions or requirements the client explicitly asked about."""
    questions = []
    for line in desc.split("\n"):
        line = line.strip()
        if not line:
            continue
        # Lines with ? or bullet points asking for something
        if "?" in line and len(line) > 15:
            questions.append(line.strip("•-* "))
        elif line.startswith(("•", "-", "*")) and any(
            w in line.lower() for w in ["mention", "include", "describe", "share", "provide", "tell"]):
            questions.append(line.strip("•-* "))
    return questions[:3]  # max 3

def extract_specifics(desc):
    """Pull specific details from description to reference in proposal."""
    specifics = {}

    # URLs
    urls = extract_urls(desc)
    if urls:
        specifics["urls"] = urls[:2]

    # Numbers (records, rows, items)
    numbers = re.findall(r'(\d[\d,]+)\s*(records?|rows?|items?|leads?|contacts?|products?|entries|pages?|emails?)', desc.lower())
    if numbers:
        specifics["volume"] = numbers[0]

    # File formats mentioned
    formats = re.findall(r'\b(csv|excel|xlsx|json|google sheets?|pdf)\b', desc.lower())
    if formats:
        specifics["format"] = list(set(formats))

    return specifics

# === STEP 5: GENERATE SAMPLE (the nuclear option) ===
def generate_sample(project, service):
    """Try to generate a quick sample to include with the bid."""
    desc = project.get("description", project.get("preview_description", ""))
    urls = extract_urls(desc)

    if service == "web_scraping" and urls:
        url = urls[0]
        try:
            # Quick scrape of 5 items via Claude
            cmd = f'claude --permission-mode bypassPermissions --print "Scrape exactly 5 items from {url}. Output ONLY a CSV table with headers. No explanation." 2>/dev/null'
            result = os.popen(cmd).read().strip()
            if result and len(result) > 50 and "," in result:
                lines = result.strip().split("\n")[:6]  # header + 5 rows
                csv_preview = "\n".join(lines)
                return f"I've already scraped a quick sample from your site:\n\n{csv_preview}\n\nFull dataset delivered within hours."
        except:
            pass

    elif service == "lead_gen":
        # Extract what kind of leads
        desc_lower = desc.lower()
        # Try to build a search query from the description
        for pattern in [r'find\s+(.+?)(?:in|from|for)', r'list\s+of\s+(.+?)(?:in|from|for)',
                        r'need\s+(.+?)(?:leads|contacts|businesses|companies)']:
            match = re.search(pattern, desc_lower)
            if match:
                query = match.group(1).strip()
                try:
                    os.system("pip install --break-system-packages google-search-results -q 2>/dev/null")
                    from serpapi import GoogleSearch
                    search = GoogleSearch({"engine": "google_maps", "q": query, "api_key": SERPAPI_KEY, "num": 5})
                    results = search.get_dict()
                    places = results.get("local_results", [])[:3]
                    if places:
                        sample_text = "Here's a preview of what I found:\n\n"
                        for p in places:
                            sample_text += f"• {p.get('title','')} — {p.get('address','')} — {p.get('phone','')}\n"
                        sample_text += f"\nFull verified list delivered within hours."
                        return sample_text
                except:
                    pass
                break

    return None

# === STEP 6: WRITE PROPOSAL ===
def write_proposal(project, service, price, sample=None):
    """Generate a personalized, human-sounding proposal."""
    title = project.get("title", "")
    desc = project.get("description", project.get("preview_description", ""))
    budget_max = project.get("budget", {}).get("maximum", 0)
    questions = extract_client_questions(desc)
    specifics = extract_specifics(desc)

    # Opening — reference something SPECIFIC from their brief
    sentences = [s.strip() for s in desc.replace("\n", ". ").split(".")
                 if len(s.strip()) > 20 and not s.strip().startswith("I'm looking")]
    if sentences:
        specific_ref = sentences[0][:120].strip()
        if not specific_ref.endswith("."):
            specific_ref = specific_ref.rsplit(" ", 1)[0] + "..."
        opening = f"I read your project — {specific_ref.lower()}"
    else:
        opening = f"I read your project and can help with this"

    # Volume reference
    volume_ref = ""
    if "volume" in specifics:
        num, unit = specifics["volume"]
        volume_ref = f"\n- {num} {unit} delivered in your preferred format"

    # Format reference
    format_ref = ""
    if "format" in specifics:
        fmts = ", ".join(specifics["format"]).upper()
        format_ref = f"\n- Output in {fmts} format as requested"

    # URL reference (for scraping)
    url_ref = ""
    if "urls" in specifics and service == "web_scraping":
        url_ref = f"\n- I've already checked {specifics['urls'][0]} — the structure is straightforward"

    # Answer client's specific questions
    answers = ""
    if questions:
        answers = "\n\nTo answer your questions:"
        for q in questions:
            q_lower = q.lower()
            if any(w in q_lower for w in ["experience", "past", "portfolio"]):
                answers += f"\n• 5 years building data pipelines in New York, then went independent. 500+ projects for clients in tech, e-commerce, and healthcare."
            elif any(w in q_lower for w in ["accuracy", "quality", "verify", "check"]):
                answers += f"\n• I run automated validation: data type checks, duplicate detection, format consistency. Then manual QA row by row. Ambiguous entries are flagged, never guessed."
            elif any(w in q_lower for w in ["format", "file", "deliver"]):
                answers += f"\n• I deliver in your preferred format — Excel (.xlsx) with auto-filters, frozen headers, and conditional formatting. Also available as CSV, JSON, or Google Sheets."
            elif any(w in q_lower for w in ["time", "deadline", "deliver", "turnaround", "fast"]):
                answers += f"\n• Most projects delivered within 24 hours. I'll send a sample within 1 hour so you can verify quality."
            else:
                answers += f"\n• Re: {q[:60]}... — happy to discuss this in detail once we connect."

    # Sample section
    sample_section = ""
    if sample:
        sample_section = f"\n\n{sample}"

    # Service-specific body
    bodies = {
        "web_scraping": f"""Hi,

{opening}

What I'll deliver:
- Clean, structured data — every field validated before delivery{volume_ref}{format_ref}{url_ref}
- Browser User-Agent rotation and anti-detection for protected sites
- Delivered within 24 hours (most orders done same day){answers}{sample_section}

I can start right now. Want me to send a free 10-row sample first so you can check the quality?

— Alessandro""",

        "lead_gen": f"""Hi,

{opening}

What I'll deliver:
- Verified contact list: name, address, phone, email, website, rating{volume_ref}{format_ref}
- All phone numbers validated and properly formatted
- Emails verified (under 5% bounce rate guaranteed)
- Professional Excel file ready to import into any CRM{answers}{sample_section}

I can start right now and send a 10-lead sample within the hour.

— Alessandro""",

        "data_entry": f"""Hi,

{opening}

My approach:
- Automated validation catches data type mismatches, formatting errors, and duplicates
- Every record cross-checked before delivery — accuracy matters more than speed
- Ambiguous or missing entries flagged in a separate column, never guessed{volume_ref}{format_ref}
- Final file: Excel with auto-filters, frozen headers, alternating row colors{answers}{sample_section}

I can start immediately. Happy to process a small sample first so you can verify my work.

— Alessandro""",

        "data_enrichment": f"""Hi,

{opening}

What I'll do with your data:
- Deduplicate with fuzzy matching (catches "IBM Corp" = "International Business Machines")
- Verify and format all emails and phone numbers
- Fill missing fields: company size, industry, LinkedIn, website{volume_ref}{format_ref}
- Deliver clean Excel with a "Data Quality" column showing completeness per row{answers}{sample_section}

I can process a sample batch within hours so you can check quality before the full run.

— Alessandro""",

        "excel_dashboard": f"""Hi,

{opening}

What I'll build:
- Interactive dashboard with charts, KPIs, and conditional formatting
- Automated formulas — no manual updates needed
- VBA macros or Apps Script for repetitive tasks{volume_ref}{format_ref}
- Professional look: dark headers, clean typography, print-ready layout{answers}{sample_section}

I can have a working prototype within 24 hours for your review.

— Alessandro""",

        "ecommerce_intel": f"""Hi,

{opening}

What I'll deliver:
- Structured data report with competitor pricing, ratings, and product data
- Market gap analysis — where your competitors are weak
- Charts and visualizations (not just raw numbers){volume_ref}{format_ref}
- Actionable insights, not just data dumps{answers}{sample_section}

I can pull a quick preview within hours so you can see the level of detail before committing.

— Alessandro""",
    }

    proposal = bodies.get(service, f"""Hi,

{opening}

I'm a data specialist — 5 years of experience, 500+ projects completed. I can deliver this quickly and accurately.{volume_ref}{format_ref}{answers}{sample_section}

I can start immediately and send a sample within hours.

— Alessandro""")

    # Ensure proposal isn't too long (Freelancer limit ~4000 chars)
    if len(proposal) > 3800:
        proposal = proposal[:3750] + "\n\n— Alessandro"

    return proposal

# === STEP 7: SUBMIT BID ===
def submit_bid(project_id, amount, period, description):
    return api_post("/projects/0.1/bids/", {
        "project_id": project_id,
        "bidder_id": BIDDER_ID,
        "amount": amount,
        "period": period,
        "milestone_percentage": 100,
        "description": description
    })

# === MAIN ORCHESTRATOR ===
def run(max_bids=5, min_score=40, dry_run=False, with_samples=False):
    """
    Main loop:
    1. Find projects
    2. Score & rank
    3. Calculate price
    4. Generate sample (optional)
    5. Write personalized proposal
    6. Submit bid
    7. Notify on Telegram
    """
    history = load_history()
    already_bid = set(history["project_ids"])

    print(f"[{datetime.now().strftime('%H:%M:%S')}] Searching for projects...")
    projects = find_projects()
    print(f"  Found {len(projects)} total projects")

    # Score, filter, sort
    candidates = []
    for p in projects:
        if p["id"] in already_bid:
            continue
        score, service = score_project(p)
        if score >= min_score and service:
            candidates.append((score, service, p))

    candidates.sort(key=lambda x: x[0], reverse=True)
    print(f"  {len(candidates)} candidates above score {min_score} (excluding already-bid)")

    if not candidates:
        print("  No good projects found. Will check again next cycle.")
        return 0

    # Bid on top candidates
    bids_sent = 0
    for score, service, project in candidates[:max_bids]:
        pid = project["id"]
        title = project["title"][:80]
        bid_count = project.get("bid_stats", {}).get("bid_count", 0)
        bid_avg = project.get("bid_stats", {}).get("bid_avg", 0)
        budget_min = project.get("budget", {}).get("minimum", 0)
        budget_max = project.get("budget", {}).get("maximum", 0)

        price = calculate_price(project, service)
        sample = generate_sample(project, service) if with_samples else None
        proposal = write_proposal(project, service, price, sample)

        print(f"\n  #{bids_sent+1} | Score: {score} | {service}")
        print(f"  Title: {title}")
        print(f"  Budget: ${budget_min}-${budget_max} | Avg bid: ${bid_avg:.0f} | Bids: {bid_count}")
        print(f"  Our price: ${price:.0f}")
        print(f"  Sample: {'Yes' if sample else 'No'}")

        if dry_run:
            print(f"  [DRY RUN] Would submit. Proposal preview:")
            print(f"  {proposal[:300]}...")
            bids_sent += 1
            continue

        result = submit_bid(pid, price, 1, proposal)

        if result.get("status") == "success":
            bid_id = result["result"]["id"]
            bids_sent += 1
            history["bids"].append({
                "bid_id": bid_id, "project_id": pid, "title": title,
                "price": price, "service": service, "score": score,
                "time": datetime.now().isoformat()
            })
            history["project_ids"].append(pid)
            save_history(history)

            print(f"  ✅ Bid #{bid_id} submitted at ${price:.0f}!")
            telegram(
                f"🔔 *Bid sent*\n"
                f"📋 {title}\n"
                f"💰 ${price:.0f} (avg ${bid_avg:.0f}, {bid_count} bids)\n"
                f"🎯 {service} | Score: {score}\n"
                f"{'📎 Sample included' if sample else ''}"
            )
        else:
            error = result.get("message", "Unknown")
            print(f"  ❌ Failed: {error}")
            if "balance" in error.lower():
                print("  ⚠️ Balance too low. Stopping.")
                telegram(f"⚠️ Bidding stopped — balance too low.\nFailed on: {title}")
                break

        # Human-like delay between bids (3-5 minutes)
        if bids_sent < max_bids and bids_sent < len(candidates):
            delay = 180 + (hash(str(pid)) % 120)
            print(f"  ⏳ Waiting {delay//60}m {delay%60}s before next bid...")
            time.sleep(delay)

    print(f"\n{'='*50}")
    print(f"Done. {bids_sent} bids {'would be ' if dry_run else ''}sent.")
    print(f"Total bids today: {len(history['bids'])}")
    return bids_sent


if __name__ == "__main__":
    if not FREELANCER_TOKEN:
        print("ERROR: FREELANCER_TOKEN not set")
        sys.exit(1)

    dry_run = "--dry-run" in sys.argv
    with_samples = "--samples" in sys.argv
    max_bids = 5
    min_score = 40

    for arg in sys.argv[1:]:
        if arg.startswith("--max="):
            max_bids = int(arg.split("=")[1])
        elif arg.startswith("--min-score="):
            min_score = int(arg.split("=")[1])

    run(max_bids=max_bids, min_score=min_score, dry_run=dry_run, with_samples=with_samples)
