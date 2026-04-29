'use strict';

const fs = require('fs');
const path = require('path');

// Install-time marker recording repo URL/ref/SHA/installed add-ons. Read by both `update` and `addon`.
const SOURCE_PATH = path.join(path.resolve(__dirname, '..'), '.dreamer-source.json');
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

/** Humanized 1-2 line summary of /api/status — bad news first, healthy state last. */
function summarizeStatus(data) {
  if (!data || typeof data !== 'object') return 'PROBLEM: malformed status response';
  const d = data.daemon || {};
  const u = data.unity || {};
  const q = data.queue || {};
  const s = data.scheduler || {};

  const parts = [];
  let verdict = 'OK';

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

  const nonTerminal = (q.queued || 0) + (q.waiting || 0) + (q.running || 0) + (q.dispatched || 0);
  if (nonTerminal === 0) {
    parts.push(`${q.total || 0} total / 0 in flight`);
  } else {
    const stuck = (q.active || []).filter(a => a.sinceUpdateMs && a.sinceUpdateMs > 60000);
    if (stuck.length > 0) verdict = 'PROBLEM';
    parts.push(`${nonTerminal} in flight${stuck.length ? ` (${stuck.length} stuck > 1m)` : ''}`);
  }

  if (s && s.lastTickAge && s.lastTickAge.ageMs > (s.tickIntervalMs || 200) * 10) {
    verdict = 'PROBLEM';
    parts.push(`scheduler frozen ${s.lastTickAge.ageHuman}`);
  } else if (s && s.totalDispatched != null) {
    parts.push(`${s.totalDispatched} dispatched in ${d.uptimeHuman || '?'}`);
  }

  let line = `${verdict}: ${parts.join(', ')}.`;

  if (verdict === 'PROBLEM' && q.active && q.active.length) {
    const worst = q.active.slice().sort((a, b) => (b.sinceUpdateMs || 0) - (a.sinceUpdateMs || 0))[0];
    if (worst) {
      line += `\n  Stuck: ${worst.kind} (${worst.state}) for ${worst.sinceUpdateHuman}${worst.waitingReason ? ` — ${worst.waitingReason}` : ''}`;
    }
  }
  return line;
}

/** Parse argv: handles --flag value, --flag=value, --bool-flag (no value → true). */
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

// Git-Bash on Windows silently rewrites leading-slash paths via MSYS_ARG_CONV_EXCL:
// `--scene-object /MainMenuCanvas` becomes `C:/Program Files/Git/MainMenuCanvas`,
// which the daemon then reports as a mysterious "not found". Detect and auto-correct.
const SCENE_PATH_FLAGS = new Set(['scene-object', 'parent', 'parent-path']);
function maybeDetectGitBashPath(flagName, value) {
  if (typeof value !== 'string') return value;
  if (!SCENE_PATH_FLAGS.has(flagName)) return value;
  const translated = /^([A-Za-z]:[\\/]Program Files[\\/]Git[\\/])(.+)$/i;
  const m = value.match(translated);
  if (m) {
    const fixed = '/' + m[2].replace(/\\/g, '/');
    process.stderr.write(
      `warn: --${flagName}='${value}' was Git-Bash path-translated;\n` +
      `      auto-corrected to '${fixed}'. Drop the leading '/' (e.g. '${fixed.slice(1)}')\n` +
      `      or use '//' to avoid translation entirely.\n`
    );
    return fixed;
  }
  return value;
}

// In smart mode, how long a --wait command may sit before we conclude Unity's
// main thread is frozen and focus-steal to unstick it. Override via --focus-after
// or config.focusStallMs.
const DEFAULT_FOCUS_STALL_MS = 5000;

const TERMINAL_STATES = new Set(['succeeded', 'failed', 'blocked', 'cancelled']);

/** True for errors that signal "Unity hasn't imported recent .cs" rather than user typo. */
function isStaleAssetError(errorMsg) {
  if (!errorMsg || typeof errorMsg !== 'string') return false;
  return /^Type not found:/i.test(errorMsg)
      || /^Property '.+' not found on/i.test(errorMsg);
}

/** Auto-prepend refresh-assets before a compile-gated command if the watcher's dirty. */
async function maybeAutoRefreshAssets(kind, flags) {
  if (flags['no-refresh'] === true) return;
  if (config.autoRefresh === false) return;
  const def = KIND_DEFS[kind];
  if (!def || !def.requirements || def.requirements.compilation !== true) return;
  if (kind === 'refresh_assets') return;

  let statusResp;
  try {
    statusResp = await httpRequest('GET', '/api/status');
  } catch { return; /* daemon not reachable; let submit fail naturally */ }
  const dirty = statusResp && statusResp.data && statusResp.data.assets && statusResp.data.assets.dirty;
  if (!dirty) return;

  // Use the API directly, not submitCommand — avoids double-focus / re-entering this path.
  const refreshResp = await httpRequest('POST', '/api/commands', {
    kind: 'refresh_assets',
    args: {},
    options: { humanLabel: 'Auto-refresh (stale asset DB)' },
  });
  if (refreshResp.status >= 400) return;
  const refreshId = refreshResp.data.id;

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
    // Surface daemon-supplied source/hint/details in addition to the bare error.
    const e = (resp.data && resp.data.error) || `HTTP ${resp.status}`;
    const parts = [e];
    if (resp.data && resp.data.source) parts.push(`(source: ${resp.data.source})`);
    if (resp.data && resp.data.hint) parts.push(`hint: ${resp.data.hint}`);
    if (resp.data && Array.isArray(resp.data.details) && resp.data.details.length) {
      parts.push(`details: ${resp.data.details.join('; ')}`);
    }
    fail(parts.join('\n'));
  }

  const cmd = resp.data;

  if (flags.wait) {
    // In smart mode, Unity's main thread fully halts when unfocused (not
    // slow — stopped). If we don't hit terminal within the stall window,
    // focus once to unstick it.
    const pollInterval = 500;
    const timeout = parseInt(flags['wait-timeout'], 10) || 120000;
    const stallMs = focusPolicy.shouldFallbackFocus(flags, config, focusedUpfront)
      ? (parseInt(flags['focus-after'], 10) || config.focusStallMs || DEFAULT_FOCUS_STALL_MS)
      : Infinity;
    const start = Date.now();
    const deadline = start + timeout;
    let hasFallbackFocused = false;

    while (Date.now() < deadline) {
      await sleep(pollInterval);

      if (!hasFallbackFocused && (Date.now() - start) >= stallMs) {
        hasFallbackFocused = true;
        await focusUnity();
      }

      const check = await httpRequest('GET', `/api/commands/${cmd.id}`);
      if (check.status === 404) {
        // Most commonly: the daemon restarted since submit. Compare uptime
        // vs command age to confirm and give an actionable error vs raw 404.
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
        // "Type not found" / "Property not found" almost always means the agent
        // wrote .cs directly and skipped refresh-assets, not that they typoed.
        if (current.state === 'failed' && current.error && isStaleAssetError(current.error)) {
          process.stderr.write(JSON.stringify({
            error: current.error,
            commandId: current.id,
            kind: current.kind,
            hint: 'This error usually means Unity has not imported recent .cs changes. If you wrote or edited a script directly (not via `./bin/dreamer create-script`), run `./bin/dreamer refresh-assets --wait` and then `./bin/dreamer compile-status` before re-running this command. Unity must be focused to compile, so you may also need `./bin/dreamer focus-unity`.',
          }, null, 2) + '\n');
          process.exit(1);
        }
        // UGUI add-on missing — point at the install prompt vs the generic error.
        if (current.state === 'failed'
            && current.error
            && /^Unknown command kind:\s*(create_ui_tree|inspect_ui_tree|set_rect_transform)/.test(current.error)) {
          process.stderr.write(JSON.stringify({
            error: current.error,
            commandId: current.id,
            kind: current.kind,
            hint: 'The uGUI add-on (com.dreamer.agent-bridge.ugui) is not installed in this project. Ask the user to run: *"Install the Dreamer UGUI add-on"* to enable UI Canvas building commands.',
          }, null, 2) + '\n');
          process.exit(1);
        }
        out(current);
        return;
      }

      // Short-circuit dead-wait — polling can't succeed without external action.
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

// Returns headings + bullets present in new CHANGELOG.md but not in old.
// `update` exposes these so the agent can read changes back to the user.
function computeChangelogDiff(oldText, newPath) {
  let newText = null;
  try { newText = require('fs').readFileSync(newPath, 'utf8'); } catch { return null; }
  if (!newText) return null;
  if (oldText === newText) return { unchanged: true, newEntries: [] };
  const oldLines = new Set((oldText || '').split(/\r?\n/));
  const isMeaningful = (l) =>
    /^- /.test(l) || /^  - /.test(l) || /^### /.test(l) || /^## /.test(l);
  const added = [];
  for (const line of newText.split(/\r?\n/)) {
    if (oldLines.has(line)) continue;
    if (!isMeaningful(line)) continue;
    added.push(line);
  }
  return { unchanged: false, newEntries: added };
}

// ── Command routing ──────────────────────────────────────────────────────────

/** Main CLI dispatch — argv is process.argv.slice(2). */
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
        'delete-gameobject (--scene-object PATH | --asset PATH --child-path PATH)',
        'rename (--scene-object PATH | --asset PATH [--child-path PATH]) --name NEW_NAME',
        'set-layer (--scene-object PATH | --asset PATH [--child-path PATH]) --layer NAME_OR_INDEX [--recursive]   (USE THIS instead of `set-property --property m_Layer`; layer name auto-resolves)',
        'reparent (--scene-object PATH | --asset PREFAB --child-path SOURCE) [--new-parent PATH] [--keep-world-space true|false] [--sibling-index N]   (omit --new-parent to move to root; prefab paths are relative to the prefab root)',
        'save-assets    (writes both dirty open scenes AND ScriptableObjects/prefabs/materials)',
        'reimport-script --path FILE_OR_FOLDER [--non-recursive]   (force re-import of .cs files Unity misclassified as unknown)',
        'create-material --name NAME [--path FOLDER] [--shader "Shader/Name"]',
        'inspect-material --asset PATH_OR_GUID',
        'set-material-property --asset PATH_OR_GUID (--property NAME --value JSON | --keyword NAME [--enable true|false])',
        'set-material-shader --asset PATH_OR_GUID --shader "Shader/Name"',
        'set-particle-property (--scene-object PATH | --asset PATH [--child-path SUBPATH]) --property MODULE.FIELD --value JSON   (ParticleSystem module fields: main.startLifetime, emission.rateOverTime, shape.angle, …)',
        'shader-status [--asset PATH_OR_GUID]    (no arg = project-wide scan)',
        'inspect-shader (--asset PATH_OR_GUID | --shader "Shader/Name")',
        '── uGUI add-on (install com.dreamer.agent-bridge.ugui separately) ──',
        'create-ui-tree --json JSON_OR_@file.json    (declarative tree: mode=create|append|replace-children|replace-self)',
        'inspect-ui-tree --target PATH [--depth N] [--include-raw true|false] [--include-rect true|false]',
        'set-rect-transform (--scene-object PATH | --asset PATH) [--anchor PRESET] [--size WxH] [--pivot X,Y] [--offset X,Y]',
        '── Animation add-on (install com.dreamer.agent-bridge.animation separately) ──',
        'create-animation-clip --name NAME [--path FOLDER] [--frame-rate N] [--loop true|false]',
        'set-animation-curve --asset PATH_OR_GUID [--target SUB] --component TYPENAME --property PATH --keys JSON',
        'inspect-animation-clip --asset PATH_OR_GUID',
        'sample-animation-curve --asset PATH_OR_GUID [--target SUB] --component TYPENAME --property PATH [--samples N] [--t-start N] [--t-end N]',
        'delete-animation-curve --asset PATH_OR_GUID [--target SUB] --component TYPENAME --property PATH',
        'set-sprite-curve --asset PATH_OR_GUID [--target SUB] [--component TYPENAME] [--property NAME] --keys JSON   (sprite-swap; defaults to SpriteRenderer.m_Sprite)',
        'delete-sprite-curve --asset PATH_OR_GUID [--target SUB] [--component TYPENAME] [--property NAME]',
        'set-animation-events --asset PATH_OR_GUID --events JSON   (replaces ALL events; pass [] to clear)',
        'create-animator-controller --name NAME [--path FOLDER]',
        'add-animator-parameter --asset PATH_OR_GUID --name NAME --type bool|int|float|trigger [--default V]',
        'add-animator-state --asset PATH_OR_GUID --name NAME [--layer N] [--motion CLIP_PATH] [--speed N]',
        'add-animator-transition --asset PATH_OR_GUID --from STATE --to STATE [--layer N] [--has-exit-time true|false] [--exit-time N] [--duration N] [--conditions JSON]',
        'set-animator-default-state --asset PATH_OR_GUID --state NAME [--layer N]',
        'inspect-animator-controller --asset PATH_OR_GUID',
        'remove-animator-parameter --asset PATH_OR_GUID --name NAME [--force]',
        'remove-animator-state --asset PATH_OR_GUID --name NAME [--layer N]',
        'remove-animator-transition --asset PATH_OR_GUID --from STATE --to STATE [--layer N] [--index N]',
        'update-animator-state --asset PATH_OR_GUID --name NAME [--layer N] [--rename NEW] [--motion CLIP] [--speed N] [--mirror T] [--cycle-offset N] [--write-defaults T]',
        'update-animator-transition --asset PATH_OR_GUID --from STATE --to STATE [--layer N] [--index N] [--has-exit-time T] [--exit-time N] [--duration N] [--offset N] [--can-self T] [--interruption-source SRC] [--conditions JSON]',
        'add-animator-layer --asset PATH_OR_GUID --name NAME [--weight N] [--blending Override|Additive] [--mask AVATAR_MASK_PATH] [--ik-pass T]',
        'remove-animator-layer --asset PATH_OR_GUID --layer N',
        'set-animator-layer --asset PATH_OR_GUID --layer N [--name X] [--weight N] [--blending B] [--mask P] [--ik-pass T] [--synced-layer N] [--sync-timing T]',
        'add-animator-blend-tree --asset PATH_OR_GUID --name STATE --type 1d|2d-simple|2d-freeform-directional|2d-freeform-cartesian|direct [--layer N] [--blend-parameter P] [--blend-parameter-y P] [--children JSON]',
        'create-avatar-mask --name X [--path FOLDER] [--humanoid JSON] [--transforms JSON]',
        'set-avatar-mask --asset PATH_OR_GUID [--humanoid JSON] [--transforms JSON]',
        'inspect-avatar-mask --asset PATH_OR_GUID',
        'create-animator-override-controller --name X --base BASE_CONTROLLER [--path FOLDER]',
        'set-animator-override-clip --asset PATH_OR_GUID (--base-clip ORIG --override-clip NEW | --overrides JSON)',
        'inspect-animator-override-controller --asset PATH_OR_GUID',
        'status [--id CMD_ID]',
        'queue [--state STATE] [--task TASK_ID]',
        'cancel <id> | cancel --state waiting|queued | cancel --task TASKID   (cancel one command, or flush all matching non-terminal commands)',
        'compile-status',
        'console [--count N]',
        'activity [--limit N] [--since 90s|5m|1h] [--state X]   (recent commands across the queue, newest first — multi-agent visibility)',
        'add-child-to-prefab --asset PATH_OR_GUID --child-name NAME [--parent-path SUBPATH]',
        'save-as-prefab --scene-object NAME [--path FOLDER] [--name PREFABNAME]',
        'execute-menu-item "MenuItem/Path"',
        'execute-method --type TYPENAME --method METHODNAME',
        'set-play-mode --state enter|exit|toggle|pause|unpause|toggle-pause   (use this instead of execute-menu-item Edit/Play; gated by per-machine policy set on first bridge start)',
        'inspect-project-settings [--file NAME]   (overview of layers/tags/sorting layers/physics; per-file field listing when --file is set)',
        'set-layer-name --index N --name NAME [--force]',
        'clear-layer --index N [--force]',
        'add-tag --name NAME',
        'remove-tag --name NAME',
        'add-sorting-layer --name NAME',
        'remove-sorting-layer --name NAME',
        'set-layer-collision --layer-a A --layer-b B [--collide true|false] [--2d]',
        'set-physics-gravity --value [x,y,z] [--2d]',
        'set-project-setting --file NAME --property PATH --value JSON   (generic editor for any ProjectSettings/*.asset file)',
        'inspect-project-setting --file NAME [--property PATH] [--depth N]',
        'inspect-player-settings [--target standalone|android|ios|webgl|...]   (PlayerSettings via static API: identity, screen, cursor, icons, scripting)',
        'set-app-id --target NAME --id com.foo.bar   (per-platform application/bundle identifier)',
        'set-default-icon --texture Assets/path.png   (Default Icon slot — Unity scales to all platforms)',
        'set-app-icons --target NAME --textures \'["p1","p2",...]\'   (per-platform icon array, sized as Unity expects)',
        'set-cursor-icon --texture Assets/path.png [--hotspot [x,y]]   (Default Cursor + click-point hotspot)',
        'inspect-build-scenes',
        'set-build-scenes --scenes JSON   (replace whole list; items are paths or {path, enabled})',
        'add-build-scene --scene PATH [--enabled false]   (append; updates enabled flag if already present)',
        'remove-build-scene --scene PATH',
        'screenshot-prefab --asset Assets/X.prefab [--width 512] [--height 512] [--angle iso|front|side|top|...] [--save-to PATH]   (renders to PNG; open with Read tool to view)',
        'screenshot-scene [--camera "Main Camera"|"/Path"] [--preset layout|normal|text] [--width N] [--height N] [--filter-mode point|bilinear|trilinear] [--background-color HEX] [--transparent] [--save-to PATH]   (renders any scene Camera to PNG; auto-flips overlay canvases)',
        'create-scene --name NAME [--path FOLDER] [--set-active]',
        'open-scene PATH [--mode single|additive]',
        'save-scene [--path PATH]',
        'create-scriptable-object --type TYPENAME --name NAME [--path FOLDER]',
        'create-hierarchy --json JSON',
        'daemon start|stop|status',
        'registry list|remove [path]|prune|reassign --port N [--project PATH]',
        'update [--ref REF] [--dry-run] [--check]',
        'addon list | addon install <name> | addon remove <name>    (manage optional add-ons like ugui)',
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
        const inspectArgs = {};
        if (flags.depth !== undefined) inspectArgs.depth = parseInt(flags.depth, 10);
        if (flags['include-transforms']) inspectArgs.includeTransforms = true;
        if (flags['include-fields']) inspectArgs.includeFields = true;
        if (flags['scene-object']) {
          inspectArgs.sceneObjectPath = flags['scene-object'];
          await submitCommand('inspect_asset', inspectArgs, flags);
        } else {
          const target = positional[1];
          if (!target) fail('Usage: dreamer inspect <path-or-guid> [--depth N] [--include-transforms] [--include-fields] OR dreamer inspect --scene-object NAME');
          const isGuid = /^[0-9a-f]{32}$/i.test(target);
          Object.assign(inspectArgs, isGuid ? { guid: target } : { assetPath: target });
          await submitCommand('inspect_asset', inspectArgs, flags);
        }
        break;
      }

      case 'inspect-many': {
        const raw = flags.paths || flags.path;
        if (!raw) fail('Usage: dreamer inspect-many --paths a.prefab,b.prefab,c.prefab [--depth N] [--include-transforms] [--include-fields]');
        const paths = String(raw).split(',').map(s => s.trim()).filter(Boolean);
        if (paths.length === 0) fail('--paths must list at least one asset path.');
        const imArgs = { paths };
        if (flags.depth !== undefined) imArgs.depth = parseInt(flags.depth, 10);
        if (flags['include-transforms']) imArgs.includeTransforms = true;
        if (flags['include-fields']) imArgs.includeFields = true;
        await submitCommand('inspect_assets', imArgs, flags);
        break;
      }

      case 'read-property': {
        if (!flags.asset && !flags['scene-object']) fail('--asset or --scene-object is required for read-property');
        if (!flags.property) fail('--property is required for read-property');
        const rpArgs = {
          componentType: flags.component || null,
          propertyPath: flags.property,
        };
        if (flags['scene-object']) {
          rpArgs.sceneObjectPath = flags['scene-object'];
        } else {
          const isGuidRP = /^[0-9a-f]{32}$/i.test(flags.asset);
          Object.assign(rpArgs, isGuidRP ? { guid: flags.asset } : { assetPath: flags.asset });
        }
        if (flags['child-path']) rpArgs.childPath = flags['child-path'];
        await submitCommand('read_property', rpArgs, flags);
        break;
      }

      case 'create-script': {
        let csName = flags.name;
        let csPath = flags.path || null;
        // Accept full file path in --path (e.g. "Assets/Scripts/Foo/Bar.cs") —
        // split into parent folder + class name; reject if --name disagrees.
        if (csPath && /\.cs$/i.test(csPath)) {
          const norm = csPath.replace(/\\/g, '/').replace(/\/+$/, '');
          const slash = norm.lastIndexOf('/');
          const fileBase = (slash < 0 ? norm : norm.slice(slash + 1)).replace(/\.cs$/i, '');
          const parent = slash < 0 ? '' : norm.slice(0, slash);
          if (!csName) csName = fileBase;
          else if (csName !== fileBase) {
            fail(`--path ends in '${norm.slice(slash + 1)}' but --name is '${csName}'. Pass --path as a folder (e.g. '${parent}'), not a file path.`);
          }
          csPath = parent || 'Assets';
        }
        if (!csName) fail('--name is required for create-script');
        await submitCommand('create_script', {
          name: csName,
          namespace: flags.namespace || null,
          template: flags.template || 'monobehaviour',
          path: csPath,
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

      case 'create-animation-clip': {
        if (!flags.name) fail('--name is required for create-animation-clip');
        const cacArgs = { name: flags.name };
        if (flags.path) cacArgs.path = flags.path;
        if (flags['frame-rate'] !== undefined) cacArgs.frameRate = parseFloat(flags['frame-rate']);
        if (flags.loop !== undefined) cacArgs.loop = flags.loop === 'true' || flags.loop === true;
        await submitCommand('create_animation_clip', cacArgs, flags);
        break;
      }

      case 'set-animation-curve': {
        if (!flags.asset) fail('--asset PATH_OR_GUID is required for set-animation-curve');
        if (!flags.component) fail('--component TYPENAME is required');
        if (!flags.property) fail('--property NAME is required');
        if (flags.keys === undefined) fail('--keys JSON is required (array of {t, v, interp?, ...})');
        let parsedKeys;
        try { parsedKeys = JSON.parse(flags.keys); }
        catch (e) { fail('--keys must be valid JSON: ' + e.message); }
        const sacArgs = {
          target: typeof flags.target === 'string' ? flags.target : '',
          componentType: flags.component,
          propertyName: flags.property,
          keys: parsedKeys,
        };
        const isGuidSAC = /^[0-9a-f]{32}$/i.test(flags.asset);
        Object.assign(sacArgs, isGuidSAC ? { guid: flags.asset } : { assetPath: flags.asset });
        await submitCommand('set_animation_curve', sacArgs, flags);
        break;
      }

      case 'inspect-animation-clip': {
        if (!flags.asset) fail('--asset PATH_OR_GUID is required for inspect-animation-clip');
        const isGuidIAC = /^[0-9a-f]{32}$/i.test(flags.asset);
        const iacArgs = isGuidIAC ? { guid: flags.asset } : { assetPath: flags.asset };
        await submitCommand('inspect_animation_clip', iacArgs, flags);
        break;
      }

      case 'sample-animation-curve': {
        if (!flags.asset) fail('--asset PATH_OR_GUID is required for sample-animation-curve');
        if (!flags.component) fail('--component TYPENAME is required');
        if (!flags.property) fail('--property NAME is required');
        const samACArgs = {
          target: typeof flags.target === 'string' ? flags.target : '',
          componentType: flags.component,
          propertyName: flags.property,
        };
        if (flags.samples !== undefined) samACArgs.samples = parseInt(flags.samples, 10);
        if (flags['t-start'] !== undefined) samACArgs.tStart = parseFloat(flags['t-start']);
        if (flags['t-end']   !== undefined) samACArgs.tEnd   = parseFloat(flags['t-end']);
        const isGuidSamAC = /^[0-9a-f]{32}$/i.test(flags.asset);
        Object.assign(samACArgs, isGuidSamAC ? { guid: flags.asset } : { assetPath: flags.asset });
        await submitCommand('sample_animation_curve', samACArgs, flags);
        break;
      }

      case 'set-sprite-curve': {
        if (!flags.asset) fail('--asset PATH_OR_GUID is required for set-sprite-curve');
        if (flags.keys === undefined) fail('--keys JSON is required (array of {time, sprite} objects)');
        let parsedSCKeys;
        try { parsedSCKeys = JSON.parse(flags.keys); }
        catch (e) { fail('--keys must be valid JSON: ' + e.message); }
        const scArgs = {
          target: typeof flags.target === 'string' ? flags.target : '',
          keys: parsedSCKeys,
        };
        if (flags.component) scArgs.componentType = flags.component;
        if (flags.property)  scArgs.propertyName  = flags.property;
        const isGuidSC = /^[0-9a-f]{32}$/i.test(flags.asset);
        Object.assign(scArgs, isGuidSC ? { guid: flags.asset } : { assetPath: flags.asset });
        await submitCommand('set_sprite_curve', scArgs, flags);
        break;
      }

      case 'delete-sprite-curve': {
        if (!flags.asset) fail('--asset PATH_OR_GUID is required for delete-sprite-curve');
        const dscArgs = {
          target: typeof flags.target === 'string' ? flags.target : '',
        };
        if (flags.component) dscArgs.componentType = flags.component;
        if (flags.property)  dscArgs.propertyName  = flags.property;
        const isGuidDSC = /^[0-9a-f]{32}$/i.test(flags.asset);
        Object.assign(dscArgs, isGuidDSC ? { guid: flags.asset } : { assetPath: flags.asset });
        await submitCommand('delete_sprite_curve', dscArgs, flags);
        break;
      }

      case 'set-animation-events': {
        if (!flags.asset) fail('--asset PATH_OR_GUID is required for set-animation-events');
        if (flags.events === undefined) fail('--events JSON is required (array; pass [] to clear)');
        let parsedEvents;
        try { parsedEvents = JSON.parse(flags.events); }
        catch (e) { fail('--events must be valid JSON: ' + e.message); }
        const seArgs = { events: parsedEvents };
        const isGuidSE = /^[0-9a-f]{32}$/i.test(flags.asset);
        Object.assign(seArgs, isGuidSE ? { guid: flags.asset } : { assetPath: flags.asset });
        await submitCommand('set_animation_events', seArgs, flags);
        break;
      }

      case 'delete-animation-curve': {
        if (!flags.asset) fail('--asset PATH_OR_GUID is required for delete-animation-curve');
        if (!flags.component) fail('--component TYPENAME is required');
        if (!flags.property) fail('--property NAME is required');
        const dacArgs = {
          target: typeof flags.target === 'string' ? flags.target : '',
          componentType: flags.component,
          propertyName: flags.property,
        };
        const isGuidDAC = /^[0-9a-f]{32}$/i.test(flags.asset);
        Object.assign(dacArgs, isGuidDAC ? { guid: flags.asset } : { assetPath: flags.asset });
        await submitCommand('delete_animation_curve', dacArgs, flags);
        break;
      }

      case 'create-animator-controller': {
        if (!flags.name) fail('--name is required for create-animator-controller');
        const cacArgs = { name: flags.name };
        if (flags.path) cacArgs.path = flags.path;
        await submitCommand('create_animator_controller', cacArgs, flags);
        break;
      }

      case 'add-animator-parameter': {
        if (!flags.asset) fail('--asset PATH_OR_GUID is required');
        if (!flags.name) fail('--name is required');
        const apArgs = { name: flags.name, type: flags.type || 'bool' };
        if (flags.default !== undefined) {
          let d = flags.default;
          // Coerce common shorthand: "true"/"false" → bool, numerics → number.
          if (d === 'true') d = true;
          else if (d === 'false') d = false;
          else if (typeof d === 'string' && /^-?\d+(\.\d+)?$/.test(d)) d = parseFloat(d);
          apArgs.default = d;
        }
        const isGuidAP = /^[0-9a-f]{32}$/i.test(flags.asset);
        Object.assign(apArgs, isGuidAP ? { guid: flags.asset } : { assetPath: flags.asset });
        await submitCommand('add_animator_parameter', apArgs, flags);
        break;
      }

      case 'add-animator-state': {
        if (!flags.asset) fail('--asset PATH_OR_GUID is required');
        if (!flags.name) fail('--name is required');
        const asArgs = { name: flags.name };
        if (flags.layer !== undefined) asArgs.layer = parseInt(flags.layer, 10);
        if (flags.motion) asArgs.motion = flags.motion;
        if (flags.speed !== undefined) asArgs.speed = parseFloat(flags.speed);
        const isGuidAS = /^[0-9a-f]{32}$/i.test(flags.asset);
        Object.assign(asArgs, isGuidAS ? { guid: flags.asset } : { assetPath: flags.asset });
        await submitCommand('add_animator_state', asArgs, flags);
        break;
      }

      case 'add-animator-transition': {
        if (!flags.asset) fail('--asset PATH_OR_GUID is required');
        if (!flags.from) fail('--from STATE is required');
        if (!flags.to)   fail('--to STATE is required');
        const atArgs = { from: flags.from, to: flags.to };
        if (flags.layer !== undefined) atArgs.layer = parseInt(flags.layer, 10);
        if (flags['has-exit-time'] !== undefined) atArgs.hasExitTime = flags['has-exit-time'] === 'true' || flags['has-exit-time'] === true;
        if (flags['exit-time'] !== undefined) atArgs.exitTime = parseFloat(flags['exit-time']);
        if (flags.duration !== undefined) atArgs.duration = parseFloat(flags.duration);
        if (flags.offset !== undefined)   atArgs.offset   = parseFloat(flags.offset);
        if (flags['can-self'] !== undefined) atArgs.canTransitionToSelf = flags['can-self'] === 'true' || flags['can-self'] === true;
        if (flags.conditions) {
          try { atArgs.conditions = JSON.parse(flags.conditions); }
          catch (e) { fail('--conditions must be valid JSON: ' + e.message); }
        }
        const isGuidAT = /^[0-9a-f]{32}$/i.test(flags.asset);
        Object.assign(atArgs, isGuidAT ? { guid: flags.asset } : { assetPath: flags.asset });
        await submitCommand('add_animator_transition', atArgs, flags);
        break;
      }

      case 'set-animator-default-state': {
        if (!flags.asset) fail('--asset PATH_OR_GUID is required');
        if (!flags.state) fail('--state STATE_NAME is required');
        const sdsArgs = { state: flags.state };
        if (flags.layer !== undefined) sdsArgs.layer = parseInt(flags.layer, 10);
        const isGuidSDS = /^[0-9a-f]{32}$/i.test(flags.asset);
        Object.assign(sdsArgs, isGuidSDS ? { guid: flags.asset } : { assetPath: flags.asset });
        await submitCommand('set_animator_default_state', sdsArgs, flags);
        break;
      }

      case 'inspect-animator-controller': {
        if (!flags.asset) fail('--asset PATH_OR_GUID is required');
        const iacArgs = {};
        const isGuidIAC = /^[0-9a-f]{32}$/i.test(flags.asset);
        Object.assign(iacArgs, isGuidIAC ? { guid: flags.asset } : { assetPath: flags.asset });
        await submitCommand('inspect_animator_controller', iacArgs, flags);
        break;
      }

      // ── Phase 2: remove + update ───────────────────────────────────────

      case 'remove-animator-parameter': {
        if (!flags.asset) fail('--asset PATH_OR_GUID is required');
        if (!flags.name) fail('--name is required');
        const a = { name: flags.name };
        if (flags.force === true || flags.force === 'true') a.force = true;
        const isGuid = /^[0-9a-f]{32}$/i.test(flags.asset);
        Object.assign(a, isGuid ? { guid: flags.asset } : { assetPath: flags.asset });
        await submitCommand('remove_animator_parameter', a, flags);
        break;
      }

      case 'remove-animator-state': {
        if (!flags.asset) fail('--asset PATH_OR_GUID is required');
        if (!flags.name) fail('--name is required');
        const a = { name: flags.name };
        if (flags.layer !== undefined) a.layer = parseInt(flags.layer, 10);
        const isGuid = /^[0-9a-f]{32}$/i.test(flags.asset);
        Object.assign(a, isGuid ? { guid: flags.asset } : { assetPath: flags.asset });
        await submitCommand('remove_animator_state', a, flags);
        break;
      }

      case 'remove-animator-transition': {
        if (!flags.asset) fail('--asset PATH_OR_GUID is required');
        if (!flags.from || !flags.to) fail('--from and --to are required');
        const a = { from: flags.from, to: flags.to };
        if (flags.layer !== undefined) a.layer = parseInt(flags.layer, 10);
        if (flags.index !== undefined) a.index = parseInt(flags.index, 10);
        const isGuid = /^[0-9a-f]{32}$/i.test(flags.asset);
        Object.assign(a, isGuid ? { guid: flags.asset } : { assetPath: flags.asset });
        await submitCommand('remove_animator_transition', a, flags);
        break;
      }

      case 'update-animator-state': {
        if (!flags.asset) fail('--asset PATH_OR_GUID is required');
        if (!flags.name) fail('--name (existing state name) is required');
        const a = { name: flags.name };
        if (flags.layer !== undefined) a.layer = parseInt(flags.layer, 10);
        if (flags.rename) a.rename = flags.rename;
        if (flags.motion !== undefined) a.motion = flags.motion;
        if (flags.speed !== undefined) a.speed = parseFloat(flags.speed);
        if (flags.mirror !== undefined) a.mirror = flags.mirror === 'true' || flags.mirror === true;
        if (flags['cycle-offset'] !== undefined) a.cycleOffset = parseFloat(flags['cycle-offset']);
        if (flags['write-defaults'] !== undefined) a.writeDefaultValues = flags['write-defaults'] === 'true' || flags['write-defaults'] === true;
        const isGuid = /^[0-9a-f]{32}$/i.test(flags.asset);
        Object.assign(a, isGuid ? { guid: flags.asset } : { assetPath: flags.asset });
        await submitCommand('update_animator_state', a, flags);
        break;
      }

      case 'update-animator-transition': {
        if (!flags.asset) fail('--asset PATH_OR_GUID is required');
        if (!flags.from || !flags.to) fail('--from and --to are required');
        const a = { from: flags.from, to: flags.to };
        if (flags.layer !== undefined) a.layer = parseInt(flags.layer, 10);
        if (flags.index !== undefined) a.index = parseInt(flags.index, 10);
        if (flags['has-exit-time'] !== undefined) a.hasExitTime = flags['has-exit-time'] === 'true' || flags['has-exit-time'] === true;
        if (flags['exit-time'] !== undefined) a.exitTime = parseFloat(flags['exit-time']);
        if (flags.duration !== undefined) a.duration = parseFloat(flags.duration);
        if (flags.offset !== undefined) a.offset = parseFloat(flags.offset);
        if (flags['can-self'] !== undefined) a.canTransitionToSelf = flags['can-self'] === 'true' || flags['can-self'] === true;
        if (flags['interruption-source']) a.interruptionSource = flags['interruption-source'];
        if (flags.conditions) {
          try { a.conditions = JSON.parse(flags.conditions); }
          catch (e) { fail('--conditions must be valid JSON: ' + e.message); }
        }
        const isGuid = /^[0-9a-f]{32}$/i.test(flags.asset);
        Object.assign(a, isGuid ? { guid: flags.asset } : { assetPath: flags.asset });
        await submitCommand('update_animator_transition', a, flags);
        break;
      }

      // ── Phase 2: layer management ──────────────────────────────────────

      case 'add-animator-layer': {
        if (!flags.asset) fail('--asset PATH_OR_GUID is required');
        if (!flags.name) fail('--name (layer name) is required');
        const a = { name: flags.name };
        if (flags.weight !== undefined) a.weight = parseFloat(flags.weight);
        if (flags.blending) a.blending = flags.blending;
        if (flags.mask) a.mask = flags.mask;
        if (flags['ik-pass'] !== undefined) a.ikPass = flags['ik-pass'] === 'true' || flags['ik-pass'] === true;
        const isGuid = /^[0-9a-f]{32}$/i.test(flags.asset);
        Object.assign(a, isGuid ? { guid: flags.asset } : { assetPath: flags.asset });
        await submitCommand('add_animator_layer', a, flags);
        break;
      }

      case 'remove-animator-layer': {
        if (!flags.asset) fail('--asset PATH_OR_GUID is required');
        if (flags.layer === undefined) fail('--layer N is required');
        const a = { layer: parseInt(flags.layer, 10) };
        const isGuid = /^[0-9a-f]{32}$/i.test(flags.asset);
        Object.assign(a, isGuid ? { guid: flags.asset } : { assetPath: flags.asset });
        await submitCommand('remove_animator_layer', a, flags);
        break;
      }

      case 'set-animator-layer': {
        if (!flags.asset) fail('--asset PATH_OR_GUID is required');
        if (flags.layer === undefined) fail('--layer N is required');
        const a = { layer: parseInt(flags.layer, 10) };
        if (flags.name !== undefined) a.name = flags.name;
        if (flags.weight !== undefined) a.weight = parseFloat(flags.weight);
        if (flags.blending) a.blending = flags.blending;
        if (flags.mask !== undefined) a.mask = flags.mask;
        if (flags['ik-pass'] !== undefined) a.ikPass = flags['ik-pass'] === 'true' || flags['ik-pass'] === true;
        if (flags['synced-layer'] !== undefined) a.syncedLayerIndex = parseInt(flags['synced-layer'], 10);
        if (flags['sync-timing'] !== undefined) a.syncedLayerAffectsTiming = flags['sync-timing'] === 'true' || flags['sync-timing'] === true;
        const isGuid = /^[0-9a-f]{32}$/i.test(flags.asset);
        Object.assign(a, isGuid ? { guid: flags.asset } : { assetPath: flags.asset });
        await submitCommand('set_animator_layer', a, flags);
        break;
      }

      // ── Phase 2: blend trees ───────────────────────────────────────────

      case 'add-animator-blend-tree': {
        if (!flags.asset) fail('--asset PATH_OR_GUID is required');
        if (!flags.name) fail('--name (blend tree state name) is required');
        const a = { name: flags.name, type: flags.type || '1d' };
        if (flags.layer !== undefined) a.layer = parseInt(flags.layer, 10);
        if (flags['blend-parameter']) a.blendParameter = flags['blend-parameter'];
        if (flags['blend-parameter-y']) a.blendParameterY = flags['blend-parameter-y'];
        if (flags.children) {
          try { a.children = JSON.parse(flags.children); }
          catch (e) { fail('--children must be valid JSON: ' + e.message); }
        }
        const isGuid = /^[0-9a-f]{32}$/i.test(flags.asset);
        Object.assign(a, isGuid ? { guid: flags.asset } : { assetPath: flags.asset });
        await submitCommand('add_animator_blend_tree', a, flags);
        break;
      }

      // ── Phase 2: avatar masks ──────────────────────────────────────────

      case 'create-avatar-mask': {
        if (!flags.name) fail('--name is required');
        const a = { name: flags.name };
        if (flags.path) a.path = flags.path;
        if (flags.humanoid) {
          try { a.humanoid = JSON.parse(flags.humanoid); }
          catch (e) { fail('--humanoid must be valid JSON: ' + e.message); }
        }
        if (flags.transforms) {
          try { a.transforms = JSON.parse(flags.transforms); }
          catch (e) { fail('--transforms must be valid JSON: ' + e.message); }
        }
        await submitCommand('create_avatar_mask', a, flags);
        break;
      }

      case 'set-avatar-mask': {
        if (!flags.asset) fail('--asset PATH_OR_GUID is required');
        const a = {};
        if (flags.humanoid) {
          try { a.humanoid = JSON.parse(flags.humanoid); }
          catch (e) { fail('--humanoid must be valid JSON: ' + e.message); }
        }
        if (flags.transforms) {
          try { a.transforms = JSON.parse(flags.transforms); }
          catch (e) { fail('--transforms must be valid JSON: ' + e.message); }
        }
        const isGuid = /^[0-9a-f]{32}$/i.test(flags.asset);
        Object.assign(a, isGuid ? { guid: flags.asset } : { assetPath: flags.asset });
        await submitCommand('set_avatar_mask', a, flags);
        break;
      }

      case 'inspect-avatar-mask': {
        if (!flags.asset) fail('--asset PATH_OR_GUID is required');
        const a = {};
        const isGuid = /^[0-9a-f]{32}$/i.test(flags.asset);
        Object.assign(a, isGuid ? { guid: flags.asset } : { assetPath: flags.asset });
        await submitCommand('inspect_avatar_mask', a, flags);
        break;
      }

      // ── Phase 2: override controllers ──────────────────────────────────

      case 'create-animator-override-controller': {
        if (!flags.name) fail('--name is required');
        if (!flags.base) fail('--base PATH_TO_BASE_CONTROLLER is required');
        const a = { name: flags.name, base: flags.base };
        if (flags.path) a.path = flags.path;
        await submitCommand('create_animator_override_controller', a, flags);
        break;
      }

      case 'set-animator-override-clip': {
        if (!flags.asset) fail('--asset PATH_OR_GUID is required');
        const a = {};
        if (flags['base-clip']) a.baseClip = flags['base-clip'];
        if (flags['override-clip'] !== undefined) a.overrideClip = flags['override-clip'];
        if (flags.overrides) {
          try { a.overrides = JSON.parse(flags.overrides); }
          catch (e) { fail('--overrides must be valid JSON: ' + e.message); }
        }
        const isGuid = /^[0-9a-f]{32}$/i.test(flags.asset);
        Object.assign(a, isGuid ? { guid: flags.asset } : { assetPath: flags.asset });
        await submitCommand('set_animator_override_clip', a, flags);
        break;
      }

      case 'inspect-animator-override-controller': {
        if (!flags.asset) fail('--asset PATH_OR_GUID is required');
        const a = {};
        const isGuid = /^[0-9a-f]{32}$/i.test(flags.asset);
        Object.assign(a, isGuid ? { guid: flags.asset } : { assetPath: flags.asset });
        await submitCommand('inspect_animator_override_controller', a, flags);
        break;
      }

      case 'set-particle-property': {
        if (!flags.asset && !flags['scene-object']) fail('--asset or --scene-object is required for set-particle-property');
        if (!flags.property) fail('--property is required for set-particle-property');
        if (flags.value === undefined) fail('--value is required for set-particle-property');
        let pvalue;
        try { pvalue = JSON.parse(flags.value); } catch { pvalue = flags.value; }
        const ppArgs = { propertyPath: flags.property, value: pvalue };
        if (flags['scene-object']) {
          ppArgs.sceneObjectPath = flags['scene-object'];
        } else {
          const isGuidPP = /^[0-9a-f]{32}$/i.test(flags.asset);
          Object.assign(ppArgs, isGuidPP ? { guid: flags.asset } : { assetPath: flags.asset });
        }
        if (flags['child-path']) ppArgs.childPath = flags['child-path'];
        await submitCommand('set_particle_property', ppArgs, flags);
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

      case 'set-layer': {
        if (!flags['scene-object'] && !flags.asset) fail('--scene-object or --asset is required for set-layer');
        if (flags.layer === undefined || flags.layer === null || flags.layer === '') {
          fail('--layer is required (layer name like "Terrain", or numeric index 0–31)');
        }
        const slArgs = {};
        if (flags['scene-object']) {
          slArgs.sceneObjectPath = flags['scene-object'];
        } else {
          const isGuidSL = /^[0-9a-f]{32}$/i.test(flags.asset);
          Object.assign(slArgs, isGuidSL ? { guid: flags.asset } : { assetPath: flags.asset });
        }
        if (flags['child-path']) slArgs.childPath = flags['child-path'];
        slArgs.layer = (typeof flags.layer === 'string' && /^\d+$/.test(flags.layer.trim()))
          ? Number(flags.layer) : flags.layer;
        if (flags.recursive) slArgs.recursive = true;
        await submitCommand('set_layer', slArgs, flags);
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

      case 'reparent': {
        // Scene mode:  --scene-object PATH [--new-parent PATH]
        // Prefab mode: --asset PATH --child-path SOURCE [--new-parent PARENT_REL]
        // In prefab mode --new-parent is RELATIVE TO PREFAB ROOT (per --child-path
        // semantics). Omit for prefab root.
        const rpArgs = {};
        if (flags['scene-object']) {
          rpArgs.sceneObjectPath = flags['scene-object'];
        } else if (flags.asset) {
          if (!flags['child-path']) fail('--child-path SOURCE is required when reparenting inside a prefab (the GameObject to move, relative to prefab root)');
          const isGuidRP = /^[0-9a-f]{32}$/i.test(flags.asset);
          Object.assign(rpArgs, isGuidRP ? { guid: flags.asset } : { assetPath: flags.asset });
          rpArgs.childPath = flags['child-path'];
        } else {
          fail('reparent needs either --scene-object PATH (scene) or --asset PATH --child-path SOURCE (prefab)');
        }
        // Empty / unset --new-parent → move to scene root (scene mode) or prefab root (prefab mode).
        if (flags['new-parent']) rpArgs.newParentPath = flags['new-parent'];
        if (flags['keep-world-space'] === true || flags['keep-world-space'] === 'true') {
          rpArgs.keepWorldSpace = true;
        }
        if (flags['sibling-index'] != null) {
          const idx = parseInt(flags['sibling-index'], 10);
          if (!Number.isFinite(idx) || idx < 0) fail('--sibling-index must be a non-negative integer');
          rpArgs.siblingIndex = idx;
        }
        await submitCommand('reparent_gameobject', rpArgs, flags);
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
        const ihArgs = { scene: flags.scene || null };
        if (flags.asset) {
          const isGuidIH = /^[0-9a-f]{32}$/i.test(flags.asset);
          Object.assign(ihArgs, isGuidIH ? { guid: flags.asset } : { assetPath: flags.asset });
        }
        if (flags.depth !== undefined) ihArgs.depth = parseInt(flags.depth, 10);
        if (flags['include-transforms']) ihArgs.includeTransforms = true;
        if (flags['include-fields']) ihArgs.includeFields = true;
        await submitCommand('inspect_hierarchy', ihArgs, flags);
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
        // Both spellings — "-script" reads better for a single file, "-scripts" for a folder.
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
          // --enable defaults true; explicit "false" disables.
          mpArgs.enable = flags.enable !== 'false' && flags.enable !== false;
        } else {
          mpArgs.property = flags.property;
          if (flags.value === undefined) fail('--value is required when setting a material property');
          try {
            mpArgs.value = typeof flags.value === 'string' ? JSON.parse(flags.value) : flags.value;
          } catch {
            // Not JSON — pass through as-is for float/int strings, texture paths, etc.
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

      // ── UGUI add-on — three public commands ──────────────────────────
      // Requires com.dreamer.agent-bridge.ugui. Missing → "Unknown command kind"
      // from Unity; daemon hint surfaces the add-on install prompt.

      case 'set-rect-transform': {
        const rtArgs = {};
        if (flags['scene-object']) rtArgs.sceneObjectPath = flags['scene-object'];
        else if (flags.asset) {
          const isGuid = /^[0-9a-f]{32}$/i.test(flags.asset);
          if (isGuid) rtArgs.guid = flags.asset;
          else rtArgs.assetPath = flags.asset;
          if (flags['child-path']) rtArgs.childPath = flags['child-path'];
        } else {
          fail('--scene-object NAME or --asset PATH is required for set-rect-transform');
        }
        if (flags.anchor) rtArgs.anchor = flags.anchor;
        // Vector-ish flags accept JSON arrays (`[w,h]`), strings (`WxH`,
        // `X,Y`), or dicts. Parse JSON when the value looks like one so the
        // C# side gets a real array, not the literal string.
        const tryJson = (v) => {
          if (typeof v !== 'string') return v;
          const t = v.trim();
          if (!(t.startsWith('[') || t.startsWith('{'))) return v;
          try { return JSON.parse(t); } catch { return v; }
        };
        if (flags.size !== undefined) rtArgs.size = tryJson(flags.size);
        if (flags.pivot !== undefined) rtArgs.pivot = tryJson(flags.pivot);
        if (flags.offset !== undefined) rtArgs.offset = tryJson(flags.offset);
        if (flags['offset-min'] !== undefined) rtArgs.offsetMin = tryJson(flags['offset-min']);
        if (flags['offset-max'] !== undefined) rtArgs.offsetMax = tryJson(flags['offset-max']);
        await submitCommand('set_rect_transform', rtArgs, flags);
        break;
      }

      case 'create-ui-tree': {
        if (!flags.json) fail('--json JSON is required (the tree spec — inline or "@path/to/file.json")');
        let payload;
        let raw = flags.json;
        if (raw.startsWith('@')) {
          const fpath = raw.slice(1);
          try { raw = fs.readFileSync(fpath, 'utf8'); }
          catch (e) { fail(`Failed to read --json file '${fpath}': ${e.message}`); }
        }
        try { payload = JSON.parse(raw); }
        catch (e) { fail(`--json is not valid JSON: ${e.message}`); }
        // Payload shape: { mode, target?, canvas?, tree }
        await submitCommand('create_ui_tree', payload, flags);
        break;
      }

      case 'inspect-ui-tree': {
        if (!flags.target) fail('--target PATH is required (scene path of the UI root to inspect)');
        const iArgs = { target: flags.target };
        if (flags.depth !== undefined) iArgs.depth = parseInt(flags.depth, 10);
        if (flags['include-raw'] !== undefined) iArgs.includeRaw = flags['include-raw'] !== 'false' && flags['include-raw'] !== false;
        if (flags['include-rect'] !== undefined) iArgs.includeRect = flags['include-rect'] !== 'false' && flags['include-rect'] !== false;
        await submitCommand('inspect_ui_tree', iArgs, flags);
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
          // Default to humanized 1-line summary — raw JSON is ~100 lines
          // for healthy state and the user's question is usually "anything wrong?"
          // --json for raw, --verbose for summary + JSON.
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

        // Default view: non-terminal + 5 most recent terminal — matches the
        // common "what's stuck, what just finished?" without dumping history.
        // --all overrides; --state/--task already narrow.
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

      case 'cancel': {
        await ensureDaemon();
        const id = positional[1];
        const filterState = flags.state;
        const filterTask = flags.task;

        if (id) {
          const resp = await httpRequest('DELETE', `/api/commands/${encodeURIComponent(id)}`);
          if (resp.status >= 400) fail(resp.data.error || `HTTP ${resp.status}`);
          out({ cancelled: 1, command: resp.data });
          break;
        }

        if (!filterState && !filterTask) {
          fail('cancel requires <id> or --state STATE or --task TASKID. Examples:\n' +
            '  ./bin/dreamer cancel 7f3a-...                 # cancel one command\n' +
            '  ./bin/dreamer cancel --state waiting          # flush all waiting (Play Mode parked, etc.)\n' +
            '  ./bin/dreamer cancel --state queued           # flush all queued\n' +
            '  ./bin/dreamer cancel --task agent-A:setup     # cancel everything labelled with that task');
        }

        const params = new URLSearchParams();
        if (filterState) params.set('state', filterState);
        if (filterTask)  params.set('originTaskId', filterTask);
        const listResp = await httpRequest('GET', `/api/commands?${params.toString()}`);
        if (listResp.status >= 400) fail(listResp.data.error || `HTTP ${listResp.status}`);

        const NON_TERMINAL = new Set(['queued', 'waiting', 'dispatched', 'running']);
        const targets = (listResp.data.commands || []).filter(c => NON_TERMINAL.has(c.state));
        if (targets.length === 0) {
          out({ cancelled: 0, hint: 'No non-terminal commands matched.' });
          break;
        }

        const results = [];
        const errors = [];
        for (const cmd of targets) {
          const r = await httpRequest('DELETE', `/api/commands/${encodeURIComponent(cmd.id)}`);
          if (r.status >= 400) errors.push({ id: cmd.id, kind: cmd.kind, error: r.data.error || `HTTP ${r.status}` });
          else results.push({ id: cmd.id, kind: cmd.kind, previousState: cmd.state });
        }
        out({ cancelled: results.length, failed: errors.length, commands: results, errors });
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
        // --since accepts bare ms or "Ns"/"Nm"/"Nh" shorthand.
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
            // Drop entries whose absolute projectPath no longer exists — port
            // allocation is garbage if the Unity project was deleted or renamed.
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

      case 'set-play-mode': {
        if (!flags.state) fail('Usage: dreamer set-play-mode --state enter|exit|toggle|pause|unpause|toggle-pause');
        await submitCommand('set_play_mode', { state: flags.state }, flags);
        break;
      }

      case 'inspect-project-settings': {
        const args = {};
        if (flags.file) args.file = flags.file;
        await submitCommand('inspect_project_settings', args, flags);
        break;
      }

      case 'set-layer-name': {
        if (flags.index === undefined) fail('--index is required for set-layer-name');
        if (flags.name === undefined) fail('--name is required for set-layer-name');
        await submitCommand('set_layer_name', {
          index: parseInt(flags.index, 10),
          name: String(flags.name),
          force: flags.force === true || flags.force === 'true',
        }, flags);
        break;
      }

      case 'clear-layer': {
        if (flags.index === undefined) fail('--index is required for clear-layer');
        await submitCommand('clear_layer', {
          index: parseInt(flags.index, 10),
          force: flags.force === true || flags.force === 'true',
        }, flags);
        break;
      }

      case 'add-tag': {
        if (!flags.name) fail('--name is required for add-tag');
        await submitCommand('add_tag', { name: String(flags.name) }, flags);
        break;
      }

      case 'remove-tag': {
        if (!flags.name) fail('--name is required for remove-tag');
        await submitCommand('remove_tag', { name: String(flags.name) }, flags);
        break;
      }

      case 'add-sorting-layer': {
        if (!flags.name) fail('--name is required for add-sorting-layer');
        await submitCommand('add_sorting_layer', { name: String(flags.name) }, flags);
        break;
      }

      case 'remove-sorting-layer': {
        if (!flags.name) fail('--name is required for remove-sorting-layer');
        await submitCommand('remove_sorting_layer', { name: String(flags.name) }, flags);
        break;
      }

      case 'set-layer-collision': {
        if (!flags['layer-a']) fail('--layer-a is required for set-layer-collision');
        if (!flags['layer-b']) fail('--layer-b is required for set-layer-collision');
        // --collide defaults to true if not passed; explicit false disables.
        let collide = true;
        if (flags.collide !== undefined) {
          collide = !(flags.collide === false || flags.collide === 'false');
        }
        await submitCommand('set_layer_collision', {
          layerA: String(flags['layer-a']),
          layerB: String(flags['layer-b']),
          collide,
          twoD: flags['2d'] === true || flags['2d'] === 'true',
        }, flags);
        break;
      }

      case 'set-physics-gravity': {
        if (flags.value === undefined) fail("--value is required for set-physics-gravity (e.g. --value '[0,-9.81,0]')");
        let parsed;
        try { parsed = JSON.parse(flags.value); }
        catch (e) { fail(`--value must be a JSON array: ${e.message}`); }
        if (!Array.isArray(parsed)) fail('--value must be a JSON array');
        await submitCommand('set_physics_gravity', {
          value: parsed,
          twoD: flags['2d'] === true || flags['2d'] === 'true',
        }, flags);
        break;
      }

      case 'set-project-setting': {
        if (!flags.file) fail('--file is required for set-project-setting');
        if (!flags.property) fail('--property is required for set-project-setting');
        if (flags.value === undefined) fail('--value is required for set-project-setting');
        let parsedVal;
        try { parsedVal = JSON.parse(flags.value); }
        catch (e) {
          // Bare strings without JSON quoting — ergonomic shortcut.
          parsedVal = flags.value;
        }
        await submitCommand('set_project_setting', {
          file: String(flags.file),
          propertyPath: String(flags.property),
          value: parsedVal,
        }, flags);
        break;
      }

      case 'inspect-project-setting': {
        if (!flags.file) fail('--file is required for inspect-project-setting');
        const args = { file: String(flags.file) };
        if (flags.property) args.propertyPath = String(flags.property);
        if (flags.depth !== undefined) args.depth = parseInt(flags.depth, 10);
        await submitCommand('inspect_project_setting', args, flags);
        break;
      }

      case 'inspect-player-settings': {
        const args = {};
        if (flags.target) args.target = String(flags.target);
        await submitCommand('inspect_player_settings', args, flags);
        break;
      }

      case 'set-app-id': {
        if (!flags.target) fail('--target is required for set-app-id (e.g. android, ios, standalone)');
        if (!flags.id) fail('--id is required for set-app-id');
        await submitCommand('set_app_id', {
          target: String(flags.target),
          id: String(flags.id),
        }, flags);
        break;
      }

      case 'set-default-icon': {
        if (!flags.texture) fail('--texture is required for set-default-icon');
        await submitCommand('set_default_icon', { texture: String(flags.texture) }, flags);
        break;
      }

      case 'set-app-icons': {
        if (!flags.target) fail('--target is required for set-app-icons');
        if (!flags.textures) fail("--textures is required for set-app-icons (JSON array of asset paths)");
        let parsed;
        try { parsed = JSON.parse(flags.textures); }
        catch (e) { fail(`--textures must be a JSON array: ${e.message}`); }
        if (!Array.isArray(parsed)) fail('--textures must be a JSON array');
        await submitCommand('set_app_icons', {
          target: String(flags.target),
          textures: parsed,
        }, flags);
        break;
      }

      case 'set-cursor-icon': {
        if (!flags.texture) fail('--texture is required for set-cursor-icon');
        const args = { texture: String(flags.texture) };
        if (flags.hotspot !== undefined) {
          let hs;
          try { hs = JSON.parse(flags.hotspot); }
          catch (e) { fail(`--hotspot must be a JSON array: ${e.message}`); }
          if (!Array.isArray(hs) || hs.length !== 2) fail('--hotspot must be a 2-element array [x,y]');
          args.hotspot = hs;
        }
        await submitCommand('set_cursor_icon', args, flags);
        break;
      }

      case 'inspect-build-scenes': {
        await submitCommand('inspect_build_scenes', {}, flags);
        break;
      }

      case 'screenshot-scene': {
        const args = {};
        if (flags.camera) args.camera = String(flags.camera);
        // Resolve preset first; explicit --width/--height override below.
        if (flags.preset) {
          const PRESETS = { layout: [800, 450], normal: [1280, 720], text: [2560, 1440] };
          const p = PRESETS[String(flags.preset).toLowerCase()];
          if (!p) fail(`--preset must be one of: ${Object.keys(PRESETS).join(', ')}`);
          [args.width, args.height] = p;
        }
        if (flags.width !== undefined) args.width = parseInt(flags.width, 10);
        if (flags.height !== undefined) args.height = parseInt(flags.height, 10);
        if (flags['save-to']) args.savePath = String(flags['save-to']);
        if (flags['background-color'] !== undefined) {
          let bg;
          try { bg = JSON.parse(flags['background-color']); }
          catch { bg = String(flags['background-color']); }
          args.backgroundColor = bg;
        }
        if (flags.transparent === true || flags.transparent === 'true') args.transparent = true;
        if (flags['filter-mode']) args.filterMode = String(flags['filter-mode']);
        await submitCommand('screenshot_scene', args, flags);
        break;
      }

      case 'screenshot-prefab': {
        const target = flags.asset || positional[1];
        if (!target) fail('Usage: dreamer screenshot-prefab --asset Assets/X.prefab [--width N] [--height N] [--angle iso|front|side|top|...] [--background-color #RRGGBB[AA]] [--transparent]');
        const isGuid = /^[0-9a-f]{32}$/i.test(target);
        const args = isGuid ? { guid: target } : { assetPath: target };
        if (flags.width !== undefined) args.width = parseInt(flags.width, 10);
        if (flags.height !== undefined) args.height = parseInt(flags.height, 10);
        if (flags.angle) args.angle = String(flags.angle);
        if (flags['save-to']) args.savePath = String(flags['save-to']);
        if (flags['background-color'] !== undefined) {
          // Accept hex string ("#aabbcc") or JSON array ("[0.1,0.2,0.3]"). Try JSON first.
          let bg;
          try { bg = JSON.parse(flags['background-color']); }
          catch { bg = String(flags['background-color']); }
          args.backgroundColor = bg;
        }
        if (flags.transparent === true || flags.transparent === 'true') args.transparent = true;
        if (flags.size !== undefined) {
          let sz;
          try { sz = JSON.parse(flags.size); }
          catch (e) { fail(`--size must be a JSON array [w,h]: ${e.message}`); }
          if (!Array.isArray(sz) || sz.length !== 2) fail('--size must be a 2-element array [w,h]');
          args.size = sz;
        }
        await submitCommand('screenshot_prefab', args, flags);
        break;
      }

      case 'set-build-scenes': {
        if (!flags.scenes) fail('--scenes is required for set-build-scenes (JSON array)');
        let parsed;
        try { parsed = JSON.parse(flags.scenes); }
        catch (e) { fail(`--scenes must be valid JSON: ${e.message}`); }
        if (!Array.isArray(parsed)) fail('--scenes must be a JSON array');
        await submitCommand('set_build_scenes', { scenes: parsed }, flags);
        break;
      }

      case 'add-build-scene': {
        if (!flags.scene) fail('--scene is required for add-build-scene');
        const args = { scene: String(flags.scene) };
        if (flags.enabled !== undefined) {
          args.enabled = !(flags.enabled === false || flags.enabled === 'false');
        }
        await submitCommand('add_build_scene', args, flags);
        break;
      }

      case 'remove-build-scene': {
        if (!flags.scene) fail('--scene is required for remove-build-scene');
        await submitCommand('remove_build_scene', { scene: String(flags.scene) }, flags);
        break;
      }

      case 'execute-method': {
        if (!flags.type) fail('--type is required for execute-method');
        if (!flags.method) fail('--method is required for execute-method');
        const emArgs = {
          typeName: flags.type,
          methodName: flags.method,
        };
        if (flags.args !== undefined) {
          let parsed;
          try { parsed = JSON.parse(flags.args); }
          catch (e) { fail(`--args must be JSON: ${e.message}`); }
          if (!Array.isArray(parsed)) fail('--args must be a JSON array');
          emArgs.args = parsed;
        }
        await submitCommand('execute_method', emArgs, flags);
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
        // --save-path turns it into a prefab instead of a scene object.
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

        const gitCheck = spawnSync('git', ['--version'], { stdio: 'ignore' });
        if (gitCheck.error || gitCheck.status !== 0) {
          fail('git not found on PATH. Install git and retry.');
        }

        // --check: cheap ls-remote SHA compare, no clone. SessionStart hook uses
        // this so every Claude session begins with a quick freshness ping.
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

        const rev = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: cloneDir, stdio: ['ignore', 'pipe', 'pipe'] });
        const newSha = rev.status === 0 ? rev.stdout.toString().trim() : 'unknown';

        // Replace targets (src in clone → dst in projectRoot). Core always
        // copied; add-on targets gated on installed add-ons in .dreamer-source.json.
        const targets = [
          { src: 'daemon/src', dst: 'daemon/src', type: 'dir' },
          { src: 'daemon/bin', dst: 'daemon/bin', type: 'dir' },
          { src: 'daemon/package.json', dst: 'daemon/package.json', type: 'file' },
          { src: 'Packages/com.dreamer.agent-bridge', dst: 'Packages/com.dreamer.agent-bridge', type: 'dir' },
          { src: '.claude/skills/dreamer', dst: '.claude/skills/dreamer', type: 'dir' },
          { src: 'bin/dreamer', dst: 'bin/dreamer', type: 'file', chmod: 0o755 },
          { src: 'bin/dreamer.cmd', dst: 'bin/dreamer.cmd', type: 'file' },
          { src: 'CHANGELOG.md', dst: 'CHANGELOG.md', type: 'file', optional: true },
        ];
        const installedAddons = Array.isArray(source.addons) ? source.addons : [];
        if (installedAddons.includes('ugui')) {
          targets.push(
            { src: 'Packages/com.dreamer.agent-bridge.ugui', dst: 'Packages/com.dreamer.agent-bridge.ugui', type: 'dir' },
            { src: '.claude/skills/dreamer-ugui', dst: '.claude/skills/dreamer-ugui', type: 'dir' },
          );
        }

        const missing = targets.filter((t) => !t.optional && !fs.existsSync(path.join(cloneDir, t.src)));
        if (missing.length > 0) {
          try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch { /* ignore */ }
          fail(`Source repo missing expected paths at ref '${ref}': ${missing.map((m) => m.src).join(', ')}`);
        }
        for (let i = targets.length - 1; i >= 0; i--) {
          if (targets[i].optional && !fs.existsSync(path.join(cloneDir, targets[i].src))) {
            targets.splice(i, 1);
          }
        }

        // Snapshot before swap so we can diff and surface new entries.
        const changelogPath = path.join(projectRoot, 'CHANGELOG.md');
        let oldChangelog = null;
        try { oldChangelog = fs.readFileSync(changelogPath, 'utf8'); } catch { /* fresh install */ }

        if (dryRun) {
          try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch { /* ignore */ }
          out({ dryRun: true, repo: source.repo, ref, sha: newSha, wouldReplace: targets.map((t) => t.dst) });
        }

        // Stop daemon so we can swap its files safely.
        try { await stopDaemon(); } catch { /* ignore */ }

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

        try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch { /* ignore */ }

        // Migration: the dreamer ref moved from .claude/commands/dreamer.md
        // (slash-command) to .claude/skills/dreamer/SKILL.md (auto-loading skill).
        // Remove the legacy file from pre-move installs so both don't coexist.
        const legacyCommandPath = path.join(projectRoot, '.claude/commands/dreamer.md');
        const migrated = [];
        try {
          if (fs.existsSync(legacyCommandPath)) {
            fs.rmSync(legacyCommandPath, { force: true });
            migrated.push('.claude/commands/dreamer.md (removed — superseded by .claude/skills/dreamer/SKILL.md)');
            // rmdir no-ops if non-empty, so users keeping other commands are safe.
            try { fs.rmdirSync(path.join(projectRoot, '.claude/commands')); } catch { /* keep dir if non-empty */ }
          }
        } catch { /* non-fatal */ }

        // Stamp installed SHA so `update --check` can ls-remote-diff cheaply.
        try {
          const updatedSource = { ...source, ref, sha: newSha, lastUpdatedAt: new Date().toISOString() };
          fs.writeFileSync(SOURCE_PATH, JSON.stringify(updatedSource, null, 2) + '\n', 'utf8');
        } catch { /* non-fatal: next update will re-stamp */ }

        const changelog = computeChangelogDiff(oldChangelog, changelogPath);

        out({
          updated: true,
          repo: source.repo,
          ref,
          sha: newSha,
          replaced: applied,
          migrated,
          addons: installedAddons,
          preserved: ['daemon/.dreamer-config.json', 'daemon/.dreamer-source.json', 'daemon/.dreamer-queue.json'],
          changelog,
          directive: changelog && changelog.newEntries && changelog.newEntries.length > 0
            ? 'IMPORTANT: After this update, the agent MUST list the new changelog entries (under `changelog.newEntries`) to the user — quote each entry verbatim or paraphrase tightly. The user just pulled new code and needs to know what changed. Do NOT skip this step or summarize "various improvements" — name the actual additions/fixes. If `changelog.newEntries` is empty (no diff), just confirm the update succeeded.'
            : 'No CHANGELOG.md entries are new since the previous version. Confirm the update succeeded and the SHA changed.',
          note: 'Daemon stopped; it will auto-restart on the next dreamer command. Unity may need a moment to reimport the updated package.',
        });
        break;
      }

      case 'addon': {
        const { spawnSync } = require('child_process');
        const projectRoot = path.resolve(__dirname, '..', '..');
        const sub = positional[1];
        const KNOWN_ADDONS = {
          ugui: {
            description: 'uGUI (Canvas UI) building add-on — create-ui-tree, inspect-ui-tree, set-rect-transform',
            paths: [
              { src: 'Packages/com.dreamer.agent-bridge.ugui', dst: 'Packages/com.dreamer.agent-bridge.ugui', type: 'dir' },
              { src: '.claude/skills/dreamer-ugui', dst: '.claude/skills/dreamer-ugui', type: 'dir' },
            ],
            // Wrapped in <!-- dreamer-addon:ugui --> markers for idempotent install/remove.
            claudeMdSection: `<!-- dreamer-addon:ugui:start -->
## Dreamer UGUI add-on

For any Canvas (uGUI) UI task — menus, HUDs, panels, buttons, scroll views — **default to \`./bin/dreamer create-ui-tree\`** (declarative JSON spec). Don't write Canvas UI in C# unless explicitly asked.

- Skill: \`.claude/skills/dreamer-ugui/SKILL.md\` (auto-loads on UI tasks)
- Conventions: \`Packages/com.dreamer.agent-bridge.ugui/UI-DESIGN-CONVENTIONS.md\`
- Quirks reference: \`Packages/com.dreamer.agent-bridge.ugui/UNITY-LAYOUT-QUIRKS.md\`
- Always pass \`--wait\` and check the result's \`warnings[]\`
<!-- dreamer-addon:ugui:end -->`,
          },
        };

        function updateClaudeMdForAddon(addonName, action) {
          const def = KNOWN_ADDONS[addonName];
          if (!def || !def.claudeMdSection) return;
          const claudeMdPath = path.join(projectRoot, 'CLAUDE.md');
          let content = '';
          try { content = fs.readFileSync(claudeMdPath, 'utf8'); } catch { /* will create */ }

          const startTag = `<!-- dreamer-addon:${addonName}:start -->`;
          const endTag = `<!-- dreamer-addon:${addonName}:end -->`;
          const sectionRegex = new RegExp(`${startTag}[\\s\\S]*?${endTag}\\n?`, 'g');
          // Strip first so reinstall is idempotent (no duplicate section).
          content = content.replace(sectionRegex, '');

          if (action === 'install') {
            const sep = content.length > 0 && !content.endsWith('\n\n') ? (content.endsWith('\n') ? '\n' : '\n\n') : '';
            content = content + sep + def.claudeMdSection + '\n';
          }

          fs.writeFileSync(claudeMdPath, content, 'utf8');
        }

        let src;
        try { src = JSON.parse(fs.readFileSync(SOURCE_PATH, 'utf8')); }
        catch { fail('daemon/.dreamer-source.json missing — reinstall Dreamer to manage add-ons.'); }
        const currentAddons = Array.isArray(src.addons) ? src.addons : [];

        if (sub === 'list' || !sub) {
          out({
            installed: currentAddons,
            available: Object.entries(KNOWN_ADDONS).map(([name, def]) => ({
              name, description: def.description, installed: currentAddons.includes(name),
            })),
          });
          break;
        }

        if (sub === 'install' || sub === 'remove') {
          const name = positional[2];
          if (!name) fail(`Usage: dreamer addon ${sub} <name>. Available: ${Object.keys(KNOWN_ADDONS).join(', ')}`);
          if (!KNOWN_ADDONS[name]) fail(`Unknown add-on '${name}'. Available: ${Object.keys(KNOWN_ADDONS).join(', ')}`);

          if (sub === 'install') {
            if (currentAddons.includes(name)) {
              out({ alreadyInstalled: true, name, note: 'Run `./bin/dreamer update` to refresh the add-on files from the source repo.' });
              break;
            }

            const os = require('os');
            const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), `dreamer-addon-${name}-`));
            const cloneDir = path.join(tmpBase, 'repo');
            const ref = src.ref || 'main';
            const clone = spawnSync('git', ['clone', '--depth', '1', '--branch', ref, src.repo, cloneDir], {
              stdio: ['ignore', 'pipe', 'pipe'],
            });
            if (clone.status !== 0) {
              const err = (clone.stderr && clone.stderr.toString().trim()) || 'unknown error';
              try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch { /* ignore */ }
              fail(`git clone failed for ${src.repo}@${ref}: ${err}`);
            }

            try {
              for (const p of KNOWN_ADDONS[name].paths) {
                const srcAbs = path.join(cloneDir, p.src);
                const dstAbs = path.join(projectRoot, p.dst);
                if (!fs.existsSync(srcAbs)) fail(`Source repo at '${ref}' is missing '${p.src}' — add-on not available on this ref.`);
                if (p.type === 'dir') {
                  if (fs.existsSync(dstAbs)) fs.rmSync(dstAbs, { recursive: true, force: true });
                  fs.mkdirSync(path.dirname(dstAbs), { recursive: true });
                  fs.cpSync(srcAbs, dstAbs, { recursive: true });
                } else {
                  fs.mkdirSync(path.dirname(dstAbs), { recursive: true });
                  fs.copyFileSync(srcAbs, dstAbs);
                }
              }
              // Record in source.json so future `update` calls pull this add-on too.
              src.addons = Array.from(new Set([...currentAddons, name]));
              fs.writeFileSync(SOURCE_PATH, JSON.stringify(src, null, 2) + '\n', 'utf8');
              // Augment CLAUDE.md so future Claude sessions know the add-on exists.
              try { updateClaudeMdForAddon(name, 'install'); } catch { /* non-fatal */ }
            }
            finally {
              try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch { /* ignore */ }
            }

            out({
              installed: true,
              name,
              installedFiles: KNOWN_ADDONS[name].paths.map((p) => p.dst),
              claudeMdUpdated: !!KNOWN_ADDONS[name].claudeMdSection,
              nextSteps: [
                'Unity will recompile the bridge package — wait until done.',
                `Verify with: ./bin/dreamer ${name === 'ugui' ? 'create-ui-tree' : 'help'} (commands become available after recompile)`,
                name === 'ugui'
                  ? `Conventions doc: Packages/com.dreamer.agent-bridge.ugui/UI-DESIGN-CONVENTIONS.md (read before building non-trivial UI).`
                  : null,
              ].filter(Boolean),
            });
            break;
          }

          if (!currentAddons.includes(name)) {
            out({ notInstalled: true, name });
            break;
          }
          for (const p of KNOWN_ADDONS[name].paths) {
            const dstAbs = path.join(projectRoot, p.dst);
            try {
              if (fs.existsSync(dstAbs)) fs.rmSync(dstAbs, { recursive: true, force: true });
            } catch (e) { /* non-fatal — continue */ }
          }
          src.addons = currentAddons.filter((n) => n !== name);
          fs.writeFileSync(SOURCE_PATH, JSON.stringify(src, null, 2) + '\n', 'utf8');
          // Strip CLAUDE.md section so future sessions don't reference a missing add-on.
          try { updateClaudeMdForAddon(name, 'remove'); } catch { /* non-fatal */ }
          out({
            removed: true,
            name,
            removedFiles: KNOWN_ADDONS[name].paths.map((p) => p.dst),
            claudeMdUpdated: !!KNOWN_ADDONS[name].claudeMdSection,
            note: 'Unity will recompile. Add-on commands will return "Unknown command kind" until you reinstall the add-on.',
          });
          break;
        }

        fail(`Unknown addon subcommand: '${sub}'. Use: list | install <name> | remove <name>`);
      }

      case 'config': {
        const sub = positional[1];
        if (sub === 'set' && positional[2]) {
          const [key, ...rest] = positional[2].split('=');
          const val = rest.join('=');
          if (!key || val === '') fail('Usage: dreamer config set key=value');
          const cfg = loadConfig();
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
        const rawKind = positional[1];
        if (!rawKind) {
          out({
            usage: 'dreamer help <kind-or-verb> | dreamer help conventions',
            documented: schemas.list(),
            conventionsHint: 'Run `dreamer help conventions` for cross-cutting rules: target-form flags (--asset / --scene-object / --child-path), value formats (asset/scene refs, sub-assets, sparse arrays), play-mode gating, multi-agent coordination, forbidden patterns.',
            note: '`help` accepts both kind names (snake_case, e.g. `create_hierarchy`) and CLI verbs (kebab-case, e.g. `create-hierarchy`). Run `dreamer --help` for the full CLI command list.',
          });
          break;
        }
        if (rawKind === 'conventions') {
          out(schemas.conventions);
          break;
        }
        // CLI verbs that don't map to their kind via the kebab->snake transform.
        const VERB_ALIASES = {
          'inspect': 'inspect_asset',
          'inspect-many': 'inspect_assets',
          'rename': 'rename_gameobject',
          'reparent': 'reparent_gameobject',
        };
        const kind = VERB_ALIASES[rawKind] || rawKind.replace(/-/g, '_');
        const schema = schemas.get(kind);
        if (!schema) {
          fail(`No schema for '${rawKind}'. Documented kinds: ${schemas.list().join(', ')}. Try \`dreamer help conventions\` for cross-cutting rules.`);
        }
        // Inject conventions pointer so each schema needn't repeat the cross-ref.
        out({
          ...schema,
          seeAlso: [
            ...(schema.seeAlso || []),
            './bin/dreamer help conventions  — universal flags, target forms, path syntax, value formats, play-mode gating, multi-agent rules, forbidden patterns',
          ],
        });
        break;
      }

      case 'probe-port': {
        // Mostly superseded by registry auto-allocation; still useful as a
        // "what would be picked next" diagnostic during bespoke install setup.
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
          // Pretty-print JSON lines to `ISO LEVEL module — msg`; non-JSON pass through.
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
