# Section 02 Code Review Interview — Alerts Pipeline Migration

**Date**: 2026-03-29
**Sections reviewed**: write-persistence.js, score-alert.js, deliver-alert.js + tests

---

## Triage

All review findings have obvious correct fixes. No user interview was conducted — all items are auto-fixed per the "NO-PERMISSION-FOR-OBVIOUS" rule.

---

## IMPORTANT 1 — `airtable_record_id` vs `nocodb_record_id` field rename

**Decision**: Auto-fix — rename `airtable_record_id` → `nocodb_record_id` everywhere in ctx context objects.

**Rationale**: The production files already correctly use `nocodb_record_id` in `deliver-alert.js`'s return object. The only inconsistency is that `write-persistence.js` stores the NocoDB integer Id as `airtable_record_id` in ctx.successfulFilings and ctx.failedFilings. Since deliver-alert reads `alertData.nocodb_record_id`, any downstream node passing a successfulFilings entry as alertData would read `undefined`. This is a latent bug that must be fixed.

**Changes applied**:
- `write-persistence.js`: rename field in ctx.successfulFilings, ctx.failedFilings, and the dead-letter guard (`f.airtable_record_id` → `f.nocodb_record_id`)
- `write-persistence.test.js`: update assertions and test data to match

---

## IMPORTANT 2 — NocoDB `like` case-sensitivity regression

**Decision**: Auto-fix — change `like` → `ilike` in `score-alert.js` `computeTrackRecord`.

**Rationale**: NocoDB supports `ilike` as a filter operator (case-insensitive `like`). This is the direct equivalent of the Supabase `ilike` that was replaced. The stored `insider_name` values are mixed case (e.g., "Timothy D. Cook"). Using `like` would return zero rows since the search value is lowercased but the column data is not. `ilike` restores the original case-insensitive matching behavior.

**Changes applied**:
- `score-alert.js`: `(insider_name,like,...)` → `(insider_name,ilike,...)`
- Also removes the now-redundant `encodeURIComponent` wrapper (client handles encoding)
- `score-alert.test.js`: update test description and assertion to check for `ilike`

---

## Minor #3 — Double-encoding in `encodeURIComponent` calls

**Decision**: Auto-fix — remove all `encodeURIComponent` wrapping of where clause values in `write-persistence.js` and `score-alert.js`.

**Rationale**: The NocoDB client's `list()` method uses `URLSearchParams.set('where', ...)` which encodes the entire where string. Pre-encoding values inside the string causes double-encoding (e.g., space → `%20` → `%2520`). The client JSDoc explicitly states: "Do NOT pre-encode `where` values."

---

## Minor #4 — Rename `createAirtableRecord` / `patchAirtableRecord` functions

**Decision**: Auto-fix — rename to `createNocoRecord` / `patchNocoRecord`.

**Rationale**: These functions are module-level and exported. The old names are misleading (Airtable is fully removed). Updated in both write-persistence.js (function definitions + exports) and write-persistence.test.js (import + usage).

---

## Minor #5 — Error propagation in `patchNocoRecord`

**Decision**: Let go — already verified. The NocoDB client throws on all non-2xx responses (confirmed in nocodb-client.js `_req` method). Error propagation is intact.

---

## Minor #6 — Dead parameters in `updateDeliveryStatus` test

**Decision**: Auto-fix — remove unused `fetchFn` and `env` from the 3 updateDeliveryStatus test calls. The function only uses `opts.nocodb`.

---

## Nitpick — Misleading comment about cast

**Decision**: Auto-fix — remove the "(cast integer Id to string for Supabase column)" parenthetical since no cast is applied in the code.
