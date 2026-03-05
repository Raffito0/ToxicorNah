// Embed updated code files into workflow JSON
const fs = require('fs');
const path = require('path');

const codePath = path.join(__dirname, 'code');

// All workflow files to process
const workflowFiles = [
  'unified-pipeline-fixed.json',
  'workflow-hook-batch.json',
  'workflow-hook-review.json',
  'workflow-poyo-monitor.json',
];

// Map code file names to n8n node names
// "Detect Type" is trivial inline code — no external file needed
const codeMap = {
  'parse-video-message.js': 'Parse Message',
  'save-clip.js': 'Save Clip',
  'prepare-production.js': 'Prepare Production',
  'generate-hook.js': 'Generate Hook',
  'generate-voiceover.js': 'Generate VO',
  'generate-outro.js': 'Generate Outro',
  'download-assets.js': 'Download Assets',
  'assemble-video.js': 'Assemble Video',
  'telegram-callback-handler.js': 'Parse Callback',
  'save-to-supabase.js': 'Save to Supabase',
  'send-recording-instructions.js': 'Send Recording Instructions',
  'handle-auto-clip.js': 'Handle Auto Clip',
  'handle-done.js': 'Handle Done',
  'queue-next-scenario.js': 'Queue Next Scenario',
  'send-vo-segments.js': 'Send VO Segments',
  'img-to-video.js': ['Img2Vid Hook', 'Img2Vid Outro'],
  'mark-clip-used.js': 'Prepare Clip Mark',
  'set-time-of-day.js': 'Set Time of Day',
  'hook-generator.js': 'Hook Generator',
  'process-review.js': 'Process Review',
  'monitor-availability.js': 'Monitor Availability',
  'save-to-content-library.js': 'Save to Content Library',
};

let totalUpdated = 0;

for (const wfFile of workflowFiles) {
  const workflowPath = path.join(__dirname, wfFile);
  if (!fs.existsSync(workflowPath)) {
    console.log('Skipped (not found): ' + wfFile);
    continue;
  }

  const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
  let updated = 0;

  for (const node of workflow.nodes) {
    if (node.type !== 'n8n-nodes-base.code') continue;

    for (const [file, nodeNames] of Object.entries(codeMap)) {
      const names = Array.isArray(nodeNames) ? nodeNames : [nodeNames];
      if (names.includes(node.name)) {
        const filePath = path.join(codePath, file);
        if (fs.existsSync(filePath)) {
          const code = fs.readFileSync(filePath, 'utf8');
          node.parameters.jsCode = code;
          console.log('  Updated: ' + node.name + ' ← ' + file);
          updated++;
        }
      }
    }
  }

  fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));
  console.log('[' + wfFile + '] ' + updated + ' nodes updated.');
  totalUpdated += updated;
}

console.log('Done. Total: ' + totalUpdated + ' nodes updated across ' + workflowFiles.length + ' workflows.');
