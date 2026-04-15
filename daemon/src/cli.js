'use strict';

const fs = require('fs');
const path = require('path');
const { ensureDaemon, isDaemonRunning, startDaemon, stopDaemon, httpRequest, focusUnity } = require('./daemon-manager');
const configModule = require('./config');

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
        flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
          flags[arg.slice(2)] = next;
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
 * Submit a command to the daemon and optionally wait for completion.
 * @param {string} kind
 * @param {object} args
 * @param {object} flags - CLI flags (may contain --wait, --priority, etc.)
 * @returns {Promise<void>}
 */
async function submitCommand(kind, args, flags = {}) {
  await ensureDaemon();

  // Auto-focus Unity so its main thread is ticking when the command arrives.
  // Controlled by config.autoFocus (default: true). Override with --no-focus or --focus.
  const shouldFocus = flags['focus'] === true ? true
    : flags['no-focus'] === true ? false
    : config.autoFocus !== false;
  if (shouldFocus) {
    await focusUnity();
  }

  const options = {};
  if (flags['origin-task-id']) options.originTaskId = flags['origin-task-id'];
  if (flags['label']) options.humanLabel = flags['label'];
  if (flags['priority']) options.priority = parseInt(flags['priority'], 10) || 0;
  if (flags['depends-on']) options.dependsOn = flags['depends-on'];

  const resp = await httpRequest('POST', '/api/commands', { kind, args, options });
  if (resp.status >= 400) {
    fail(resp.data.error || `HTTP ${resp.status}`);
  }

  const cmd = resp.data;

  if (flags.wait) {
    // Poll until terminal state
    const pollInterval = 500; // ms
    const timeout = parseInt(flags['wait-timeout'], 10) || 120000; // 2 min default
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      await sleep(pollInterval);
      const check = await httpRequest('GET', `/api/commands/${cmd.id}`);
      if (check.status !== 200) {
        fail(`Failed to poll command: ${check.data.error || check.status}`);
      }
      const current = check.data;
      if (['succeeded', 'failed', 'blocked', 'cancelled'].includes(current.state)) {
        out(current);
        return;
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
        'set-property (--asset PATH | --scene-object NAME) [--component TYPE] --property PATH --value JSON',
        'create-prefab --name NAME [--path FOLDER]',
        'instantiate-prefab --asset PATH [--name NAME] [--parent /PATH] [--position {x,y,z}]',
        'create-gameobject --name NAME [--parent PATH] [--scene SCENE]',
        'save-assets',
        'status [--id CMD_ID]',
        'queue [--state STATE] [--task TASK_ID]',
        'compile-status',
        'console [--count N]',
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
        'update [--ref REF] [--dry-run]',
        'config get | config set key=value',
        'probe-port [--start PORT] [--count N]',
      ],
      flags: [
        '--wait', '--wait-timeout MS', '--origin-task-id ID', '--label TEXT',
        '--priority N', '--depends-on CMD_ID',
        '--scene-object PATH  (for set-property / save-as-prefab: target a scene object instead of an asset)',
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
          parent: flags.parent || null,
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
          out(resp.data);
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
        out(resp.data);
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
        const projectRoot = path.resolve(__dirname, '..', '..');

        // Verify git available
        const gitCheck = spawnSync('git', ['--version'], { stdio: 'ignore' });
        if (gitCheck.error || gitCheck.status !== 0) {
          fail('git not found on PATH. Install git and retry.');
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
          { src: '.claude/commands/dreamer.md', dst: '.claude/commands/dreamer.md', type: 'file' },
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

        out({
          updated: true,
          repo: source.repo,
          ref,
          sha: newSha,
          replaced: applied,
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

      case 'probe-port': {
        // Find the first free TCP port in [start, start+count). For multi-
        // project installs: run this during install to pick a non-conflicting
        // port. Does not start the daemon.
        const start = parseInt(flags.start, 10) || configModule.DEFAULT_PORT;
        const count = parseInt(flags.count, 10) || 10;
        const free = await configModule.findFreePort(start, count);
        if (free === null) {
          fail(`No free port in [${start}, ${start + count}). Pass --start / --count to widen the range.`);
        }
        out({ port: free, probedRange: [start, start + count - 1] });
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
