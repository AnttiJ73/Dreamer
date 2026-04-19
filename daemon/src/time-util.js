'use strict';

/**
 * Time formatting helpers for status responses.
 *
 * Every timestamp the daemon surfaces is easier to read when paired with its
 * age and a human-readable delta, so callers don't have to do wall-clock math.
 */

/**
 * Format an absolute timestamp (ms or ISO) with age/human fields relative to `now`.
 * @param {number|string|Date|null} at - timestamp in ms since epoch, ISO string, Date, or nullish
 * @param {number} [nowMs=Date.now()]
 * @returns {{ at: string|null, ageMs: number|null, ageSec: number|null, ageHuman: string|null }}
 */
function withAge(at, nowMs = Date.now()) {
  if (at == null) return { at: null, ageMs: null, ageSec: null, ageHuman: null };
  let ms;
  if (typeof at === 'number') ms = at;
  else if (at instanceof Date) ms = at.getTime();
  else if (typeof at === 'string') {
    const parsed = Date.parse(at);
    if (Number.isNaN(parsed)) return { at: null, ageMs: null, ageSec: null, ageHuman: null };
    ms = parsed;
  } else {
    return { at: null, ageMs: null, ageSec: null, ageHuman: null };
  }
  const ageMs = Math.max(0, nowMs - ms);
  return {
    at: new Date(ms).toISOString(),
    ageMs,
    ageSec: Math.round(ageMs / 1000),
    ageHuman: humanizeAge(ageMs),
  };
}

/**
 * Render a duration in ms as a compact human-readable "X ago" string.
 * @param {number} ms
 * @returns {string}
 */
function humanizeAge(ms) {
  if (ms == null) return null;
  if (ms < 0) ms = 0;
  if (ms < 1000) return `${Math.round(ms)}ms ago`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  const remS = s % 60;
  if (m < 60) return remS > 0 ? `${m}m ${remS}s ago` : `${m}m ago`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h < 24) return remM > 0 ? `${h}h ${remM}m ago` : `${h}h ago`;
  const d = Math.floor(h / 24);
  const remH = h % 24;
  return remH > 0 ? `${d}d ${remH}h ago` : `${d}d ago`;
}

/**
 * Render a duration in ms as "X long" (no "ago" suffix) — useful for time-in-state.
 * @param {number} ms
 * @returns {string}
 */
function humanizeDuration(ms) {
  if (ms == null) return null;
  const ago = humanizeAge(ms);
  return ago ? ago.replace(/ ago$/, '') : null;
}

module.exports = { withAge, humanizeAge, humanizeDuration };
