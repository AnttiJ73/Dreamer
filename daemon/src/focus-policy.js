'use strict';

/**
 * Focus policy for the CLI — decides whether to steal focus to Unity.
 *
 * Focus stealing is disruptive on single-monitor setups, so the default is
 * "don't focus unless Unity is clearly stalled." Three modes:
 *
 *   'smart'  — never focus upfront. Submit the command, let it dispatch, and
 *              if --wait is set and the command hasn't reached a terminal
 *              state after FOCUS_STALL_MS (default 5 s), focus once to
 *              unstick Unity's main thread. This is the default.
 *              Rationale: on Windows, Unity's main thread doesn't tick at
 *              all for some work (not "slowly" — not at all) when unfocused.
 *              If a command hasn't progressed after a few seconds, Unity is
 *              frozen, not busy.
 *   'always' — focus upfront before every mutation command. Use if Unity is
 *              on a separate monitor and focus-steals don't bother you.
 *   'never'  — no auto-focus ever. Pass --focus per command if needed.
 *
 * --focus / --no-focus flags always win over the policy mode.
 * --no-focus also suppresses the stall-fallback.
 *
 * Config: autoFocus must be one of VALID_MODES. Bad or missing values fall
 * back to 'smart'. (Booleans are NOT accepted — run
 * `./bin/dreamer config set autoFocus=<mode>` if upgrading.)
 */

const VALID_MODES = new Set(['smart', 'always', 'never']);

const DEFAULT_MODE = 'smart';

/** Normalise the autoFocus config value. Unknown/missing → 'smart'. */
function resolveFocusMode(configValue) {
  if (typeof configValue === 'string' && VALID_MODES.has(configValue)) return configValue;
  return DEFAULT_MODE;
}

/**
 * Decide whether to focus Unity before submitting a command.
 * Note: in 'smart' mode this always returns false — the stall-fallback in
 * submitCommand handles focus when (and only when) Unity has clearly stopped
 * progressing.
 * @param {string} _kind - command kind (unused; kept for future per-kind rules)
 * @param {object} flags - parsed CLI flags
 * @param {object} config - loaded .dreamer-config.json
 * @returns {boolean}
 */
function shouldFocusUpfront(_kind, flags, config) {
  if (flags && flags['focus'] === true) return true;
  if (flags && flags['no-focus'] === true) return false;
  const mode = resolveFocusMode(config ? config.autoFocus : undefined);
  return mode === 'always';
}

/**
 * Should the --wait loop fallback-focus Unity on stall?
 * True only when: --no-focus is not set, upfront focus did not happen,
 * and mode is 'smart'. 'always' mode has already focused; 'never' stays out.
 */
function shouldFallbackFocus(flags, config, focusedUpfront) {
  if (flags && flags['no-focus'] === true) return false;
  if (focusedUpfront) return false;
  const mode = resolveFocusMode(config ? config.autoFocus : undefined);
  return mode === 'smart';
}

module.exports = {
  VALID_MODES,
  DEFAULT_MODE,
  resolveFocusMode,
  shouldFocusUpfront,
  shouldFallbackFocus,
};
