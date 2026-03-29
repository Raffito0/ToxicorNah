# Section-01 Code Review Interview

## Decisions: All Auto-Fixed (no user input required)

The review found 2 IMPORTANT issues and several minor/nitpick items. All have clear correct answers with no meaningful tradeoffs. Applied as auto-fixes:

### Auto-fix 1: `bulkCreate` throws on non-array response (IMPORTANT)
- **What:** Add `if (!Array.isArray(created)) throw new Error(...)` guard
- **Why:** Silent data loss is worse than a thrown error

### Auto-fix 2: `count()` guards against missing `count` key (IMPORTANT)
- **What:** `if (result.count === undefined) throw new Error(...)`
- **Why:** `undefined >= dailyLimit` evaluates to false, bypassing rate-limit checks silently

### Auto-fix 3: Attach `statusCode` to thrown errors (MINOR)
- **What:** Add `err.statusCode = res.status` before throwing in `_req()`
- **Why:** Makes `get()` 404 detection robust against message format changes

### Auto-fix 4: Guard `Content-Type` on GET/DELETE (NITPICK)
- **What:** Only set `Content-Type` when `opts.body !== undefined`
- **Why:** RFC correctness, no behavioral impact on localhost NocoDB

### Auto-fix 5: Test improvements (Coverage gaps)
- Add test: `bulkCreate` non-array response throws
- Add test: `count()` with `{}` response throws
- Add test: 4x 500 exhausts retries
- Add test: `bulkCreate` with exactly 200 records
- Fix: retry test uses `db.list()` instead of `db.get()`
- Fix: `update()` test name reflects pass-through semantics
- Add JSDoc notes: `where` double-encoding warning, `bulkCreate([])` no-op
