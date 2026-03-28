# Stripe Setup — EarlyInsider

## Steps (do in Stripe Dashboard)

### 1. Create Products + Prices

**Product 1: EarlyInsider Pro**
- Monthly: $24.00/month, recurring, USD
- Annual: $228.00/year ($19/month), recurring, USD

**Product 2: EarlyInsider Premium**
- Monthly: $49.00/month, recurring, USD
- Annual: $468.00/year ($39/month), recurring, USD

### 2. Tier Features

FREE ($0):
- Real-time alert feed (who bought what)
- 3 email alerts/week (top picks, no AI analysis)
- Weekly insider digest

PRO ($24/mo, $19/mo annual):
- Everything in Free
- Full AI analysis on every trade
- Conviction scoring + historical context
- Custom watchlist
- Unlimited email + push alerts
- 20% discount on report purchases

PREMIUM ($49/mo, $39/mo annual):
- Everything in Pro
- ALL reports included (new ones every month)
- Monthly backtest report (extended version)
- Priority support + early access

### 3. Create Coupons

**SUBSCRIBER_PRO**: $12 off first month of Pro (first invoice only)
**SUBSCRIBER_PREMIUM**: $25 off first month of Premium (first invoice only)

### 4. Create Webhook Endpoint
- URL: `https://earlyinsider.com/api/webhooks/stripe`
- Events:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`
  - `invoice.paid`

### 5. Enable Customer Portal
- Settings > Billing > Customer Portal
- Allow: cancel subscription, update payment method
- Branding: EarlyInsider logo, navy #002A5E

### 6. Collect Keys
```
STRIPE_SECRET_KEY=sk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID_PRO_MONTHLY=price_...
STRIPE_PRICE_ID_PRO_ANNUAL=price_...
```

### 7. Local Testing
```bash
# Install Stripe CLI: https://stripe.com/docs/stripe-cli
stripe listen --forward-to localhost:3000/api/webhooks/stripe
# Use the webhook signing secret printed by the CLI for local .env
```
