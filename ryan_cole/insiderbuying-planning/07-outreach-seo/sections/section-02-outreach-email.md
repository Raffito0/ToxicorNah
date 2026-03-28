# Section 02: W11 Outreach Email Sender

## Objective
Build W11 n8n workflow code: personalized email outreach via Gmail SMTP with follow-up logic.

## Implementation

### 1. Create send-outreach.js
File: n8n/code/insiderbuying/send-outreach.js

Functions:
- selectProspects(nocodbApi, limit) — query Outreach_Prospects:
  - status='found', has email, ORDER BY priority DESC, LIMIT 10
  Returns: prospects array
- generateEmail(prospect, ourArticle) — Claude Haiku:
  - Subject: specific reference to their work (NOT "Guest post opportunity")
  - Opening: genuine comment on their recent article
  - Value prop: mention our analysis by topic (not by link)
  - Ask: guest post / data contribution / resource mention
  - Sign-off: Ryan Cole
  - Max 150 words, zero template language, one CTA only
  - Include 1 specific data point
  Returns: { subject, body }
- sendEmail(to, subject, body, smtpConfig) — send via Gmail SMTP
  - From: ryan@earlyinsider.com
  - SMTP: smtp.gmail.com:587 TLS
  - Random delay 30s-5min between sends
  Returns: { success, messageId }
- generateFollowUp(prospect, originalEmail) — Claude Haiku:
  - Short: 2-3 sentences max
  - Add new value: mention a new article or data point
  - NOT "just checking in" or "bumping this"
  Returns: { subject, body }
- checkForFollowUps(nocodbApi) — query Outreach_Log:
  - email_type='initial', sent_at <= 5 days ago, no 'reply' or 'followup' entry
  Returns: prospects needing follow-up
- logEmail(prospectId, emailType, nocodbApi) — write to Outreach_Log
- updateProspectStatus(prospectId, status, nocodbApi) — update Outreach_Prospects
- Exports: selectProspects, generateEmail, sendEmail, generateFollowUp, checkForFollowUps, logEmail, updateProspectStatus

## Tests
- Test: selectProspects limits to 10 and sorts by priority
- Test: generateEmail returns subject and body
- Test: generateEmail body is <= 150 words
- Test: generateEmail body does not contain template phrases ("I hope this finds you")
- Test: generateFollowUp body is 2-3 sentences
- Test: checkForFollowUps filters correct date range
- Test: logEmail creates record with correct email_type
- Test: updateProspectStatus changes status correctly

## Acceptance Criteria
- [ ] Personalized emails that don't sound templated
- [ ] Gmail SMTP with random delays
- [ ] Follow-up on Day 5 if no reply
- [ ] 10/day rate limit
- [ ] All activity logged
