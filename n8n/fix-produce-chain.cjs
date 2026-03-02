/**
 * fix-produce-chain.cjs
 * Modifies the Unified Pipeline workflow JSON to:
 * 1. Remove Strada 1 nodes (Load Production Data, Find Produce Scenario, Find Produce Clips)
 * 2. Connect Route Message (Produce) → Ack Produce → existing Strada 2 chain
 * 3. Fix Find Scenario (Produce) filter: status="ready" + handle no-name case
 * 4. Wire Produce Error? false → Create Video Run → Generate Hook
 * 5. Wire Assemble Video → Assembly Error? → Send Final Video / Send Assembly Error
 * 6. Update Prepare Production code to be dynamic
 */

const fs = require('fs');
const path = require('path');

const INPUT = path.join(__dirname, 'unified-pipeline-v123.json');
const OUTPUT = path.join(__dirname, 'unified-pipeline-fixed.json');
const PREPARE_CODE = path.join(__dirname, 'code', 'prepare-production.js');

const wf = JSON.parse(fs.readFileSync(INPUT, 'utf8'));

console.log('Input:', wf.name, '— Nodes:', wf.nodes.length);

// ═══════════════════════════════════════════════════
// STEP 1: Remove Strada 1 nodes
// ═══════════════════════════════════════════════════
const removeNames = ['Load Production Data', 'Find Produce Scenario', 'Find Produce Clips'];
const removedIds = [];
for (const name of removeNames) {
  const node = wf.nodes.find(n => n.name === name);
  if (node) {
    removedIds.push(node.id);
    console.log('  Removing:', name, '(' + node.id + ')');
  }
}
wf.nodes = wf.nodes.filter(n => !removedIds.includes(n.id));

// Remove their connections
for (const name of removeNames) {
  delete wf.connections[name];
}

console.log('  Nodes after removal:', wf.nodes.length);

// ═══════════════════════════════════════════════════
// STEP 2: Route Message (Produce) → Ack Produce
// ═══════════════════════════════════════════════════
const rmConn = wf.connections['Route Message'];
if (rmConn && rmConn.main && rmConn.main[3]) {
  rmConn.main[3] = [{ node: 'Ack Produce', type: 'main', index: 0 }];
  console.log('  Route Message output 3 → Ack Produce');
} else {
  console.error('ERROR: Route Message output 3 not found!');
}

// ═══════════════════════════════════════════════════
// STEP 3: Fix Find Scenario (Produce) — status="ready" + no-name handling + sort
// ═══════════════════════════════════════════════════
const fsp = wf.nodes.find(n => n.name === 'Find Scenario (Produce)');
if (fsp) {
  // Dynamic filter: if scenarioName given, search by name + ready; otherwise just ready
  fsp.parameters.filterByFormula =
    "={{ $('Parse Message').first().json.scenarioName " +
    "? 'AND({scenario_name} = \"' + $('Parse Message').first().json.scenarioName + '\", {status} = \"ready\")' " +
    ": '{status} = \"ready\"' }}";

  // Sort by created_at ascending (oldest first)
  fsp.parameters.sort = { property: [{ field: 'created_at' }] };

  // Always output data so Prepare Production can show error message
  fsp.alwaysOutputData = true;

  console.log('  Find Scenario (Produce): filter fixed (status=ready), sort added, alwaysOutputData');
} else {
  console.error('ERROR: Find Scenario (Produce) not found!');
}

// ═══════════════════════════════════════════════════
// STEP 4: Produce Error? false → Create Video Run (instead of Generate Hook)
// ═══════════════════════════════════════════════════
const peConn = wf.connections['Produce Error?'];
if (peConn && peConn.main && peConn.main[1]) {
  peConn.main[1] = [{ node: 'Create Video Run', type: 'main', index: 0 }];
  console.log('  Produce Error? false → Create Video Run');
} else {
  console.error('ERROR: Produce Error? false branch not found!');
}

// Verify Create Video Run → Generate Hook exists
const cvrConn = wf.connections['Create Video Run'];
if (cvrConn) {
  console.log('  Create Video Run → Generate Hook: already wired');
} else {
  console.error('ERROR: Create Video Run has no connections!');
}

// ═══════════════════════════════════════════════════
// STEP 5: Wire Assemble Video → Assembly Error? (instead of direct to Send Final Video)
// ═══════════════════════════════════════════════════
wf.connections['Assemble Video'] = {
  main: [[{ node: 'Assembly Error?', type: 'main', index: 0 }]]
};
console.log('  Assemble Video → Assembly Error?');

// Verify Assembly Error? has both outputs wired
const aeConn = wf.connections['Assembly Error?'];
if (aeConn && aeConn.main) {
  console.log('  Assembly Error? outputs:', aeConn.main.map((arr, i) =>
    i + ': ' + (arr.length > 0 ? arr[0].node : 'none')
  ).join(', '));
} else {
  console.error('ERROR: Assembly Error? connections missing!');
}

// ═══════════════════════════════════════════════════
// STEP 6: Update Prepare Production code
// ═══════════════════════════════════════════════════
const ppNode = wf.nodes.find(n => n.name === 'Prepare Production');
if (ppNode && fs.existsSync(PREPARE_CODE)) {
  const newCode = fs.readFileSync(PREPARE_CODE, 'utf8');
  ppNode.parameters.jsCode = newCode;
  console.log('  Prepare Production: code updated from', PREPARE_CODE);
} else {
  console.error('ERROR: Prepare Production node or code file not found!');
}

// ═══════════════════════════════════════════════════
// STEP 7: Fix Ack Produce text to handle empty scenarioName
// ═══════════════════════════════════════════════════
const ackNode = wf.nodes.find(n => n.name === 'Ack Produce');
if (ackNode) {
  ackNode.parameters.text =
    "={{ $('Parse Message').first().json.scenarioName " +
    "? '\uD83C\uDFA4 Avvio produzione per \"' + $('Parse Message').first().json.scenarioName + '\"...' " +
    ": '\uD83C\uDFA4 Avvio produzione per il prossimo scenario pronto...' }}";
  console.log('  Ack Produce: text updated for empty scenarioName');
}

// ═══════════════════════════════════════════════════
// VALIDATION: Print the full /produce chain
// ═══════════════════════════════════════════════════
console.log('\n=== /produce chain (Strada 2, now active) ===');
const chain = [
  'Route Message (output 3)',
  'Ack Produce',
  'Find Scenario (Produce)',
  'Find Concept',
  'Find Body Clips',
  'Find Template',
  'Find Music',
  'Prepare Production',
  'Produce Error?',
  '  true → Send Produce Error',
  '  false → Create Video Run',
  'Generate Hook',
  'Generate VO',
  'Generate Outro',
  'Download Assets',
  'Assemble Video',
  'Assembly Error?',
  '  true → Send Assembly Error',
  '  false → Send Final Video',
  'Update Run Complete',
  'Done Message',
];
chain.forEach(s => console.log('  ' + s));

// Verify connections exist for each step
const steps = [
  ['Ack Produce', 'Find Scenario (Produce)'],
  ['Find Scenario (Produce)', 'Find Concept'],
  ['Find Concept', 'Find Body Clips'],
  ['Find Body Clips', 'Find Template'],
  ['Find Template', 'Find Music'],
  ['Find Music', 'Prepare Production'],
  ['Prepare Production', 'Produce Error?'],
  ['Create Video Run', 'Generate Hook'],
  ['Generate Hook', 'Generate VO'],
  ['Generate VO', 'Generate Outro'],
  ['Generate Outro', 'Download Assets'],
  ['Download Assets', 'Assemble Video'],
  ['Send Final Video', 'Update Run Complete'],
  ['Update Run Complete', 'Done Message'],
];

console.log('\n=== Connection verification ===');
let allOk = true;
for (const [from, to] of steps) {
  const conn = wf.connections[from];
  if (!conn) {
    console.log('  MISSING: ' + from + ' has no connections');
    allOk = false;
    continue;
  }
  const found = conn.main.some(arr => arr.some(c => c.node === to));
  if (!found) {
    console.log('  MISSING: ' + from + ' → ' + to);
    allOk = false;
  }
}
if (allOk) console.log('  All connections verified OK!');

// Save
fs.writeFileSync(OUTPUT, JSON.stringify(wf, null, 2), 'utf8');
console.log('\nSaved to:', OUTPUT);
console.log('Final node count:', wf.nodes.length);
