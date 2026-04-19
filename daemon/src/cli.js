'use strict';

const fs = require('fs');
const path = require('path');
const { ensureDaemon, isDaemonRunning, startDaemon, stopDaemon, httpRequest, focusUnity } = require('./daemon-manager');
const configModule = require('./config');
const schemas = require('./schemas');
const focusPolicy = require('./focus-policy');
const { KIND_DEFS } = require('./command');

// ── Config ──────────────────────────────────────────────────────────────────

const CONFIG_PATH = configModule.CONFIG_PATH;
const loadConfig = configModule.load;
const config = loadConfig();

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Print JSON to stdout and exit. */
function out(data, exitCode = 0) {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  process.exit(exitCode);
}

/** Print error JSON to stderr and exit 1. */
function fail(message) {
  process.stderr.write(JSON.stringify({ error: message }, null, 2) + '\n');
  process.exit(1);
}

/**
 * One-line (occasionally two-line) humanized summary of /api/status. Used as
 * the default `dreamer status` output — the raw JSON is still available via
 * `--json`. Priority: bad news (disconnected / stuck / compile errors) first,
 * healthy state last.
 */
function summarizeStatus(data) {
  if (!data || typeof data !== 'object') return 'PROBLEM: malformed status response';
  const d = data.daemon || {};
  const u = data.unity || {};
  const q = data.queue || {};
  const s = data.scheduler || {};

  const parts = [];
  let verdict = 'OK';

  // Connection check
  if (!u.connected) {
    verdict = 'PROBLEM';
    const age = u.lastHeartbeatAge && u.lastHeartbeatAge.ageHuman;
    parts.push(u.lastHeartbeat ? `Unity disconnected (last heartbeat ${age})` : 'Unity bridge has not connected');
  } else {
    parts.push(`Unity connected (${(u.projectPath || '').split(/[\\/]/).pop() || 'unknown project'})`);
    if (u.compiling) parts.push('compiling');
    else if ((u.compileErrors || []).length > 0) { verdict = 'PROBLEM'; parts.push(`${u.compileErrors.length} compile error${u.compileErrors.length === 1 ? '' : 's'}`); }
    else if (u.lastCompileSuccess) parts.push(`last compile ${u.lastCompileSuccessAge.ageHuman}`);
  }

  // Queue health
  const nonTerminal = (q.queued || 0) + (q.waiting || 0) + (q.running || 0) + (q.dispatched || 0);
  if (nonTerminal === 0) {
    parts.push(`${q.total || 0} total / 0 in flight`);
  } else {
    const stuck = (q.active || []).filter(a => a.sinceUpdateMs && a.sinceUpdateMs > 60000);
    if (stuck.length > 0) verdict = 'PROBLEM';
    parts.push(`${nonTerminal} in flight${stuck.length ? ` (${stuck.length} stuck > 1m)` : ''}`);
  }

  // Scheduler liveness
  if (s && s.lastTickAge && s.lastTickAge.ageMs > (s.tickIntervalMs || 200) * 10) {
    verdict = 'PROBLEM';
    parts.push(`scheduler frozen ${s.lastTickAge.ageHuman}`);
  } else if (s && s.totalDispatched != null) {
    parts.push(`${s.totalDispatched} dispatched in ${d.uptimeHuman || '?'}`);
  }

  let line = `${verdict}: ${parts.join(', ')}.`;

  // Append stuck-command detail (worst offender) when applicable.
  if (verdict === 'PROBLEM' && q.active && q.active.length) {
    const worst = q.active.slice().sort((a, b) => (b.sinceUpdateMs || 0) - (a.sinceUpdateMs || 0))[0];
    if (worst) {
      line += `\n  Stuck: ${worst.kind} (${worst.state}) for ${worst.sinceUpdateHuman}${worst.waitingReason ? ` — ${worst.waitingReason}` : ''}`;
    }
  }
  return line;
}

/**
 * Parse CLI flags from argv into a simple map.
 * Handles: --flag value, --flag=value, --bool-flag (no value → true)
 * @param {string[]} argv
 * @returns {{ positional: string[], flags: object }}
 */
function parseArgs(argv) {
  const positional = [];
  const flags = {};
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        flags[arg.slice(2, eqIdx)] = maybeDetectGitBashPath(arg.slice(2, eqIdx), arg.slice(eqIdx + 1));
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
          flags[arg.slice(2)] = maybeDetectGitBashPath(arg.slice(2), next);
          i++;
        } else {
          flags[arg.slice(2)] = true;
        }
      }
    } else {
      positional.push(arg);
    }
    i++;
  }
  return { positional, flags };
}

/**
 * Git-Bash on Windows silently rewrites absolute paths: `/Foo` becomes
 * `C:/Program Files/Git/Foo` (MSYS MSYS2_ARG_CONV_EXCL). This bites
 * scene-object paths constantly — `--scene-object /MainMenuCanvas` turns
 * into `--scene-object C:/Program Files/Git/MainMenuCanvas`, which the
 * daemon then can't find and reports as a mysterious "not found".
 *
 * We detect the translated form for flags that conventionally carry scene
 * paths and warn the user with a concrete remedy. We don't auto-fix because
 * there's a legitimate (rare) case where the user really does want to
 * reference something under `C:/Program Files/Git/…`.
 */
const SCENE_PATH_FLAGS = new Set(['scene-object', 'parent', 'parent-path']);
function maybeDetectGitBashPath(flagName, value) {
  if (typeof value !== 'string') return value;
  if (!SCENE_PATH_FLAGS.has(flagName)) return value;
  const translated = /^[A-Za-z]:[\\/]Program Files[\\/]Git[\\/]/i;
  if (translated.test(value)) {
    process.stderr.write(
      `warn: --${flagName}='${value}' looks like a Git-Bash path-translated value.\n` +
      `      Git-Bash rewrites leading '/X' to 'C:/Program Files/Git/X'. To pass a\n` +
      `      scene path, drop the leading slash (e.g. 'MainMenuCanvas/Child') or\n` +
      `      use a double slash ('//MainMenuCanvas/Child').\n`
    );
  }
  return value;
}

/**
 * Submit a command to the daemon and optionally wait for completion.
 * @param {string} kind
 * @param {object} args
 * @param {object} flags - CLI flags (may contain --wait, --priority, etc.)
 * @returns {Promise<void>}
 */
// How long a --wait command may sit without progressing to a terminal state
// before we conclude Unity's main thread is frozen and focus-steal to unstick
// it. Only applies in smart mode. Override per-invocation with --focus-after,
// or globally via config.focusStallMs.
const DEFAULT_FOCUS_STALL_MS = 5000;

const TERMINAL_STATES = new Set(['succeeded', 'failed', 'blocked', 'cancelled']);

/**
 * Detect error messages that usually mean "Unity hasn't imported recent .cs
 * changes" rather than "user typoed". These appear when an agent writes a
 * script directly (bypassing `./bin/dreamer create-script`) and then tries to
 * use the new type/property before Unity auto-imports or the CLI triggers
 * `refresh-assets`. We enrich the error with a specific remediation hint.
 */
function isStaleAssetError(errorMsg) {
  if (!errorMsg || typeof errorMsg !== 'string') return false;
  return /^Type not found:/i.test(errorMsg)
      || /^Property '.+' not found on/i.test(errorMsg);
}

/**
 * Auto-prepend a refresh-assets when a compile-gated command is about to
 * submit and the asset watcher has seen .cs changes since the last refresh.
 * This lets direct-write workflows (agent writes .cs via its native Write
 * tool, then calls add-component) Just Work without a manual refresh step.
 *
 * Opt-out: --no-refresh flag, or config.autoRefresh === false.
 */
async function maybeAutoRefreshAssets(kind, flags) {
  if (flags['no-refresh'] === true) return;
  if (config.autoRefresh === false) return;
  const def = KIND_DEFS[kind];
  if (!def || !def.requirements || def.requirements.compilation !== true) return;
  if (kind === 'refresh_assets') return; // don't recurse

  let statusResp;
  try {
    statusResp = await httpRequest('GET', '/api/status');
  } catch { return; /* daemon not reachable, let submit fail naturally */ }
  const dirty = statusResp && statusResp.data && statusResp.data.assets && statusResp.data.assets.dirty;
  if (!dirty) return;

  // Issue a synchronous refresh. We use the daemon API directly (not a
  // recursive submitCommand) so we don't double-focus or re-enter this path.
  const refreshResp = await httpRequest('POST', '/api/commands', {
    kind: 'refresh_assets',
    args: {},
    options: { humanLabel: 'Auto-refresh (stale asset DB)' },
  });
  if (refreshResp.status >= 400) return; // best-effort; surface the original failure later if needed
  const refreshId = refreshResp.data.id;

  // Poll until the refresh completes or we hit a reasonable timeout.
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    await sleep(250);
    const check = await httpRequest('GET', `/api/commands/${refreshId}`);
    if (check.status !== 200) break;
    if (TERMINAL_STATES.has(check.data.state)) return;
  }
}

async function submitCommand(kind, args, flags = {}) {
  await ensureDaemon();

  await maybeAutoRefreshAssets(kind, flags);

  const focusedUpfront = focusPolicy.shouldFocusUpfront(kind, flags, config);
  if (focusedUpfront) {
    await focusUnity();
  }

  const options = {};
  if (flags['origin-task-id']) options.originTaskId = flags['origin-task-id'];
  if (flags['label']) options.humanLabel = flags['label'];
  if (flags['priority']) options.priority = parseInt(flags['priority'], 10) || 0;
  if (flags['depends-on']) options.dependsOn = flags['depends-on'];
  if (flags['allow-playmode']) options.allowPlayMode = true;

  const resp = await httpRequest('POST', '/api/commands', { kind, args, options });
  if (resp.status >= 400) {
    fail(resp.data.error || `HTTP ${resp.status}`);
  }

  const cmd = resp.data;

  if (flags.wait) {
    // Poll until terminal state. In smart mode (the default), Unity's main
    // thread can freeze entirely when the window is unfocused — not "tick
    // slowly", just stop. If the command hasn't reached a terminal state after
    // the stall window, focus Unity once to unstick it.
    const pollInterval = 500; // ms
    const timeout = parseInt(flags['wait-timeout'], 10) || 120000; // 2 min default
    const stallMs = focusPolicy.shouldFallbackFocus(flags, config, focusedUpfront)
      ? (parseInt(flags['focus-after'], 10) || config.focusStallMs || DEFAULT_FOCUS_STALL_MS)
      : Infinity;
    const start = Date.now();
    const deadline = start + timeout;
    let hasFallbackFocused = false;

    while (Date.now() < deadline) {
      await sleep(pollInterval);

      // Fallback focus: Unity has almost certainly stopped ticking if a
      // dispatched command hasn't transitioned to terminal in this many ms.
      if (!hasFallbackFocused && (Date.now() - start) >= stallMs) {
        hasFallbackFocused = true;
        await focusUnity();
      }

      const check = await httpRequest('GET', `/api/commands/${cmd.id}`);
      if (check.status === 404) {
        // Command vanished — most commonly, the daemon restarted since we
        // submitted. Compare daemon uptime against command age to confirm
        // and give the user an actionable error instead of a raw 404.
        const stat = await httpRequest('GET', '/api/status').catch(() => null);
        const uptimeMs = stat && stat.data && stat.data.daemon && (stat.data.daemon.uptime * 1000);
        const cmdAgeMs = Date.now() - Date.parse(cmd.createdAt);
        if (Number.isFinite(uptimeMs) && Number.isFinite(cmdAgeMs) && uptimeMs < cmdAgeMs) {
          process.stderr.write(JSON.stringify({
            error: 'Command lost: the daemon restarted since this command was submitted',
            commandId: cmd.id,
            kind: cmd.kind,
            daemonUptimeMs: Math.round(uptimeMs),
            commandAgeMs: Math.round(cmdAgeMs),
            hint: 'The in-memory queue is discarded on daemon restart. Re-submit the command.',
          }, null, 2) + '\n');
          process.exit(1);
        }
        fail(`Failed to poll command: ${check.data.error || check.status}`);
      }
      if (check.status !== 200) {
        fail(`Failed to poll command: ${check.data.error || check.status}`);
      }
      const current = check.data;
      if (TERMINAL_STATES.has(current.state)) {
        // Enrich the most common confusing failure mode: "Type not found"
        // / "Property not found" usually means the agent wrote .cs files
        // directly and skipped refresh-assets, not that they typoed.
        if (current.state === 'failed' && current.error && isStaleAssetError(current.error)) {
          process.stderr.write(JSON.stringify({
            error: current.error,
            commandId: current.id,
            kind: current.kind,
            hint: 'This error usually means Unity has not imported recent .cs changes. If you wrote or edited a script directly (not via `./bin/dreamer create-script`), run `./bin/dreamer refresh-assets --wait` and then `./bin/dreamer compile-status` before re-running this command. Unity must be focused to compile, so you may also need `./bin/dreamer focus-unity`.',
          }, null, 2) + '\n');
          process.exit(1);
        }
        out(current);
        return;
      }

      // Short-circuit on dead-wait conditions — situations where polling
      // will never succeed without external intervention. Fetch extra
      // context (compile errors) and surface a clear, non-zero failure
      // instead of letting the user wait out the timeout.
      if (current.state === 'waiting' && current.waitingReason === 'Compile errors present') {
        const cs = await httpRequest('GET', '/api/compile-status').catch(() => null);
        const errors = (cs && cs.data && cs.data.errors) || [];
        process.stderr.write(JSON.stringify({
          error: 'Cannot proceed: Unity has compile errors',
          commandId: current.id,
          kind: current.kind,
          waitingReason: current.waitingReason,
          compileErrors: errors,
          hint: 'Fix the scripts with compile errors. Unity needs to recompile before this command can proceed — it will do so automatically when focused, but if you see stale errors persist, run `./bin/dreamer focus-unity` then check `./bin/dreamer compile-status` until the errors clear, then re-run the original command.',
        }, null, 2) + '\n');
        process.exit(1);
      }
    }
    fail(`Timed out waiting for command ${cmd.id} after ${timeout}ms`);
  } else {
    out(cmd);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Command routing ──────────────────────────────────────────────────────────

/**
 * Main CLI dispatch.
 * @param {string[]} argv - process.argv.slice(2)
 */
async function run(argv) {
  const { positional, flags } = parseArgs(argv);
  const command = positional[0];

  if (!command || flags.help) {
    out({
      usage: 'dreamer <command> [options]',
      commands: [
        'find-assets [--type TYPE] [--name PATTERN] [--path FOLDER]',
        'inspect <path-or-guid>',
        'inspect-hierarchy [--scene NAME]',
        'create-script --name NAME [--namespace NS] [--template TYPE] [--path FOLDER]',
        'add-component (--asset PATH | --scene-object NAME) --type TYPENAME',
        'remove-component (--asset PATH | --scene-object NAME) --type TYPENAME',
        'remove-missing-scripts (--asset PATH | --scene-object PATH | --path FOLDER) [--dry-run] [--non-recursive]',
        'set-property (--asset PATH | --scene-object NAME) [--component TYPE] --property PATH --value JSON',
        'create-prefab --name NAME [--path FOLDER]',
        'instantiate-prefab --asset PATH [--name NAME] [--parent /PATH] [--position {x,y,z}]',
        'create-gameobject --name NAME [--parent PATH] [--scene SCENE]',
        'save-assets',
        'reimport-script --path FILE_OR_FOLDER [--non-recursive]   (force re-import of .cs files Unity misclassified as unknown)',
        'create-material --name NAME [--path FOLDER] [--shader "Shader/Name"]',
        'inspect-material --asset PATH_OR_GUID',
        'set-material-property --asset PATH_OR_GUID (--property NAME --value JSON | --keyword NAME [--enable true|false])',
        'set-material-shader --asset PATH_OR_GUID --shader "Shader/Name"',
        'shader-status [--asset PATH_OR_GUID]    (no arg = project-wide scan)',
        'inspect-shader (--asset PATH_OR_GUID | --shader "Shader/Name")',
        'status [--id CMD_ID]',
        'queue [--state STATE] [--task TASK_ID]',
        'compile-status',
        'console [--count N]',
        'activity [--limit N] [--since 90s|5m|1h] [--state X]   (recent commands across the queue, newest first — multi-agent visibility)',
        'add-child-to-prefab --asset PATH_OR_GUID --child-name NAME [--parent-path SUBPATH]',
        'save-as-prefab --scene-object NAME [--path FOLDER] [--name PREFABNAME]',
        'execute-menu-item "MenuItem/Path"',
        'execute-method --type TYPENAME --method METHODNAME',
        'create-scene --name NAME [--path FOLDER] [--set-active]',
        'open-scene PATH [--mode single|additive]',
        'save-scene [--path PATH]',
        'create-scriptable-object --type TYPENAME --name NAME [--path FOLDER]',
        'create-hierarchy --json JSON',
        'daemon start|stop|status',
        'registry list|remove [path]|prune|reassign --port N [--project PATH]',
        'update [--ref REF] [--dry-run] [--check]',
        'config get | config set key=value',
        'probe-port [--start PORT] [--count N]',
        'log tail [--n N] | log path',
        'help <kind>    (render arg schema for a command kind, if documented)',
      ],
      flags: [
        '--wait', '--wait-timeout MS', '--origin-task-id ID', '--label TEXT',
        '--priority N', '--depends-on CMD_ID',
        '--scene-object PATH  (for set-property / save-as-prefab: target a scene object instead of an asset)',
        '--focus          force Unity focus upfront (overrides policy)',
        '--no-focus       suppress all Unity focus (upfront + --wait fallback)',
        '--focus-after MS override stall threshold before focusing a --wait command that hasn\'t completed (default 5000, smart mode only)',
        '--no-refresh     skip the auto refresh-assets that runs before compile-gated commands when .cs files have changed',
        '--label TEXT    tag the command with a free-form label (recommended in multi-agent sessions: `--label "agent-A:player-setup"`). Appears in status, queue, activity.',
        '--allow-playmode bypass the Play Mode scene-edit gate. Scene edits during Play Mode revert on exit; only set this for intentional runtime mutation.',
      ],
    });
    return;
  }

  try {
    switch (command) {
      // ── Asset / editor commands ───────────────────────────────────────
      case 'find-assets':
        await submitCommand('find_assets', {
          type: flags.type || null,
          name: flags.name || null,
          path: flags.path || null,
        }, flags);
        break;

      case 'inspect': {
        if (flags['scene-object']) {
          // Inspect a specific scene object
          await submitCommand('inspect_asset', { sceneObjectPath: flags['scene-object'] }, flags);
        } else {
          const target = positional[1];
          if (!target) fail('Usage: dreamer inspect <path-or-guid> OR dreamer inspect --scene-object NAME');
          const isGuid = /^[0-9a-f]{32}$/i.test(target);
          const args = isGuid ? { guid: target } : { assetPath: target };
          await submitCommand('inspect_asset', args, flags);
        }
        break;
      }

      case 'create-script': {
        if (!flags.name) fail('--name is required for create-script');
        await submitCommand('create_script', {
          name: flags.name,
          namespace: flags.namespace || null,
          template: flags.template || 'monobehaviour',
          path: flags.path || null,
        }, flags);
        break;
      }

      case 'add-component': {
        if (!flags.asset && !flags['scene-object']) fail('--asset or --scene-object is required for add-component');
        if (!flags.type) fail('--type is required for add-component');
        const acArgs = { typeName: flags.type };
        if (flags['scene-object']) {
          acArgs.sceneObjectPath = flags['scene-object'];
        } else {
          const isGuidAC = /^[0-9a-f]{32}$/i.test(flags.asset);
          Object.assign(acArgs, isGuidAC ? { guid: flags.asset } : { assetPath: flags.asset });
        }
        if (flags['child-path']) acArgs.childPath = flags['child-path'];
        await submitCommand('add_component', acArgs, flags);
        break;
      }

      case 'remove-component': {
        if (!flags.asset && !flags['scene-object']) fail('--asset or --scene-object is required for remove-component');
        if (!flags.type) fail('--type is required for remove-component');
        const rcArgs = { typeName: flags.type };
        if (flags['scene-object']) {
          rcArgs.sceneObjectPath = flags['scene-object'];
        } else {
          const isGuidRC = /^[0-9a-f]{32}$/i.test(flags.asset);
          Object.assign(rcArgs, isGuidRC ? { guid: flags.asset } : { assetPath: flags.asset });
        }
        if (flags['child-path']) rcArgs.childPath = flags['child-path'];
        await submitCommand('remove_component', rcArgs, flags);
        break;
      }

      case 'remove-missing-scripts': {
        if (!flags.asset && !flags['scene-object'] && !flags.path) {
          fail('remove-missing-scripts requires one of --asset PATH, --scene-object PATH, or --path FOLDER');
        }
        const rmsArgs = {};
        if (flags['scene-object']) {
          rmsArgs.sceneObjectPath = flags['scene-object'];
        } else if (flags.asset) {
          const isGuidRMS = /^[0-9a-f]{32}$/i.test(flags.asset);
          Object.assign(rmsArgs, isGuidRMS ? { guid: flags.asset } : { assetPath: flags.asset });
        } else {
          rmsArgs.path = flags.path;
        }
        if (flags['dry-run']) rmsArgs.dryRun = true;
        if (flags['non-recursive']) rmsArgs.recursive = false;
        await submitCommand('remove_missing_scripts', rmsArgs, flags);
        break;
      }

      case 'set-property': {
        if (!flags.asset && !flags['scene-object']) fail('--asset or --scene-object is required for set-property');
        if (!flags.property) fail('--property is required for set-property');
        if (flags.value === undefined) fail('--value is required for set-property');
        let value;
        try {
          value = JSON.parse(flags.value);
        } catch {
          // Treat as raw string
          value = flags.value;
        }
        const spArgs = {
          componentType: flags.component || null,
          propertyPath: flags.property,
          value,
        };
        if (flags['scene-object']) {
          spArgs.sceneObjectPath = flags['scene-object'];
        } else {
          const isGuidSP = /^[0-9a-f]{32}$/i.test(flags.asset);
          Object.assign(spArgs, isGuidSP ? { guid: flags.asset } : { assetPath: flags.asset });
        }
        if (flags['child-path']) spArgs.childPath = flags['child-path'];
        await submitCommand('set_property', spArgs, flags);
        break;
      }

      case 'create-prefab': {
        if (!flags.name) fail('--name is required for create-prefab');
        await submitCommand('create_prefab', {
          name: flags.name,
          path: flags.path || null,
        }, flags);
        break;
      }

      case 'create-gameobject': {
        if (!flags.name) fail('--name is required for create-gameobject');
        await submitCommand('create_gameobject', {
          name: flags.name,
          parentPath: flags.parent || flags['parent-path'] || null,
          scene: flags.scene || null,
        }, flags);
        break;
      }

      case 'delete-gameobject': {
        if (!flags['scene-object'] && !flags.asset) fail('--scene-object or --asset is required for delete-gameobject');
        const dgArgs = {};
        if (flags['scene-object']) {
          dgArgs.sceneObjectPath = flags['scene-object'];
        } else {
          const isGuidDG = /^[0-9a-f]{32}$/i.test(flags.asset);
          Object.assign(dgArgs, isGuidDG ? { guid: flags.asset } : { assetPath: flags.asset });
          if (!flags['child-path']) fail('--child-path is required when deleting from a prefab');
          dgArgs.childPath = flags['child-path'];
        }
        await submitCommand('delete_gameobject', dgArgs, flags);
        break;
      }

      case 'rename': {
        if (!flags['scene-object'] && !flags.asset) fail('--scene-object or --asset is required for rename');
        if (!flags.name) fail('--name is required for rename (the new name)');
        const rnArgs = { newName: flags.name };
        if (flags['scene-object']) {
          rnArgs.sceneObjectPath = flags['scene-object'];
        } else {
          const isGuidRN = /^[0-9a-f]{32}$/i.test(flags.asset);
          Object.assign(rnArgs, isGuidRN ? { guid: flags.asset } : { assetPath: flags.asset });
        }
        if (flags['child-path']) rnArgs.childPath = flags['child-path'];
        await submitCommand('rename_gameobject', rnArgs, flags);
        break;
      }

      case 'duplicate': {
        if (!flags['scene-object'] && !flags.asset) fail('--scene-object or --asset is required for duplicate');
        const dupArgs = {};
        if (flags['scene-object']) {
          dupArgs.sceneObjectPath = flags['scene-object'];
        } else {
          const isGuidDup = /^[0-9a-f]{32}$/i.test(flags.asset);
          Object.assign(dupArgs, isGuidDup ? { guid: flags.asset } : { assetPath: flags.asset });
        }
        if (flags['child-path']) dupArgs.childPath = flags['child-path'];
        if (flags.name) dupArgs.newName = flags.name;
        await submitCommand('duplicate', dupArgs, flags);
        break;
      }

      case 'instantiate-prefab': {
        if (!flags.asset) fail('--asset is required for instantiate-prefab');
        const isGuidIP = /^[0-9a-f]{32}$/i.test(flags.asset);
        const ipArgs = {
          ...(isGuidIP ? { guid: flags.asset } : { assetPath: flags.asset }),
        };
        if (flags.name) ipArgs.name = flags.name;
        if (flags.parent) ipArgs.parentPath = flags.parent;
        if (flags.position) {
          try { ipArgs.position = JSON.parse(flags.position); } catch { fail('--position must be valid JSON like {"x":0,"y":0,"z":0}'); }
        }
        if (flags.rotation) {
          try { ipArgs.rotation = JSON.parse(flags.rotation); } catch { fail('--rotation must be valid JSON like {"x":0,"y":0,"z":0}'); }
        }
        await submitCommand('instantiate_prefab', ipArgs, flags);
        break;
      }

      case 'inspect-hierarchy': {
        await submitCommand('inspect_hierarchy', {
          scene: flags.scene || null,
        }, flags);
        break;
      }

      case 'save-assets':
        await submitCommand('save_assets', {}, flags);
        break;

      case 'refresh-assets':
        await submitCommand('refresh_assets', {}, flags);
        break;

      case 'reimport-script':
      case 'reimport-scripts': {
        // Accept both spellings — "reimport-script" reads better with --path pointing
        // at a single .cs file; "reimport-scripts" reads better with a folder.
        if (!flags.path && !flags.asset) {
          fail('--path FILE_OR_FOLDER (or --asset PATH) is required for reimport-script');
        }
        const rsArgs = {
          path: flags.path || flags.asset,
          recursive: flags['non-recursive'] ? false : true,
        };
        await submitCommand('reimport_scripts', rsArgs, flags);
        break;
      }

      // ── Materials & shaders ───────────────────────────────────────────
      case 'create-material': {
        if (!flags.name) fail('--name is required for create-material');
        const cmArgs = { name: flags.name };
        if (flags.path) cmArgs.path = flags.path;
        if (flags.shader) cmArgs.shader = flags.shader;
        await submitCommand('create_material', cmArgs, flags);
        break;
      }

      case 'inspect-material': {
        if (!flags.asset) fail('--asset PATH_OR_GUID is required for inspect-material');
        const isGuid = /^[0-9a-f]{32}$/i.test(flags.asset);
        await submitCommand('inspect_material',
          isGuid ? { guid: flags.asset } : { assetPath: flags.asset },
          flags);
        break;
      }

      case 'set-material-property': {
        if (!flags.asset) fail('--asset PATH_OR_GUID is required for set-material-property');
        if (!flags.property && !flags.keyword) fail('--property NAME or --keyword NAME is required');
        const isGuid = /^[0-9a-f]{32}$/i.test(flags.asset);
        const mpArgs = isGuid ? { guid: flags.asset } : { assetPath: flags.asset };

        if (flags.keyword) {
          mpArgs.keyword = flags.keyword;
          // --enable true/false, default true
          mpArgs.enable = flags.enable !== 'false' && flags.enable !== false;
        } else {
          mpArgs.property = flags.property;
          if (flags.value === undefined) fail('--value is required when setting a material property');
          // Value is JSON (or a bare primitive for Float/Int). Same convention as set-property.
          try {
            mpArgs.value = typeof flags.value === 'string' ? JSON.parse(flags.value) : flags.value;
          } catch {
            // Not valid JSON — pass through as-is (float/int via string, texture-as-path, etc.)
            mpArgs.value = flags.value;
          }
        }
        await submitCommand('set_material_property', mpArgs, flags);
        break;
      }

      case 'set-material-shader': {
        if (!flags.asset) fail('--asset PATH_OR_GUID is required for set-material-shader');
        if (!flags.shader) fail('--shader "Shader/Name" is required');
        const isGuid = /^[0-9a-f]{32}$/i.test(flags.asset);
        const smArgs = isGuid ? { guid: flags.asset } : { assetPath: flags.asset };
        smArgs.shader = flags.shader;
        await submitCommand('set_material_shader', smArgs, flags);
        break;
      }

      case 'shader-status': {
        const ssArgs = {};
        if (flags.asset) {
          const isGuid = /^[0-9a-f]{32}$/i.test(flags.asset);
          if (isGuid) ssArgs.guid = flags.asset;
          else ssArgs.assetPath = flags.asset;
        }
        // No args = project-wide scan.
        await submitCommand('shader_status', ssArgs, flags);
        break;
      }

      case 'inspect-shader': {
        const insArgs = {};
        if (flags.shader) insArgs.shader = flags.shader;
        else if (flags.asset) {
          const isGuid = /^[0-9a-f]{32}$/i.test(flags.asset);
          if (isGuid) insArgs.guid = flags.asset;
          else insArgs.assetPath = flags.asset;
        } else {
          fail('--shader "Shader/Name" or --asset PATH_OR_GUID is required for inspect-shader');
        }
        await submitCommand('inspect_shader', insArgs, flags);
        break;
      }

      // ── Query commands (no submission, direct daemon query) ────────────
      case 'status': {
        await ensureDaemon();
        if (flags.id) {
          const resp = await httpRequest('GET', `/api/commands/${flags.id}`);
          if (resp.status >= 400) fail(resp.data.error || `HTTP ${resp.status}`);
          out(resp.data);
        } else {
          const resp = await httpRequest('GET', '/api/status');
          if (resp.status >= 400) fail(resp.data.error || `HTTP ${resp.status}`);
          // Default output is a one-line humanized summary because the raw
          // JSON is ~100 lines for a healthy state and the user's primary
          // question is usually "is anything wrong?". Use --json for the
          // raw payload, --verbose for both summary + JSON.
          if (flags.json) {
            out(resp.data);
          } else {
            const summary = summarizeStatus(resp.data);
            if (flags.verbose) {
              process.stdout.write(summary + '\n');
              out(resp.data);
            } else {
              process.stdout.write(summary + '\n');
            }
          }
        }
        break;
      }

      case 'queue': {
        await ensureDaemon();
        const params = new URLSearchParams();
        if (flags.state) params.set('state', flags.state);
        if (flags.task) params.set('originTaskId', flags.task);
        if (flags.limit) params.set('limit', flags.limit);
        const qs = params.toString();
        const resp = await httpRequest('GET', `/api/commands${qs ? '?' + qs : ''}`);
        if (resp.status >= 400) fail(resp.data.error || `HTTP ${resp.status}`);

        // Default view: non-terminal commands + the 5 most recent terminal
        // ones. This matches what the user asks 90% of the time ("what's
        // stuck, what just finished?") without drowning them in history.
        // --all forces the full list; --state/--task already narrow by themselves.
        const explicitFilter = flags.state || flags.task || flags.all || flags.limit;
        if (explicitFilter || flags.json) {
          out(resp.data);
          break;
        }
        const NON_TERMINAL = new Set(['queued', 'waiting', 'dispatched', 'running']);
        const all = resp.data.commands || [];
        const active = all.filter(c => NON_TERMINAL.has(c.state));
        const recentTerminal = all
          .filter(c => !NON_TERMINAL.has(c.state))
          .sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt))
          .slice(0, 5);
        out({
          totalInQueue: resp.data.count || all.length,
          activeCount: active.length,
          active,
          recentTerminal,
          hint: active.length === 0 && recentTerminal.length === 0
            ? 'Queue empty. Submit a command to populate.'
            : 'Pass --all for the full history, --json for raw output, or --state STATE / --task TASKID to filter.',
        });
        break;
      }

      case 'compile-status': {
        await ensureDaemon();
        const resp = await httpRequest('GET', '/api/compile-status');
        if (resp.status >= 400) fail(resp.data.error || `HTTP ${resp.status}`);
        out(resp.data);
        break;
      }

      case 'console': {
        await ensureDaemon();
        const count = flags.count || '50';
        const resp = await httpRequest('GET', `/api/console?count=${count}`);
        if (resp.status >= 400) fail(resp.data.error || `HTTP ${resp.status}`);
        out(resp.data);
        break;
      }

      case 'activity': {
        await ensureDaemon();
        // Build query string from optional flags: --limit N, --since DURATION, --state X.
        // --since accepts bare ms, or "Ns"/"Nm"/"Nh" for the common conversational durations.
        const params = [];
        const limit = parseInt(flags.limit, 10);
        if (Number.isFinite(limit) && limit > 0) params.push(`limit=${limit}`);
        if (flags.since) {
          const raw = String(flags.since).trim();
          const m = raw.match(/^(\d+)(ms|s|m|h)?$/);
          if (!m) fail(`--since must be a number followed by ms|s|m|h (e.g. "90s", "5m"); got "${raw}"`);
          const n = parseInt(m[1], 10);
          const unit = m[2] || 'ms';
          const multiplier = { ms: 1, s: 1000, m: 60000, h: 3600000 }[unit];
          params.push(`since=${n * multiplier}`);
        }
        if (flags.state) params.push(`state=${encodeURIComponent(flags.state)}`);
        const qs = params.length ? `?${params.join('&')}` : '';
        const resp = await httpRequest('GET', `/api/activity${qs}`);
        if (resp.status >= 400) fail(resp.data.error || `HTTP ${resp.status}`);
        out(resp.data);
        break;
      }

      // ── Daemon management ─────────────────────────────────────────────
      case 'daemon': {
        const sub = positional[1];
        switch (sub) {
          case 'start':
            await startDaemon();
            out({ ok: true, message: 'Daemon started' });
            break;
          case 'stop':
            await stopDaemon();
            out({ ok: true, message: 'Daemon stopped' });
            break;
          case 'status': {
            const running = await isDaemonRunning();
            if (running) {
              const resp = await httpRequest('GET', '/api/status');
              out({ running: true, ...resp.data });
            } else {
              out({ running: false });
            }
            break;
          }
          default:
            fail(`Unknown daemon subcommand: '${sub}'. Use: start, stop, status`);
        }
        break;
      }

      case 'registry': {
        const registry = require('./project-registry');
        const fsMod = require('fs');
        const sub = positional[1];
        const thisProjectRoot = path.resolve(__dirname, '..', '..');

        switch (sub) {
          case 'list': {
            const entries = registry.listEntries();
            out({
              registryPath: registry.getRegistryPath(),
              thisProject: thisProjectRoot,
              thisProjectPort: registry.getPortForProject(thisProjectRoot),
              entries,
            });
            break;
          }

          case 'remove': {
            const target = positional[2] || thisProjectRoot;
            const removed = registry.removeEntry(target);
            out({ removed, target });
            break;
          }

          case 'prune': {
            // Drop entries whose projectPath no longer exists on disk. The
            // registry holds absolute paths; a missing directory strongly
            // implies the Unity project was deleted or renamed, and the port
            // allocation is effectively garbage.
            const before = registry.listEntries();
            const dropped = [];
            for (const e of before) {
              if (!e.projectPath) continue;
              if (!fsMod.existsSync(e.projectPath)) {
                registry.removeEntry(e.projectPath);
                dropped.push({ projectPath: e.projectPath, port: e.port });
              }
            }
            out({ pruned: dropped.length, dropped });
            break;
          }

          case 'reassign': {
            if (!flags.port) fail('--port N is required for registry reassign');
            const newPort = parseInt(flags.port, 10);
            if (!Number.isInteger(newPort) || newPort <= 0 || newPort > 65535) {
              fail('--port must be a valid TCP port number');
            }
            const target = flags.project || thisProjectRoot;
            const reg = registry.load();
            const key = registry.normalizeProjectPath(target);
            if (!reg.projects[key]) {
              fail(`No registry entry for '${target}'. Run ./bin/dreamer status there first.`);
            }
            // Detect collisions with other registered projects.
            for (const otherKey of Object.keys(reg.projects)) {
              if (otherKey === key) continue;
              if (reg.projects[otherKey].port === newPort) {
                fail(`Port ${newPort} is already assigned to '${reg.projects[otherKey].projectPath}'.`);
              }
            }
            reg.projects[key].port = newPort;
            reg.projects[key].lastStartedAt = null;
            reg.projects[key].daemonPid = null;
            registry.save(reg);
            out({
              reassigned: true,
              projectPath: reg.projects[key].projectPath,
              port: newPort,
              note: 'Restart the daemon for this project (./bin/dreamer daemon stop && ./bin/dreamer status) and restart Unity (or reimport the bridge package) so both reread the new port.',
            });
            break;
          }

          default:
            fail(`Unknown registry subcommand: '${sub}'. Use: list, remove [path], prune, reassign --port N [--project PATH]`);
        }
        break;
      }

      case 'add-child-to-prefab': {
        if (!flags.asset) fail('--asset is required for add-child-to-prefab');
        if (!flags['child-name']) fail('--child-name is required for add-child-to-prefab');
        const isGuidACP = /^[0-9a-f]{32}$/i.test(flags.asset);
        await submitCommand('add_child_to_prefab', {
          ...(isGuidACP ? { guid: flags.asset } : { assetPath: flags.asset }),
          childName: flags['child-name'],
          parentPath: flags['parent-path'] || null,
        }, flags);
        break;
      }

      case 'save-as-prefab': {
        if (!flags['scene-object']) fail('--scene-object is required for save-as-prefab');
        await submitCommand('save_as_prefab', {
          sceneObjectPath: flags['scene-object'],
          savePath: flags.path || null,
          name: flags.name || null,
        }, flags);
        break;
      }

      case 'execute-menu-item': {
        const menuItem = positional[1];
        if (!menuItem) fail('Usage: dreamer execute-menu-item "GameObject/UI/Canvas"');
        await submitCommand('execute_menu_item', { menuItem }, flags);
        break;
      }

      case 'execute-method': {
        if (!flags.type) fail('--type is required for execute-method');
        if (!flags.method) fail('--method is required for execute-method');
        await submitCommand('execute_method', {
          typeName: flags.type,
          methodName: flags.method,
        }, flags);
        break;
      }

      case 'create-scene': {
        if (!flags.name) fail('--name is required for create-scene');
        await submitCommand('create_scene', {
          name: flags.name,
          path: flags.path || null,
          setActive: flags['set-active'] === true || flags['set-active'] === 'true' || false,
        }, flags);
        break;
      }

      case 'open-scene': {
        const scenePath = positional[1];
        if (!scenePath) fail('Usage: dreamer open-scene "Assets/Scenes/Level2.unity" [--mode single|additive]');
        await submitCommand('open_scene', {
          path: scenePath,
          mode: flags.mode || null,
        }, flags);
        break;
      }

      case 'save-scene': {
        await submitCommand('save_scene', {
          path: flags.path || null,
        }, flags);
        break;
      }

      case 'create-scriptable-object': {
        if (!flags.type) fail('--type is required for create-scriptable-object');
        if (!flags.name) fail('--name is required for create-scriptable-object');
        await submitCommand('create_scriptable_object', {
          typeName: flags.type,
          name: flags.name,
          path: flags.path || null,
        }, flags);
        break;
      }

      case 'create-hierarchy': {
        if (!flags.json) fail('--json is required for create-hierarchy');
        let hierarchy;
        try {
          hierarchy = JSON.parse(flags.json);
        } catch {
          fail('--json must be valid JSON');
        }
        // --save-path makes it a prefab instead of a scene object
        if (flags['save-path']) {
          hierarchy.savePath = flags['save-path'];
        }
        await submitCommand('create_hierarchy', hierarchy, flags);
        break;
      }

      case 'focus-unity': {
        const focused = await focusUnity();
        out({ focused });
        break;
      }

      case 'update': {
        const { spawnSync } = require('child_process');
        const os = require('os');
        const SOURCE_PATH = path.join(path.resolve(__dirname, '..'), '.dreamer-source.json');
        if (!fs.existsSync(SOURCE_PATH)) {
          fail('No daemon/.dreamer-source.json — self-update disabled. This Dreamer install was not produced by the installer, or the source file was deleted. Reinstall via https://github.com/AnttiJ73/Dreamer/blob/main/INSTALL.md, or pull manually.');
        }
        let source;
        try { source = JSON.parse(fs.readFileSync(SOURCE_PATH, 'utf8')); }
        catch (e) { fail(`Malformed .dreamer-source.json: ${e.message}`); }
        if (!source.repo) fail('.dreamer-source.json missing "repo" field');

        const ref = flags.ref || source.ref || 'main';
        const dryRun = flags['dry-run'] === true;
        const checkOnly = flags.check === true;
        const projectRoot = path.resolve(__dirname, '..', '..');

        // Verify git available
        const gitCheck = spawnSync('git', ['--version'], { stdio: 'ignore' });
        if (gitCheck.error || gitCheck.status !== 0) {
          fail('git not found on PATH. Install git and retry.');
        }

        // --check: just compare the installed SHA to the remote HEAD of `ref`.
        // No clone, no filesystem changes. Used by the SessionStart hook so
        // every Claude session begins with a quick freshness ping.
        if (checkOnly) {
          const remoteHead = spawnSync('git', ['ls-remote', source.repo, ref], {
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          if (remoteHead.status !== 0) {
            const err = (remoteHead.stderr && remoteHead.stderr.toString().trim()) || 'unknown error';
            fail(`git ls-remote failed for ${source.repo}@${ref}: ${err}`);
          }
          const remoteSha = remoteHead.stdout.toString().split(/\s+/)[0] || null;
          const installedSha = source.sha || null;
          const behind = installedSha && remoteSha && installedSha !== remoteSha;
          out({
            repo: source.repo,
            ref,
            installedSha,
            remoteSha,
            behind: !!behind,
            unknown: !installedSha,
            hint: behind
              ? `Dreamer is out of date on '${ref}'. Run './bin/dreamer update' to apply.`
              : installedSha
                ? 'Dreamer is up to date.'
                : 'No installed SHA recorded (this install predates sha-tracking). Run ./bin/dreamer update to stamp it.',
          });
          break;
        }

        // Clone shallow to temp dir
        const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'dreamer-update-'));
        const cloneDir = path.join(tmpBase, 'repo');
        const clone = spawnSync('git', ['clone', '--depth', '1', '--branch', ref, source.repo, cloneDir], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        if (clone.status !== 0) {
          const err = (clone.stderr && clone.stderr.toString().trim()) || (clone.stdout && clone.stdout.toString().trim()) || 'unknown error';
          try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch { /* ignore */ }
          fail(`git clone failed for ${source.repo}@${ref}: ${err}`);
        }

        // Resolve commit SHA
        const rev = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: cloneDir, stdio: ['ignore', 'pipe', 'pipe'] });
        const newSha = rev.status === 0 ? rev.stdout.toString().trim() : 'unknown';

        // Paths to replace (src inside clone → dst inside projectRoot)
        const targets = [
          { src: 'daemon/src', dst: 'daemon/src', type: 'dir' },
          { src: 'daemon/bin', dst: 'daemon/bin', type: 'dir' },
          { src: 'daemon/package.json', dst: 'daemon/package.json', type: 'file' },
          { src: 'Packages/com.dreamer.agent-bridge', dst: 'Packages/com.dreamer.agent-bridge', type: 'dir' },
          { src: '.claude/skills/dreamer/SKILL.md', dst: '.claude/skills/dreamer/SKILL.md', type: 'file' },
          { src: 'bin/dreamer', dst: 'bin/dreamer', type: 'file', chmod: 0o755 },
          { src: 'bin/dreamer.cmd', dst: 'bin/dreamer.cmd', type: 'file' },
        ];

        const missing = targets.filter((t) => !fs.existsSync(path.join(cloneDir, t.src)));
        if (missing.length > 0) {
          try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch { /* ignore */ }
          fail(`Source repo missing expected paths at ref '${ref}': ${missing.map((m) => m.src).join(', ')}`);
        }

        if (dryRun) {
          try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch { /* ignore */ }
          out({ dryRun: true, repo: source.repo, ref, sha: newSha, wouldReplace: targets.map((t) => t.dst) });
        }

        // Stop running daemon so we can swap its files safely
        try { await stopDaemon(); } catch { /* ignore */ }

        // Apply replacements
        const applied = [];
        for (const t of targets) {
          const srcAbs = path.join(cloneDir, t.src);
          const dstAbs = path.join(projectRoot, t.dst);
          if (t.type === 'dir') {
            if (fs.existsSync(dstAbs)) fs.rmSync(dstAbs, { recursive: true, force: true });
            fs.mkdirSync(path.dirname(dstAbs), { recursive: true });
            fs.cpSync(srcAbs, dstAbs, { recursive: true });
          } else {
            fs.mkdirSync(path.dirname(dstAbs), { recursive: true });
            fs.copyFileSync(srcAbs, dstAbs);
            if (t.chmod && process.platform !== 'win32') {
              try { fs.chmodSync(dstAbs, t.chmod); } catch { /* ignore */ }
            }
          }
          applied.push(t.dst);
        }

        // Cleanup
        try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch { /* ignore */ }

        // One-time migration: the dreamer CLI reference was relocated from
        // `.claude/commands/dreamer.md` (slash-command, user-invoked only) to
        // `.claude/skills/dreamer/SKILL.md` (skill, auto-loaded by Claude when
        // Unity work appears). Remove the legacy file if it's still there so
        // both forms don't coexist in installs that pre-date the move.
        const legacyCommandPath = path.join(projectRoot, '.claude/commands/dreamer.md');
        const migrated = [];
        try {
          if (fs.existsSync(legacyCommandPath)) {
            fs.rmSync(legacyCommandPath, { force: true });
            migrated.push('.claude/commands/dreamer.md (removed — superseded by .claude/skills/dreamer/SKILL.md)');
            // Also try to remove the now-empty commands dir. Safe because rmdir
            // only succeeds if empty; if the user keeps other commands there,
            // this silently no-ops.
            try { fs.rmdirSync(path.join(projectRoot, '.claude/commands')); } catch { /* keep dir if non-empty */ }
          }
        } catch { /* non-fatal */ }

        // Stamp the installed SHA into .dreamer-source.json so `update --check`
        // can detect drift cheaply via ls-remote on subsequent runs.
        try {
          const updatedSource = { ...source, ref, sha: newSha, lastUpdatedAt: new Date().toISOString() };
          fs.writeFileSync(SOURCE_PATH, JSON.stringify(updatedSource, null, 2) + '\n', 'utf8');
        } catch { /* non-fatal: next update will re-stamp */ }

        out({
          updated: true,
          repo: source.repo,
          ref,
          sha: newSha,
          replaced: applied,
          migrated,
          preserved: ['daemon/.dreamer-config.json', 'daemon/.dreamer-source.json', 'daemon/.dreamer-queue.json'],
          note: 'Daemon stopped; it will auto-restart on the next dreamer command. Unity may need a moment to reimport the updated package.',
        });
        break;
      }

      case 'config': {
        const sub = positional[1];
        if (sub === 'set' && positional[2]) {
          const [key, ...rest] = positional[2].split('=');
          const val = rest.join('=');
          if (!key || val === '') fail('Usage: dreamer config set key=value');
          const cfg = loadConfig();
          // Parse value: booleans, numbers, or string
          let parsed = val;
          if (val === 'true') parsed = true;
          else if (val === 'false') parsed = false;
          else if (!isNaN(val) && val.trim() !== '') parsed = Number(val);
          cfg[key] = parsed;
          configModule.save(cfg);
          out({ set: key, value: parsed, configPath: CONFIG_PATH });
        } else if (sub === 'get') {
          out(loadConfig());
        } else {
          out({
            usage: 'dreamer config get | dreamer config set key=value',
            current: loadConfig(),
            configPath: CONFIG_PATH,
          });
        }
        break;
      }

      case 'help': {
        const kind = positional[1];
        if (!kind) {
          out({
            usage: 'dreamer help <kind>',
            documented: schemas.list(),
            note: 'Only kinds listed in "documented" have a schema so far. All other kinds still work; they just lack machine-readable arg docs. Run `dreamer --help` for the full CLI command list.',
          });
        }
        const schema = schemas.get(kind);
        if (!schema) {
          fail(`No schema for '${kind}'. Documented kinds: ${schemas.list().join(', ')}`);
        }
        out(schema);
        break;
      }

      case 'probe-port': {
        // Largely superseded by the projects registry's automatic port
        // allocation, but still useful as a "what would be picked next"
        // diagnostic — e.g., during install for a bespoke port override.
        const start = parseInt(flags.start, 10) || configModule.DEFAULT_PORT;
        const count = parseInt(flags.count, 10) || 10;
        const free = await configModule.findFreePort(start, count);
        if (free === null) {
          fail(`No free port in [${start}, ${start + count}). Pass --start / --count to widen the range.`);
        }
        const reg = require('./project-registry');
        const entry = reg.findEntry(reg.load(), path.resolve(__dirname, '..', '..'));
        out({
          nextFreePort: free,
          probedRange: [start, start + count - 1],
          thisProjectAlreadyRegistered: !!entry,
          thisProjectPort: entry ? entry.port : null,
          note: entry
            ? 'This project already has a registry entry; the daemon will use the registered port, not nextFreePort.'
            : 'Next `./bin/dreamer status` from this project root will register this port (or another free one if this is taken by then).',
        });
        break;
      }

      case 'log': {
        const sub = positional[1] || 'tail';
        const DAEMON_LOG = path.join(path.resolve(__dirname, '..'), '.dreamer-daemon.log');
        if (!fs.existsSync(DAEMON_LOG)) {
          fail(`No daemon log at ${DAEMON_LOG}. The daemon may not have been started yet.`);
        }
        if (sub === 'path') {
          out({ path: DAEMON_LOG });
          break;
        }
        if (sub === 'tail') {
          const n = parseInt(flags.n, 10) || 30;
          const raw = fs.readFileSync(DAEMON_LOG, 'utf8');
          const lines = raw.split(/\r?\n/).filter(Boolean);
          const tail = lines.slice(-n);
          // Pretty-print each JSON line to `ISO LEVEL module — msg`; fall
          // back to raw if a line isn't JSON (startup banner, etc.).
          const pretty = tail.map((l) => {
            try {
              const e = JSON.parse(l);
              return `${e.ts || '?'}  ${(e.level || 'info').padEnd(5)} ${(e.module || '-').padEnd(16)} ${e.msg || ''}`;
            } catch {
              return l;
            }
          }).join('\n');
          process.stdout.write(pretty + '\n');
          process.exit(0);
        }
        fail(`Unknown log subcommand: '${sub}'. Use: tail [--n N], path.`);
        break;
      }

      default:
        fail(`Unknown command: '${command}'. Run 'dreamer --help' for usage.`);
    }
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      fail('Cannot connect to daemon. Is it running? Try: dreamer daemon start');
    }
    fail(err.message);
  }
}

module.exports = { run };
