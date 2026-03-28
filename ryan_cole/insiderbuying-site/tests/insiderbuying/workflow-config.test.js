'use strict';

const fs = require('fs');
const path = require('path');

const WORKFLOW_DIR = path.join(__dirname, '../../n8n/workflows/insiderbuying');

// ─────────────────────────────────────────────────────────────────────────────
describe('section-07: workflow configuration', () => {

  // ── W4-market ─────────────────────────────────────────────────────────────

  describe('w4-market.json', () => {
    let wf;
    beforeAll(() => {
      wf = JSON.parse(fs.readFileSync(path.join(WORKFLOW_DIR, 'w4-market.json'), 'utf8'));
    });

    test('has a valid name', () => {
      expect(wf.name).toMatch(/market/i);
    });

    test('schedule trigger fires every 15 min', () => {
      const trigger = wf.nodes.find(n => n.type === 'n8n-nodes-base.scheduleTrigger');
      expect(trigger).toBeDefined();
      const cron = trigger.parameters.rule.interval[0].expression;
      expect(cron).toBe('*/15 * * * *');
    });

    test('has market hours guard node', () => {
      const guard = wf.nodes.find(n => n.id === 'guard-market');
      expect(guard).toBeDefined();
      expect(guard.parameters.jsCode).toMatch(/checkMarketHours/);
      // W4-market: exits if NOT market hours
      expect(guard.parameters.jsCode).toMatch(/!isMarketHours/);
    });

    test('node chain: trigger → guard → sec-monitor → score → analyze → IF → deliver', () => {
      const conn = wf.connections;
      expect(conn['Schedule Trigger'].main[0][0].node).toBe('Market Hours Guard');
      expect(conn['Market Hours Guard'].main[0][0].node).toBe('sec-monitor');
      expect(conn['sec-monitor'].main[0][0].node).toBe('score-alert');
      expect(conn['score-alert'].main[0][0].node).toBe('analyze-alert');
      expect(conn['analyze-alert'].main[0][0].node).toBe('Score >= 6?');
      expect(conn['Score >= 6?'].main[0][0].node).toBe('deliver-alert');
    });

    test('IF node checks significance_score >= 6', () => {
      const ifNode = wf.nodes.find(n => n.type === 'n8n-nodes-base.if');
      expect(ifNode).toBeDefined();
      const cond = ifNode.parameters.conditions.conditions[0];
      expect(cond.leftValue).toMatch(/significance_score/);
      expect(cond.rightValue).toBe(6);
      expect(cond.operator.operation).toBe('gte');
    });

    test('has maxConcurrency=1 to prevent overlapping runs', () => {
      expect(wf.settings.maxConcurrency).toBe(1);
    });

    test('has all required Code nodes', () => {
      const codeNodes = wf.nodes.filter(n => n.type === 'n8n-nodes-base.code');
      const names = codeNodes.map(n => n.name);
      expect(names).toContain('sec-monitor');
      expect(names).toContain('score-alert');
      expect(names).toContain('analyze-alert');
      expect(names).toContain('deliver-alert');
    });
  });

  // ── W4-afterhours ─────────────────────────────────────────────────────────

  describe('w4-afterhours.json', () => {
    let wf;
    beforeAll(() => {
      wf = JSON.parse(fs.readFileSync(path.join(WORKFLOW_DIR, 'w4-afterhours.json'), 'utf8'));
    });

    test('has a valid name', () => {
      expect(wf.name).toMatch(/after.*hour/i);
    });

    test('schedule trigger fires every 60 min', () => {
      const trigger = wf.nodes.find(n => n.type === 'n8n-nodes-base.scheduleTrigger');
      expect(trigger).toBeDefined();
      const cron = trigger.parameters.rule.interval[0].expression;
      expect(cron).toBe('0 * * * *');
    });

    test('has afterhours guard that skips market hours', () => {
      const guard = wf.nodes.find(n => n.id === 'guard-afterhours');
      expect(guard).toBeDefined();
      expect(guard.parameters.jsCode).toMatch(/checkMarketHours/);
      // W4-afterhours: exits if IS market hours
      expect(guard.parameters.jsCode).toMatch(/isMarketHours.*return \[\]/s);
    });

    test('wait-for-previous-execution via maxConcurrency setting', () => {
      // n8n settings.maxConcurrency = 1 prevents overlapping executions
      expect(wf.settings.maxConcurrency).toBe(1);
    });

    test('node chain: trigger → guard → sec-monitor → score → analyze → IF → deliver', () => {
      const conn = wf.connections;
      expect(conn['Schedule Trigger'].main[0][0].node).toBe('After Hours Guard');
      expect(conn['After Hours Guard'].main[0][0].node).toBe('sec-monitor');
      expect(conn['sec-monitor'].main[0][0].node).toBe('score-alert');
      expect(conn['score-alert'].main[0][0].node).toBe('analyze-alert');
      expect(conn['analyze-alert'].main[0][0].node).toBe('Score >= 6?');
      expect(conn['Score >= 6?'].main[0][0].node).toBe('deliver-alert');
    });

    test('has all required Code nodes', () => {
      const codeNodes = wf.nodes.filter(n => n.type === 'n8n-nodes-base.code');
      const names = codeNodes.map(n => n.name);
      expect(names).toContain('sec-monitor');
      expect(names).toContain('score-alert');
      expect(names).toContain('analyze-alert');
      expect(names).toContain('deliver-alert');
    });
  });

  // ── Env var validation in sec-monitor ─────────────────────────────────────

  describe('env var fail-fast', () => {
    test('sec-monitor.js exports REQUIRED_ENV array', () => {
      const { REQUIRED_ENV } = require('../../n8n/code/insiderbuying/sec-monitor');
      expect(Array.isArray(REQUIRED_ENV)).toBe(true);
      expect(REQUIRED_ENV.length).toBeGreaterThan(0);
      expect(REQUIRED_ENV).toContain('FINANCIAL_DATASETS_API_KEY');
      expect(REQUIRED_ENV).toContain('SUPABASE_URL');
    });
  });
});
