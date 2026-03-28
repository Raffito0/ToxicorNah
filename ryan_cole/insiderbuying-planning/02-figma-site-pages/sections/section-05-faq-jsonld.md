# Section 05: FAQ Page JSON-LD

## Objective
Add FAQPage structured data to /faq for Google rich results (expandable FAQ snippets in search results).

## Implementation

### 1. Extract FAQ data
The /faq page has hardcoded FAQ items in groups. Extract these into a data constant that can be shared between the UI rendering and the JSON-LD generation.

### 2. Add JSON-LD script
In /faq/page.tsx, add a <script type="application/ld+json"> tag with FAQPage schema:
- @context: 'https://schema.org'
- @type: 'FAQPage'
- mainEntity: array of Question objects, each with:
  - @type: 'Question'
  - name: question text
  - acceptedAnswer: { @type: 'Answer', text: answer text }

### 3. Use buildFAQJsonLd helper
Import from structured-data.ts (created in section-02), pass FAQ data array.

## Tests
- Test: FAQ data constant has at least 5 questions
- Test: Each FAQ item has question (string) and answer (string)
- Test: buildFAQJsonLd output has @type 'FAQPage'
- Test: mainEntity length matches FAQ data length

## Acceptance Criteria
- [ ] /faq page source contains FAQPage JSON-LD
- [ ] Google Rich Results Test passes for /faq
- [ ] FAQ data is shared between UI and JSON-LD (no duplication)
