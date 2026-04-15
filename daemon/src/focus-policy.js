'use strict';

/**
 * Focus policy for the CLI — decides whether to steal focus to Unity.
 *
 * Focus stealing is a real quality-of-life issue on single-monitor setups,
 * so the default is "only focus when necessary." There are three modes:
 *
 *   'always' — focus before every mutation command (legacy behavior, same
 *              as config.autoFocus = true in earlier versions).
 *   'smart'  — only focus for commands that actually need Unity's main
 *              thread running to make progress (currently: create_script,
 *              refresh_assets). Other commands dispatch; if --wait is set
 *              and a command stalls past a threshold, we fall back to
 *              focusing. This is the new default.
 *   'never'  — no auto-focus ever. Pass --focus per-command if needed.
 *
 * --focus and --no-focus flags always win over the policy mode.
 *
 * Why only create_script and refresh_assets?
 *   These trigger asset-database changes that Unity must process on its
 *   main thread. Without focus (on Windows) the main thread barely ticks,
 *   so the user is left waiting. Every other command either (a) completes
 *   in a single tick regardless, or (b) benefits from the --wait fallback.
 */

const COMPILATION_TRIGGERING_KINDS = new Set(['create_script', 'refresh_assets']);

const VALID_MODES = new Set(['always', 'smart', 'never']);

/**
 * Normalise the autoFocus config value to a mode string.
 *   true  → 'always' (backward compatibility with boolean config)
 *   false → 'never'
 *   'always' | 'smart' | 'never' → passed through
 *   anything else (undefined, null, bad strings) → 'smart' (default)
 */
function resolveFocusMode(configValue) {
  if (configValue === true) return 'always';
  if (configValue === false) return 'never';
  if (typeof configValue === 'string' && VALID_MODES.has(configValue)) return configValue;
  return 'smart';
}

/**
 * Decide whether to focus Unity before submitting a command.
 * @param {string} kind - command kind (e.g. 'create_script')
 * @param {object} flags - parsed CLI flags
 * @param {object} config - loaded .dreamer-config.json
 * @returns {boolean}
 */
function shouldFocusUpfront(kind, flags, config) {
  if (flags && flags['focus'] === true) return true;
  if (flags && flags['no-focus'] === true) return false;
  const mode = resolveFocusMode(config ? config.autoFocus : undefined);
  if (mode === 'always') return true;
  if (mode === 'never') return false;
  return COMPILATION_TRIGGERING_KINDS.has(kind);
}

module.exports = {
  COMPILATION_TRIGGERING_KINDS,
  VALID_MODES,
  resolveFocusMode,
  shouldFocusUpfront,
};
