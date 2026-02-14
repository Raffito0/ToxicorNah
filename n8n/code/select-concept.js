// NODE: Select Concept
// Weighted random concept pick + vibe + appStyle + gender selection
// Mode: Run Once for All Items

const concepts = $input.all().map(item => item.json);

if (concepts.length === 0) {
  throw new Error('No active concepts found in Airtable');
}

// --- Weighted random selection ---
function weightedRandom(items, weightField) {
  const totalWeight = items.reduce((sum, item) => sum + (Number(item[weightField]) || 1), 0);
  let random = Math.random() * totalWeight;
  for (const item of items) {
    random -= (Number(item[weightField]) || 1);
    if (random <= 0) return item;
  }
  return items[items.length - 1];
}

const concept = weightedRandom(concepts, 'weight');

// --- Vibe selection (toxic only — most viral) ---
function pickVibe() {
  return 'toxic';
}

// --- App style (iMessage only for now) ---
function pickAppStyle() {
  return 'imessage';
}

// --- Gender (80% male person analyzed, 20% female) ---
const personGender = Math.random() < 0.80 ? 'male' : 'female';

// Use forced_vibe from Airtable if set, otherwise random
const vibe = concept.forced_vibe || pickVibe();
const appStyle = pickAppStyle();
const scenarioName = vibe + '-' + concept.concept_id + '-' + Date.now();

// Body clip count from Airtable (default 3, min 2, max 5)
const bodyClipCount = Math.min(5, Math.max(2, Number(concept.body_clip_count) || 3));

return [{
  json: {
    concept,
    vibe,
    appStyle,
    personGender,
    scenarioName,
    conceptId: concept.concept_id,
    bodyClipCount
  }
}];
