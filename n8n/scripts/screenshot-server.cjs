#!/usr/bin/env node
/**
 * screenshot-server.cjs
 * Lightweight HTTP server that generates chat screenshots on demand.
 *
 * Start:  node screenshot-server.cjs
 * Usage:  POST http://localhost:3456/screenshot  (body = scenario JSON)
 * Returns: PNG image binary
 *
 * n8n (running in Docker) calls this via HTTP Request node
 * using http://host.docker.internal:3456/screenshot
 */

const http = require('http');
const { takeScreenshot } = require('./take-screenshot.cjs');

const PORT = 3456;

const server = http.createServer(async (req, res) => {
  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  // Screenshot endpoint
  if (req.method === 'POST' && req.url === '/screenshot') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const scenario = JSON.parse(body);
        console.log('Generating screenshot for: ' + (scenario.id || 'unknown') + ' (' + scenario.chat.appStyle + ')');

        // Pass null as outputPath to get a buffer back
        const pngBuffer = await takeScreenshot(scenario, null);

        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Content-Length': pngBuffer.length
        });
        res.end(pngBuffer);
        console.log('Screenshot sent (' + pngBuffer.length + ' bytes)');
      } catch (err) {
        console.error('Screenshot error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 404 for everything else
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found. Use POST /screenshot' }));
});

server.listen(PORT, () => {
  console.log('Screenshot server running on http://localhost:' + PORT);
  console.log('n8n Docker URL: http://host.docker.internal:' + PORT + '/screenshot');
  console.log('Press Ctrl+C to stop');
});
