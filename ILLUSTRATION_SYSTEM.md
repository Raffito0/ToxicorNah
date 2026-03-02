# Illustration Management System

## Overview
Your app now uses Supabase to dynamically manage hundreds of illustrations and their associations with emotional archetype cards.

## Database Structure

### Tables Created:

1. **archetypes** - Stores emotional profiles (The Ether Caller, The Joy Bringer, etc.)
   - name, description, category, category_number
   - gradient colors (start/end)

2. **illustrations** - Stores all illustration assets
   - url (path or URL to image)
   - tags (array for matching logic)
   - category, style

3. **archetype_traits** - Stores personality traits for each archetype
   - Links traits like "Communicative", "Honest" to archetypes

4. **illustration_mappings** - Maps illustrations to archetypes
   - archetype_id, illustration_id
   - priority (higher = shown first)

## How It Works

### Loading Cards
The `SwipeableCardDeck` component now:
1. Fetches all archetypes from Supabase on mount
2. Loads their associated illustrations and traits
3. Dynamically builds cards with the correct data

### Illustration Matching Logic
You can match illustrations to cards using:

**1. Direct Mapping (Highest Priority)**
```typescript
mapIllustrationToArchetype(archetypeId, illustrationId, priority: 100)
```

**2. Category Matching**
```typescript
// Illustrations with matching category automatically appear
illustration.category === archetype.category
```

**3. Tag-Based Matching**
```typescript
// Find illustrations by tags
findIllustrationsByTags(['warm', 'energetic'], 'EMOTIONAL TONE')
```

## Adding New Illustrations

### Using the Service Functions:

```typescript
import { addIllustration, mapIllustrationToArchetype } from './services/illustrationService';

// 1. Add illustration to database
const illustration = await addIllustration(
  'https://example.com/image.jpg',
  ['warm', 'positive', 'energetic'],
  'EMOTIONAL TONE',
  'abstract'
);

// 2. Map to specific archetype
await mapIllustrationToArchetype(
  archetypeId,
  illustration.id,
  100  // priority
);
```

### Bulk Upload via SQL:

```sql
-- Add 100 illustrations at once
INSERT INTO illustrations (url, tags, category, style)
VALUES
  ('/images/illustration-1.jpg', ARRAY['warm', 'happy'], 'EMOTIONAL TONE', 'portrait'),
  ('/images/illustration-2.jpg', ARRAY['deep', 'thoughtful'], 'POWER BALANCE', 'abstract'),
  -- ... more rows
;

-- Auto-map by category
INSERT INTO illustration_mappings (archetype_id, illustration_id, priority)
SELECT a.id, i.id, 50
FROM archetypes a
JOIN illustrations i ON i.category = a.category
WHERE i.id NOT IN (SELECT illustration_id FROM illustration_mappings);
```

## Managing Illustrations

### Service Functions Available:

- `getArchetypesWithIllustrations()` - Fetch all cards with their illustrations
- `getIllustrationForArchetype(archetypeId)` - Get best illustration for a card
- `findIllustrationsByTags(tags, category?)` - Find matching illustrations
- `addIllustration(url, tags, category, style)` - Add new illustration
- `mapIllustrationToArchetype(archetypeId, illustrationId, priority)` - Link them

## Priority System

Illustrations are selected by:
1. **Highest priority mapping first** (e.g., priority: 100)
2. **Category match** (same category)
3. **Tag overlap** (most matching tags)

## Security

- Public read access (anyone can view cards)
- Write access requires authentication
- All tables protected by Row Level Security (RLS)

## Next Steps

To scale to hundreds of illustrations:
1. Upload images to Supabase Storage or a CDN
2. Bulk insert illustration records with appropriate tags
3. Use the priority system to control which appears first
4. Add new categories/archetypes as needed
