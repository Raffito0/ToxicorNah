'use strict';

jest.mock('../../n8n/code/insiderbuying/render-pdf', () => ({
  uploadToR2: jest.fn().mockResolvedValue('https://pub.r2.dev/earlyinsider/test.png'),
}));

jest.mock('../../n8n/code/insiderbuying/generate-chart', () => ({
  renderBarChart: jest.fn(),
  renderLineChart: jest.fn(),
  renderDonutChart: jest.fn(),
  uploadChart: jest.fn().mockResolvedValue('https://pub.r2.dev/earlyinsider/chart.png'),
}));

jest.mock('../../n8n/code/insiderbuying/visual-templates', () => ({
  renderTemplate: jest.fn(),
}));

jest.mock('../../n8n/code/insiderbuying/report-covers', () => ({
  renderCoverA: jest.fn(),
  renderCoverB: jest.fn(),
  renderCoverC: jest.fn(),
  renderCoverD: jest.fn(),
}));

jest.mock('../../n8n/code/insiderbuying/identity-assets', () => ({
  getCompanyLogo: jest.fn(),
  prefetchLogos: jest.fn(),
  getInsiderPhoto: jest.fn(),
  normalizeInsiderName: jest.fn(),
}));

const engine = require('../../n8n/code/insiderbuying/visual-engine');

// ─── Exports ──────────────────────────────────────────────────────────────────

describe('visual-engine exports', () => {
  test('exports charts namespace', () => {
    expect(engine.charts).toBeDefined();
  });

  test('exports templates namespace', () => {
    expect(engine.templates).toBeDefined();
  });

  test('exports covers namespace', () => {
    expect(engine.covers).toBeDefined();
  });

  test('exports identity namespace', () => {
    expect(engine.identity).toBeDefined();
  });

  test('charts.renderBarChart is a function', () => {
    expect(typeof engine.charts.renderBarChart).toBe('function');
  });

  test('templates.renderTemplate is a function', () => {
    expect(typeof engine.templates.renderTemplate).toBe('function');
  });

  test('covers.renderCoverA is a function', () => {
    expect(typeof engine.covers.renderCoverA).toBe('function');
  });

  test('identity.getCompanyLogo is a function', () => {
    expect(typeof engine.identity.getCompanyLogo).toBe('function');
  });

  test('identity.getInsiderPhoto is a function', () => {
    expect(typeof engine.identity.getInsiderPhoto).toBe('function');
  });
});

// ─── uploadChart key pattern ───────────────────────────────────────────────────

describe('uploadChart (via generate-chart module)', () => {
  test('uploadChart is exported from charts namespace', () => {
    expect(typeof engine.charts.uploadChart).toBe('function');
  });
});
