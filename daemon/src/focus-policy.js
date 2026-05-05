'use strict';

// Focus policy modes:
//   smart  (default) — never focus upfront; if --wait stalls past FOCUS_STALL_MS,
//                      focus once. On Windows Unity's main thread fully halts
//                      when unfocused, so a stall = frozen, not busy.
//   always — focus before every mutation (multi-monitor setups).
//   never  — never auto-focus; rely on per-command --focus.
// --focus / --no-focus flags override the policy. --no-focus also suppresses the
// stall-fallback. autoFocus config must be a string mode — booleans rejected,
// run `./bin/dreamer config set autoFocus=<mode>` to upgrade old setups.

const VALID_MODES = new Set(['smart', 'always', 'never']);

const DEFAULT_MODE = 'smart';

function resolveFocusMode(configValue) {
  if (typeof configValue === 'string' && VALID_MODES.has(configValue)) return configValue;
  return DEFAULT_MODE;
}

function shouldFocusUpfront(_kind, flags, config) {
  if (flags && flags['focus'] === true) return true;
  if (flags && flags['no-focus'] === true) return false;
  const mode = resolveFocusMode(config ? config.autoFocus : undefined);
  return mode === 'always';
}

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
