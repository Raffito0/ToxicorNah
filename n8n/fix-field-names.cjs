/**
 * fix-field-names.cjs
 * Applies 3 fixes to the unified pipeline:
 * 1. Find Concept: use record ID from linked concept_id field
 * 2. Find Music: filter {is_active} = TRUE() instead of {status} = 'active'
 * 3. Prepare Production: pick.track_url instead of pick.file_url
 */

const fs = require('fs');
const path = require('path');

const INPUT = path.join(__dirname, 'unified-pipeline-fixed.json');
const OUTPUT = path.join(__dirname, 'unified-pipeline-fixed.json'); // overwrite

const wf = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
console.log('Input:', wf.name, '— Nodes:', wf.nodes.length);

// ═══════════════════════════════════════════════════
// FIX 1: Find Concept — search by record ID from linked field
// ═══════════════════════════════════════════════════
const findConcept = wf.nodes.find(n => n.name === 'Find Concept');
if (findConcept) {
  // Old: {concept_name} = "chat_screenshot" (wrong — no concept has that name)
  // New: RECORD_ID() = "recXXX" using the linked concept_id from the scenario
  // Fallback: if no concept_id, search for "Starting from Chat" (the chat_screenshot concept)
  findConcept.parameters.filterByFormula =
    "={{ $('Find Scenario (Produce)').first().json.concept_id && $('Find Scenario (Produce)').first().json.concept_id[0] " +
    "? 'RECORD_ID() = \"' + $('Find Scenario (Produce)').first().json.concept_id[0] + '\"' " +
    ": '{concept_name} = \"Starting from Chat\"' }}";

  console.log('  FIX 1: Find Concept filter → RECORD_ID() from linked concept_id');
} else {
  console.error('ERROR: Find Concept node not found!');
}

// ═══════════════════════════════════════════════════
// FIX 2: Find Music — {is_active} = TRUE() instead of {status} = 'active'
// ═══════════════════════════════════════════════════
const findMusic = wf.nodes.find(n => n.name === 'Find Music');
if (findMusic) {
  findMusic.parameters.filterByFormula = "{is_active} = TRUE()";
  console.log('  FIX 2: Find Music filter → {is_active} = TRUE()');
} else {
  console.error('ERROR: Find Music node not found!');
}

// ═══════════════════════════════════════════════════
// FIX 3: Prepare Production — pick.track_url instead of pick.file_url
// ═══════════════════════════════════════════════════
const ppNode = wf.nodes.find(n => n.name === 'Prepare Production');
if (ppNode) {
  const oldCode = ppNode.parameters.jsCode;
  const newCode = oldCode.replace('pick.file_url', 'pick.track_url');

  if (oldCode !== newCode) {
    ppNode.parameters.jsCode = newCode;
    console.log('  FIX 3: Prepare Production → pick.track_url');
  } else {
    console.log('  FIX 3: pick.file_url not found in code (maybe already fixed?)');
  }
} else {
  console.error('ERROR: Prepare Production node not found!');
}

// Save
fs.writeFileSync(OUTPUT, JSON.stringify(wf, null, 2), 'utf8');
console.log('\nSaved to:', OUTPUT);
