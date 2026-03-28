'use strict';
const _https = require('https');
const _http = require('http');
const { URL } = require('url');
const crypto = require('crypto');

// Screenshot server on same VPS
const PDF_SERVER_URL = 'http://host.docker.internal:3456';

/**
 * Render HTML to PDF via screenshot server.
 * @param {string} html - Populated HTML template
 * @param {object} options - PDF options
 * @returns {Promise<Buffer>} PDF buffer
 */
async function renderPDF(html, options = {}) {
  const pdfOptions = {
    format: options.format || 'Letter',
    printBackground: options.printBackground !== false,
    margin: options.margin || { top: '50px', bottom: '60px', left: '50px', right: '50px' },
  };

  const payload = JSON.stringify({ html, options: pdfOptions });
  const url = new URL('/pdf', PDF_SERVER_URL);

  return new Promise((resolve, reject) => {
    const req = _http.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error('PDF render failed: ' + res.statusCode));
        }
        resolve(Buffer.concat(chunks));
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Upload buffer to Cloudflare R2 via S3-compatible API.
 * @param {Buffer} buffer - File buffer
 * @param {string} key - R2 object key (e.g., 'reports/lead-magnet-latest.pdf')
 * @returns {Promise<string>} Public URL
 */
async function uploadToR2(buffer, key) {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const publicUrl = process.env.R2_PUBLIC_URL || 'https://pub-6e119e86bbae4479912db5c9a79d8fed.r2.dev';
  const bucket = 'toxic-or-nah';

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('R2 credentials not configured');
  }

  const host = accountId + '.r2.cloudflarestorage.com';
  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  const amzDate = now.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const region = 'auto';
  const service = 's3';

  // AWS Sig V4
  const canonicalUri = '/' + bucket + '/' + key;
  const canonicalQueryString = '';
  const payloadHash = crypto.createHash('sha256').update(buffer).digest('hex');
  const canonicalHeaders = 'content-type:application/pdf\nhost:' + host + '\nx-amz-content-sha256:' + payloadHash + '\nx-amz-date:' + amzDate + '\n';
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = 'PUT\n' + canonicalUri + '\n' + canonicalQueryString + '\n' + canonicalHeaders + '\n' + signedHeaders + '\n' + payloadHash;

  const credentialScope = dateStamp + '/' + region + '/' + service + '/aws4_request';
  const stringToSign = 'AWS4-HMAC-SHA256\n' + amzDate + '\n' + credentialScope + '\n' + crypto.createHash('sha256').update(canonicalRequest).digest('hex');

  function hmac(key, data) { return crypto.createHmac('sha256', key).update(data).digest(); }
  const signingKey = hmac(hmac(hmac(hmac('AWS4' + secretAccessKey, dateStamp), region), service), 'aws4_request');
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const authorization = 'AWS4-HMAC-SHA256 Credential=' + accessKeyId + '/' + credentialScope + ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;

  return new Promise((resolve, reject) => {
    const req = _https.request({
      hostname: host,
      path: canonicalUri,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': buffer.length,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate,
        Authorization: authorization,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(publicUrl + '/' + key);
        } else {
          reject(new Error('R2 upload failed: ' + res.statusCode + ' ' + Buffer.concat(chunks).toString()));
        }
      });
    });
    req.on('error', reject);
    req.write(buffer);
    req.end();
  });
}

module.exports = { renderPDF, uploadToR2 };
