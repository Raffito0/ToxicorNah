const fs = require('fs');
const wfPath = __dirname + '/unified-pipeline-fixed.json';
const wf = JSON.parse(fs.readFileSync(wfPath, 'utf8'));

const assembleNode = wf.nodes.find(n => n.name === 'Assemble Video');
if (!assembleNode) { console.log('ERROR: Assemble Video not found'); process.exit(1); }

if (wf.nodes.some(n => n.name === 'Harden Video') || wf.nodes.some(n => n.name === 'Verify Hardening')) {
  console.log('Nodes already exist, skipping');
  process.exit(0);
}

const ax = assembleNode.position[0];
const ay = assembleNode.position[1];

// Add nodes
wf.nodes.push({
  parameters: { jsCode: '// placeholder', mode: 'runOnceForAllItems' },
  id: 'harden-video-' + Date.now(),
  name: 'Harden Video',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [ax + 300, ay],
});

wf.nodes.push({
  parameters: { jsCode: '// placeholder', mode: 'runOnceForAllItems' },
  id: 'verify-hardening-' + (Date.now() + 1),
  name: 'Verify Hardening',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [ax + 600, ay],
});

// Rewire connections: Assemble -> Harden -> Verify -> [original targets]
const assembleConns = wf.connections['Assemble Video'];
const originalTargets = (assembleConns && assembleConns.main && assembleConns.main[0])
  ? JSON.parse(JSON.stringify(assembleConns.main[0]))
  : [];

wf.connections['Assemble Video'] = {
  main: [[{ node: 'Harden Video', type: 'main', index: 0 }]]
};
wf.connections['Harden Video'] = {
  main: [[{ node: 'Verify Hardening', type: 'main', index: 0 }]]
};
wf.connections['Verify Hardening'] = {
  main: [originalTargets]
};

fs.writeFileSync(wfPath, JSON.stringify(wf, null, 2));
console.log('Added: Assemble Video -> Harden Video -> Verify Hardening -> ' +
  (originalTargets.length > 0 ? originalTargets.map(t => t.node).join(', ') : 'NONE'));
