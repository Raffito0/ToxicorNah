# Toxic or Nah - Complete System Documentation

## Overview

A viral relationship analysis app that uses OpenAI GPT-4 Vision to analyze chat screenshots and provide emotional insights, toxicity scores, and relationship archetypes. Built with React, TypeScript, Supabase, and optimized for Italian market monetization.

---

## Core Features

### 1. AI-Powered Chat Analysis
- Uses OpenAI GPT-4 Vision API to analyze chat screenshots
- Extracts toxicity score (0-100) and 5 emotional metrics
- Identifies manipulation patterns, power dynamics, and attachment styles
- Generates personality archetypes for both people in the conversation

### 2. Four-Section Results Display
1. **Toxicity Score** (Section 1 - Always Visible)
   - Overall toxicity score with color-coded ring
   - Profile classification (Mixed Profile, Red Flag Alert, etc.)
   - Five metric bars: Warmth, Communication, Drama, Distance, Passion

2. **Emotional Breakdown** (Section 2 - Swipeable Cards)
   - 5 archetype cards matching conversation patterns
   - Front: Category name and description
   - Back: Archetype details with illustration and traits

3. **Message Breakdown** (Section 3 - Vertical Cards)
   - 4-6 key messages with deep psychological analysis
   - Shows what each message really means
   - Provides solution on how to respond

4. **Relationship Archetypes** (Section 4)
   - "He is..." and "You are..." personality profiles
   - Character illustrations with traits and energy types

### 3. Monetization System (Italian Market Optimized)

#### Free Access
- First analysis is ALWAYS completely free
- Section 1 (Toxicity Score) remains visible for all subsequent analyses
- Sections 2, 3, 4 are blurred after first free analysis

#### Premium Options

**Option 1: Toxic+ Unlimited Subscription - 4.99€/month**
- Unlimited full analyses
- All sections unlocked forever
- Complete relationship history tracking
- AI-guided reply suggestions
- Priority features access

**Option 2: Single Analysis Unlock - 1.99€**
- One-time unlock for current analysis only
- Full access to all 4 sections for this chat
- Limit: Maximum 2 single unlocks per month
- Designed to avoid subscription cannibalization

#### Viral Growth Mechanism
- After first free analysis, users see share popup
- "Condividi e Sblocca" - Share on TikTok/Instagram for 1 FREE analysis
- One-time bonus per user
- Drives organic growth and word-of-mouth

---

## Technical Architecture

### Database Schema (Supabase)

#### Core Tables
- `persons` - People being analyzed
- `chat_uploads` - Uploaded screenshot files
- `analysis_results` - Main analysis data with scores
- `analysis_emotional_profiles` - Links to selected archetypes
- `analysis_message_insights` - Message breakdown data
- `analysis_relationship_archetypes` - "He is/You are" profiles

#### Monetization Tables
- `user_subscriptions` - Stripe subscription tracking
- `user_analysis_tracking` - Usage counters per user/session
  - `full_analyses_used`
  - `single_unlocks_this_month`
  - `free_bonus_unlocks`
  - `first_analysis_completed`
- `payment_transactions` - Payment history
- `viral_shares` - Share tracking for bonus unlocks

#### Content Tables
- `archetypes` - Emotional personality types (5 categories)
- `archetype_traits` - Trait lists for each archetype
- `illustrations` - Image library for cards
- `illustration_mappings` - Links archetypes to illustrations

### Services Layer

#### `openaiService.ts`
- `analyzeChatScreenshots(images: File[]): Promise<ChatAnalysisResult>`
- Sends images to GPT-4 Vision with structured prompt
- Extracts scores, insights, archetypes, and message breakdowns
- Returns parsed JSON with all analysis data

#### `userStateService.ts`
- `getUserState(): Promise<UserState>` - Check premium status and counters
- `consumeFirstFreeAnalysis()` - Mark first analysis used
- `consumeBonusUnlock()` - Use viral share unlock
- `canPurchaseSingleUnlock()` - Check monthly limit (max 2)
- `shouldShowBlurredContent()` - Determine visibility
- Session-based tracking for anonymous users

#### `analysisService.ts`
- `processAnalysis(personId, images): Promise<analysisId>`
  - Uploads images to Supabase Storage
  - Creates analysis record
  - Triggers AI analysis asynchronously
  - Determines unlock status based on user state
- `getAnalysisResult(analysisId): Promise<StoredAnalysisResult>`
  - Fetches complete analysis with all linked data

### UI Components

#### `PaywallModal.tsx`
- Two-option layout: Subscription (primary) vs Single Unlock (secondary)
- Shows benefits for each option
- Hides single unlock when monthly limit reached
- Designed for maximum conversion

#### `ViralShareModal.tsx`
- Appears after first free analysis (2s delay)
- TikTok and Instagram share buttons
- Native share API integration
- Grants 1 free bonus unlock on share

#### `ResultsPage.tsx`
- Loads analysis by ID
- Applies blur effects to locked sections
- Triggers paywall on tap of blurred content
- Shows viral modal for first-time users

---

## User Flow

### First Time User
1. Upload chat screenshots → select person
2. Analysis processes with OpenAI GPT-4 Vision (30-60 seconds)
3. **Full results shown unlocked** (all 4 sections)
4. After 2 seconds: "Share for 1 FREE analysis" popup appears
5. User shares → gets 1 bonus unlock stored

### Second Analysis
6. User uploads new chat
7. If they shared earlier: **Full results unlocked** (bonus consumed)
8. If no share: Section 1 visible, Sections 2-4 **blurred**
9. Tap blurred content → Paywall with 2 options
10. User chooses subscription OR single unlock

### Premium User
- All future analyses: **Fully unlocked automatically**
- No blur, no paywall, unlimited access

---

## Paywall Trigger Logic

Paywall appears when:
- User taps any blurred card/section
- User taps "Sblocca Analisi Completa" button
- User scrolls to bottom (optional auto-trigger)

Paywall does NOT appear when:
- User is premium subscriber
- Analysis is unlocked (first free or bonus unlock)
- User taps Section 1 (always accessible)

---

## Blur System Implementation

```tsx
<div className="relative pointer-events-none">
  <div
    className="absolute inset-0 z-10"
    style={{
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)'
    }}
  />
  <Content />
</div>
```

- Content remains in DOM (good for SEO/layout)
- Blur overlay prevents interaction
- Click handlers on wrapper trigger paywall

---

## Monthly Reset System

On the 1st of each month (via scheduled job):
- `single_unlocks_this_month` → reset to 0
- Users can purchase 2 more single unlocks
- Subscriptions auto-renew via Stripe webhooks

---

## Environment Variables

```env
VITE_SUPABASE_URL=<your_supabase_project_url>
VITE_SUPABASE_ANON_KEY=<your_supabase_anon_key>
VITE_OPENAI_API_KEY=<your_openai_api_key>
```

**Important:** You must add your OpenAI API key to `.env` file to enable AI analysis.

---

## Stripe Integration (To Be Implemented)

### Subscription Flow
1. User clicks "Toxic+ Unlimited"
2. Redirect to Stripe Checkout (subscription mode)
3. After payment: Stripe webhook → create `user_subscriptions` record
4. Set `subscription_status = 'active'`
5. All future analyses auto-unlock

### Single Unlock Flow
1. User clicks "Sblocca Questa Analisi - 1.99€"
2. Redirect to Stripe Checkout (one-time payment)
3. After payment: Stripe webhook → update analysis `is_unlocked = true`
4. Increment `single_unlocks_this_month`
5. User sees unlocked results

### Webhook Events
- `checkout.session.completed` → Activate subscription or unlock
- `invoice.payment_succeeded` → Renew subscription
- `customer.subscription.deleted` → Cancel subscription

---

## Storage Setup (Supabase)

Create storage bucket for chat screenshots:
```sql
-- In Supabase Dashboard → Storage → New Bucket
name: chat-screenshots
public: true
file size limit: 10MB
allowed mime types: image/png, image/jpeg, image/jpg
```

---

## AI Analysis Prompt Strategy

The system uses a carefully engineered prompt that:
- Requests JSON output for structured parsing
- Focuses on manipulation patterns, power dynamics, vulnerability
- Identifies red flags vs green flags
- Extracts specific message examples with psychological insights
- Assigns relationship archetypes based on communication style

**Prompt optimized for:**
- Relationship psychology accuracy
- Viral shareability (dramatic insights)
- User addiction (revealing hidden patterns)

---

## Gamification & Retention (Future Features)

Planned features to increase engagement:
- **Relationship timeline** - Track toxicity changes over time
- **Streak system** - Daily check-in rewards
- **Comparison mode** - Compare with friends anonymously
- **AI reply suggestions** - Premium feature for responding to toxic messages
- **Achievement badges** - 10 analyses, 30-day streak, etc.

---

## Analytics to Track

Key metrics for optimization:
1. **Conversion Rate** - Upload → First Free → Subscription
2. **Viral Share Rate** - % of first-time users who share
3. **Single Unlock Usage** - Average unlocks per user before subscribing
4. **Monthly Churn** - Subscription cancellation rate
5. **Time to First Analysis** - Speed optimization target
6. **Paywall Interaction** - Which sections drive most taps

---

## Performance Optimizations

- AI analysis runs asynchronously after upload
- Results page polls for completion or shows loading state
- Images uploaded to Supabase Storage (not sent raw to OpenAI)
- Base64 conversion happens client-side
- Database queries use indexes on `user_id`, `session_id`, `created_at`

---

## Security Considerations

- RLS (Row Level Security) enabled on all tables
- Anonymous users tracked by session ID (stored in sessionStorage)
- OpenAI API key secured in environment variables
- Stripe webhooks require signature verification
- User data isolated by user_id or session_id

---

## Deployment Checklist

1. ✅ Set up Supabase project
2. ✅ Run all migrations
3. ✅ Create storage bucket for chat-screenshots
4. ⏳ Add OpenAI API key to environment variables
5. ⏳ Set up Stripe account and add keys
6. ⏳ Configure Stripe webhooks endpoint
7. ⏳ Upload archetype illustrations to database
8. ⏳ Test full flow: Upload → Analysis → Paywall → Payment
9. ⏳ Deploy to production (Vercel/Netlify)
10. ⏳ Set up monthly reset cron job

---

## Known Limitations

- OpenAI API costs: ~$0.05-0.10 per analysis (monitor usage)
- Processing time: 30-60 seconds per analysis
- Anonymous user tracking: Lost on browser data clear
- Single unlock limit: Can be bypassed with new sessions (acceptable)

---

## Support & Maintenance

### Monthly Tasks
- Monitor OpenAI API usage and costs
- Review failed analyses in database
- Check Stripe payment reconciliation
- Update archetype library with new illustrations

### Quarterly Tasks
- A/B test paywall copy and pricing
- Analyze conversion funnel drop-off points
- Add new relationship archetypes based on user feedback
- Optimize AI prompt for better accuracy

---

## Contact & Credits

Built with:
- React 18 + TypeScript
- Supabase (Database + Storage + Auth)
- OpenAI GPT-4 Vision
- Framer Motion (Animations)
- Tailwind CSS (Styling)
- Stripe (Payments)

For questions or support, refer to service documentation:
- [Supabase Docs](https://supabase.com/docs)
- [OpenAI API Reference](https://platform.openai.com/docs)
- [Stripe Integration Guide](https://stripe.com/docs)
