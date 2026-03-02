// Upload all Hook Girls images to catbox.moe permanent storage
// Run once: node n8n/upload-hook-girls.cjs
// Outputs JSON mapping of filename → permanent URL
// Uses curl via execSync (Node.js https module has connection issues with catbox)

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const HOOK_GIRLS_DIR = path.join(__dirname, '..', 'public', 'Hook Girls');

function uploadToCatbox(filePath) {
  const cmd = 'curl -s -F "reqtype=fileupload" -F "fileToUpload=@' +
    filePath.replace(/\\/g, '/') + '" https://catbox.moe/user/api.php';
  const result = execSync(cmd, { timeout: 60000 }).toString().trim();
  if (result.startsWith('https://')) return result;
  throw new Error('Unexpected response: ' + result);
}

const files = fs.readdirSync(HOOK_GIRLS_DIR)
  .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
  .sort();

console.log('Found ' + files.length + ' images in Hook Girls folder\n');

const results = {};
let success = 0;
let failed = 0;

for (let i = 0; i < files.length; i++) {
  const file = files[i];
  const filePath = path.join(HOOK_GIRLS_DIR, file);
  process.stdout.write('[' + (i + 1) + '/' + files.length + '] ' + file + ' ... ');

  let retries = 2;
  while (retries >= 0) {
    try {
      const url = uploadToCatbox(filePath);
      results[file] = url;
      console.log(url);
      success++;
      break;
    } catch (err) {
      if (retries > 0) {
        process.stdout.write('retry... ');
        // Wait 3 seconds before retry
        execSync('timeout /t 3 /nobreak > nul 2>&1 || sleep 3', { timeout: 10000 });
        retries--;
      } else {
        console.log('FAILED: ' + err.message);
        results[file] = 'FAILED';
        failed++;
        break;
      }
    }
  }
}

console.log('\n' + success + ' uploaded, ' + failed + ' failed\n');

const outputPath = path.join(__dirname, 'hook-girls-urls.json');
fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
console.log('Saved to: ' + outputPath);
