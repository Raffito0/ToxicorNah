const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { renderPDF, uploadToR2 } = require('../code/insiderbuying/render-pdf.js');

// ---------------------------------------------------------------------------
// renderPDF
// ---------------------------------------------------------------------------
describe('renderPDF', () => {
  it('is a function', () => {
    assert.equal(typeof renderPDF, 'function');
  });

  it('rejects with error if server is unreachable', async () => {
    await assert.rejects(
      () => renderPDF('<html><body>test</body></html>'),
      (err) => err instanceof Error
    );
  });
});

// ---------------------------------------------------------------------------
// uploadToR2
// ---------------------------------------------------------------------------
describe('uploadToR2', () => {
  it('is a function', () => {
    assert.equal(typeof uploadToR2, 'function');
  });

  it('rejects when R2 credentials missing', async () => {
    const origId = process.env.R2_ACCOUNT_ID;
    delete process.env.R2_ACCOUNT_ID;
    await assert.rejects(
      () => uploadToR2(Buffer.from('test'), 'test.pdf'),
      (err) => err.message.includes('R2 credentials')
    );
    if (origId) process.env.R2_ACCOUNT_ID = origId;
  });
});
