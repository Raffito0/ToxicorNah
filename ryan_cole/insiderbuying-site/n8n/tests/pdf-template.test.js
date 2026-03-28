const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const templatesDir = path.join(__dirname, '../../pdf-templates');

// ---------------------------------------------------------------------------
// Template files exist
// ---------------------------------------------------------------------------
describe('PDF template files', () => {
  const templates = ['base-template', 'data-study', 'premium-report', 'lead-magnet'];

  templates.forEach((name) => {
    it(`${name}.html exists`, () => {
      const filePath = path.join(templatesDir, `${name}.html`);
      assert.ok(fs.existsSync(filePath), `${name}.html not found`);
    });
  });

  it('render-template.js exists', () => {
    assert.ok(fs.existsSync(path.join(templatesDir, 'render-template.js')));
  });
});

// ---------------------------------------------------------------------------
// render-template.js functions
// ---------------------------------------------------------------------------
describe('render-template', () => {
  const { loadTemplate, populateTemplate } = require('../../pdf-templates/render-template.js');

  it('loadTemplate returns string for data-study', () => {
    const html = loadTemplate('data-study');
    assert.equal(typeof html, 'string');
    assert.ok(html.length > 100);
  });

  it('loadTemplate returns string for premium-report', () => {
    const html = loadTemplate('premium-report');
    assert.ok(html.includes('EarlyInsider') || html.includes('earlyinsider'));
  });

  it('loadTemplate returns string for lead-magnet', () => {
    const html = loadTemplate('lead-magnet');
    assert.ok(html.length > 100);
  });

  it('loadTemplate throws for unknown template', () => {
    assert.throws(() => loadTemplate('nonexistent'), /not found/i);
  });

  it('populateTemplate replaces placeholders', () => {
    const html = '<h1>{{title}}</h1><p>{{body}}</p>';
    const result = populateTemplate(html, { title: 'Hello', body: 'World' });
    assert.equal(result, '<h1>Hello</h1><p>World</p>');
  });

  it('populateTemplate handles missing data gracefully', () => {
    const html = '<h1>{{title}}</h1><p>{{missing}}</p>';
    const result = populateTemplate(html, { title: 'Hello' });
    assert.ok(result.includes('Hello'));
    // Missing placeholders remain as-is or become empty
  });

  it('populateTemplate handles null values', () => {
    const html = '<p>{{value}}</p>';
    const result = populateTemplate(html, { value: null });
    assert.equal(result, '<p></p>');
  });
});

// ---------------------------------------------------------------------------
// Template content checks
// ---------------------------------------------------------------------------
describe('template content', () => {
  const { loadTemplate } = require('../../pdf-templates/render-template.js');

  it('all templates contain disclaimer', () => {
    ['data-study', 'premium-report', 'lead-magnet'].forEach((name) => {
      const html = loadTemplate(name);
      assert.ok(
        html.toLowerCase().includes('financial advice') || html.toLowerCase().includes('disclaimer') || html.toLowerCase().includes('informational'),
        `${name} missing disclaimer`
      );
    });
  });

  it('data-study template has key findings placeholder', () => {
    const html = loadTemplate('data-study');
    assert.ok(html.includes('{{key_findings}}') || html.includes('findings'));
  });

  it('premium-report template has executive summary', () => {
    const html = loadTemplate('premium-report');
    assert.ok(html.includes('{{executive_summary}}') || html.toLowerCase().includes('executive'));
  });

  it('lead-magnet template has backtest reference', () => {
    const html = loadTemplate('lead-magnet');
    assert.ok(html.toLowerCase().includes('backtest') || html.toLowerCase().includes('performance'));
  });
});
