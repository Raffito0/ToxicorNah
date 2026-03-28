'use strict';

/**
 * Market-Hours Guard for W4-afterhours workflow.
 *
 * Determines whether the current time falls within NYSE market hours
 * (Mon-Fri 09:30-16:00 ET). Uses Intl.DateTimeFormat for automatic
 * EST/EDT handling — no manual DST math.
 *
 * Used by W4-afterhours to skip execution during market hours
 * (W4-market handles that window).
 */

/**
 * Check if a given Date falls within NYSE market hours.
 * @param {Date} date - the timestamp to check
 * @returns {{ isMarketHours: boolean, estHour: number, estMinute: number, weekday: string }}
 */
function checkMarketHours(date) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    hour12: false,
    hourCycle: 'h23',
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date).map(p => [p.type, p.value])
  );

  const estHour = parseInt(parts.hour, 10);
  const estMinute = parseInt(parts.minute, 10);
  const weekday = parts.weekday;
  const isWeekday = !['Sat', 'Sun'].includes(weekday);

  // NYSE hours: Mon-Fri 09:30 - 16:00 ET
  // 09:30 <= time < 16:00
  const afterOpen = estHour > 9 || (estHour === 9 && estMinute >= 30);
  const beforeClose = estHour < 16;
  const isMarketHours = isWeekday && afterOpen && beforeClose;

  return { isMarketHours, estHour, estMinute, weekday };
}

/**
 * Validate that all required environment variables are set.
 * Throws with a clear message naming the first missing variable.
 * @param {string[]} requiredVars - list of env var names
 * @param {object} env - environment object (e.g., process.env or $env)
 */
function validateEnvVars(requiredVars, env) {
  const missing = requiredVars.filter(name => !env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}`
    );
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { checkMarketHours, validateEnvVars };
}
