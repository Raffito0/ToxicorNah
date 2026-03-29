'use strict';

// Global fetch trap — any real fetch attempt in tests will throw.
// Must be at module scope so it is active before any beforeAll runs.
global.fetch = () => {
  throw new Error('Unexpected real fetch — use opts.fetchFn');
};

// Fake timers with fixed system time.
// All e2e tests run with Date.now() === new Date('2026-03-01T12:00:00Z').getTime().
// Tests that need to advance time call jest.advanceTimersByTime(ms) themselves.
jest.useFakeTimers();
jest.setSystemTime(new Date('2026-03-01T12:00:00Z'));

// Enforce < 10s budget for all tests in the e2e project.
jest.setTimeout(8000);
