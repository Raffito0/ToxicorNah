# 🚀 Quick Start Guide - Next Steps

## ✅ What's Already Done

- [x] OpenAI API Key added to `.env`
- [x] Supabase database configured
- [x] All migrations applied
- [x] Code implementation complete

---

## 📝 What You Need To Do Now

### Step 1: Create Storage Bucket (REQUIRED - 2 minutes)

The app needs a place to store uploaded chat screenshots.

**Go to Supabase Dashboard:**
1. Visit: https://supabase.com/dashboard/project/qlhnzfmbnhzmoxhincys
2. Click **Storage** in left sidebar
3. Click **"New bucket"** button
4. Enter these settings:
   ```
   Name: chat-screenshots
   Public bucket: YES (toggle ON)
   File size limit: 10 MB
   Allowed MIME types: image/png, image/jpeg, image/jpg
   ```
5. Click **"Create bucket"**

**That's it!** The app will now be able to upload and store chat images.

---

### Step 2: Test The App (IMPORTANT)

Now you should test the complete flow to make sure everything works:

**Terminal Command:**
```bash
npm run dev
```

**Then open:** http://localhost:5173

**Test Flow:**
1. **Upload a chat screenshot** (you can use any image for now)
2. **Select a person** from the dropdown (or create new)
3. Click **"Analyze"**
4. **Wait 30-60 seconds** for AI analysis (GPT-4 Vision is processing)
5. **See results page** with toxicity score
6. **After 2 seconds** → Share modal should appear (for TikTok bonus)
7. **Sections 2-4 should be blurred** (since you already used first free analysis)
8. **Click blurred content** → Paywall should appear with 2 pricing options

**Expected Behavior:**
- ✅ First analysis = Fully unlocked
- ✅ Share modal appears offering bonus unlock
- ✅ Second analysis = Section 1 visible, rest blurred
- ✅ Paywall shows subscription (4.99€) and single unlock (1.99€)

---

### Step 3: Set Up Stripe Payments (When Ready for Real Users)

Right now the paywall shows but doesn't process payments. To enable real payments:

**A. Create Stripe Account**
1. Go to: https://stripe.com
2. Sign up for account
3. Complete verification

**B. Get Your Stripe Keys**
1. Go to: https://dashboard.stripe.com/test/apikeys
2. Copy **Publishable key** (starts with `pk_test_`)
3. Copy **Secret key** (starts with `sk_test_`)

**C. Add to Environment**
```env
# Add these to .env file:
VITE_STRIPE_PUBLIC_KEY=pk_test_your_key_here
STRIPE_SECRET_KEY=sk_test_your_key_here
```

**D. Create Products in Stripe**
1. Go to: https://dashboard.stripe.com/test/products
2. Create product: "Toxic+ Unlimited"
   - Price: 4.99 EUR
   - Billing: Recurring monthly
   - Copy the **Price ID** (starts with `price_`)
3. Create product: "Single Analysis Unlock"
   - Price: 1.99 EUR
   - Billing: One-time
   - Copy the **Price ID**

**E. Update Payment Code**

I can help you add the Stripe integration code when you're ready. For now, you can test everything except actual payments.

---

### Step 4: Upload More Illustrations (Optional but Recommended)

You have sample illustrations, but adding variety makes results more engaging:

**Manual Upload via Supabase:**
1. Go to: https://supabase.com/dashboard/project/qlhnzfmbnhzmoxhincys/editor
2. Open `illustrations` table
3. Click **"Insert row"**
4. Fill in:
   ```
   url: /path-to-your-image.jpg (upload to /public/ folder first)
   tags: ['warm', 'positive', 'energetic'] (match emotional tone)
   category: EMOTIONAL TONE (or other category)
   style: abstract / portrait / nature
   ```
5. Open `illustration_mappings` table
6. Link illustrations to archetypes with priority

**Or use the bulk upload script:**
```bash
npm run upload-illustrations
```

---

## 🎯 Current App Status

### ✅ Working Right Now:
- Upload page with person management
- Image cropping modal
- AI analysis with GPT-4 Vision (processes real chat screenshots)
- Results page with toxicity score
- 5 emotional metrics (warmth, communication, drama, etc.)
- User state tracking (first free analysis, bonus unlocks)
- Blur system on locked content
- Paywall modal with pricing
- Viral share modal with TikTok/Instagram integration

### ⏳ Needs Setup Before Production:
- Stripe payment processing (for real money collection)
- Monthly reset cron job (for single unlock limits)
- More archetype illustrations (for variety)
- Error monitoring (Sentry or similar)
- Analytics tracking (Mixpanel or similar)

---

## 🧪 Testing Scenarios

### Test 1: First-Time User (Should Be Fully Unlocked)
1. Clear browser data (or use incognito)
2. Upload chat → analyze
3. **Expected:** All sections unlocked, share modal appears

### Test 2: Second Analysis (Should Be Blurred)
1. Upload another chat → analyze
2. **Expected:** Section 1 visible, sections 2-4 blurred, paywall on tap

### Test 3: Viral Share Bonus
1. After first analysis, click "Condividi" in modal
2. Share (even if you just copy the link)
3. Upload new chat → analyze
4. **Expected:** Fully unlocked (bonus consumed)

### Test 4: Single Unlock Limit
1. Simulate purchasing 2 single unlocks (manually in database)
2. **Expected:** Third paywall should hide single unlock option

---

## 🐛 Troubleshooting

**Issue: "No response from OpenAI"**
- Check OpenAI API key is correct
- Verify you have credits on OpenAI account
- Check browser console for detailed error

**Issue: "Error uploading file"**
- Make sure storage bucket is created
- Verify bucket name is exactly: `chat-screenshots`
- Check bucket is set to public

**Issue: "Analysis stuck on 'processing'"**
- GPT-4 Vision takes 30-60 seconds
- Check OpenAI API dashboard for errors
- Look at `analysis_results` table → `error_message` field

**Issue: "Sections not blurring"**
- Check `user_analysis_tracking` table
- Verify `first_analysis_completed` = true
- Check `analysis_results.is_unlocked` field

---

## 📊 Check Your Data

**See what's in the database:**
1. Go to: https://supabase.com/dashboard/project/qlhnzfmbnhzmoxhincys/editor
2. Check these tables:
   - `analysis_results` - Your completed analyses
   - `user_analysis_tracking` - User state (free analyses used, etc.)
   - `persons` - People being analyzed
   - `chat_uploads` - Uploaded images
   - `viral_shares` - Share tracking

---

## 🚀 Ready To Deploy?

Once testing works locally, deploy to production:

**Recommended Platforms:**
- **Vercel** (easiest for React apps)
- **Netlify**
- **Railway**

**Deployment Steps:**
1. Push code to GitHub
2. Connect repo to Vercel/Netlify
3. Add environment variables:
   ```
   VITE_SUPABASE_URL
   VITE_SUPABASE_ANON_KEY
   VITE_OPENAI_API_KEY
   VITE_STRIPE_PUBLIC_KEY (when ready)
   ```
4. Deploy!

---

## 💰 Cost Estimates

**Per Analysis:**
- OpenAI GPT-4 Vision: ~$0.05-0.10
- Supabase: Free tier (up to 500MB storage)
- Total: ~$0.10 per analysis

**Monthly (100 analyses):**
- OpenAI: ~$10
- Supabase: Free
- Total: ~$10/month

**With Revenue (assuming 10% conversion):**
- 100 analyses → 10 subscriptions at 4.99€ = 49.90€/month
- Profit: ~40€/month at 100 users

Scale this up and you're profitable! 🎉

---

## 🎉 You're Almost There!

**Right now, do this:**
1. ✅ Create storage bucket (2 minutes)
2. ✅ Run `npm run dev` and test
3. ✅ Upload a chat screenshot and watch it analyze

**Later, when ready:**
4. ⏳ Set up Stripe for payments
5. ⏳ Deploy to production
6. ⏳ Start acquiring users!

Need help with Stripe integration or anything else? Just ask!
