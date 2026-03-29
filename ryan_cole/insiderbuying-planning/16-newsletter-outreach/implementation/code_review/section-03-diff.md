# Section-03 Diff — newsletter-gates-and-send

Files modified:
- `n8n/code/insiderbuying/weekly-newsletter.js` (+160 lines)
- `tests/insiderbuying/weekly-newsletter.test.js` (+155 lines, 24 new tests)

Key changes:
1. Added `_httpsPost(url, headersObj, bodyStr)` — native Node.js HTTPS POST helper (fetch-like response)
2. Added `checkWordCount(sections)` — [1000,1400] word count gate on s1-s5 + longer of s6_free/s6_pro, strips HTML
3. Added `checkLinkCount(html, label)` — max 7 `<a href` per assembled HTML variant
4. Added `_buildAlertTable(topAlerts)` — top-3 rows, escapeHTML on ticker/insider_name/score, Intl.NumberFormat for currency
5. Added email template constants `_EMAIL_HEAD`, `_EMAIL_HEADER_BLOCK`, `_EMAIL_FOOTER_CLOSE` (shared between tiers)
6. Added `assembleFreeHtml(sections, topAlerts, subjectA)` — s1-s3 only, upgrade CTA, unsubscribe footer
7. Added `assembleProHtml(sections, topAlerts, subjectA)` — all sections, "5 more alerts" link, `{{rp_refer_url}}`
8. Replaced stub `sendViaBeehiiv` with async version — `_postFn`/`_resendFn`/`_env` injection, Resend fallback on non-confirmed
9. Added `sendViaResend(html, subjectA, tier, subscribers, _opts)` — BATCH_SIZE=500, loop with `await` per batch
10. Added `logSendToNocodb(nocodbApi, logData)` — writes `Newsletter_Sends` record post-send
11. Added `sendWeeklyNewsletter(nocodbApi, _opts)` — full orchestrator: gather → AI → gates → assemble → parallel send → log
12. Moved `escapeHTML` before the section-03 block (was at bottom of file)
13. Added all 7 new exports to `module.exports`
14. Added 24 tests across all new public functions

Design decisions:
- AI section content (`sections.sN`) injected RAW into HTML div wrappers — sections are plain text from Gemini, treating AI output as trusted; `escapeHTML` applied only to user-supplied data (ticker, insider_name, score)
- `{{rp_refer_url}}` included literally as href attribute — Beehiiv merge tag, must not be escaped
- Resend batch test with 1100 subscribers tests `sendViaResend` directly (not through orchestrator) to avoid word count gate
- `logSendToNocodb` tested directly — side-effect only, no return value
