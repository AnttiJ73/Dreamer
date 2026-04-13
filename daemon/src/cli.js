'use strict';

const { ensureDaemon, isDaemonRunning, startDaemon, stopDaemon, httpRequest, focusUnity } = require('./daemon-manager');

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
  // Skip with --no-focus flag.
  if (!flags['no-focus']) {
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
        'add-component --asset PATH_OR_GUID --type TYPENAME',
        'remove-component --asset PATH_OR_GUID --type TYPENAME',
        'set-property (--asset PATH | --scene-object /PATH) [--component TYPE] --property PATH --value JSON',
        'create-prefab --name NAME [--path FOLDER]',
        'instantiate-prefab --asset PATH [--name NAME] [--parent /PATH] [--position {x,y,z}]',
        'create-gameobject --name NAME [--parent PATH] [--scene SCENE]',
        'save-assets',
        'status [--id CMD_ID]',
        'queue [--state STATE] [--task TASK_ID]',
        'compile-status',
        'console [--count N]',
        'daemon start|stop|status',
      ],
      flags: ['--wait', '--wait-timeout MS', '--origin-task-id ID', '--label TEXT', '--priority N', '--depends-on CMD_ID'],
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
        const target = positional[1];
        if (!target) fail('Usage: dreamer inspect <path-or-guid>');
        // Detect GUID vs path
        const isGuid = /^[0-9a-f]{32}$/i.test(target);
        const args = isGuid ? { guid: target } : { assetPath: target };
        await submitCommand('inspect_asset', args, flags);
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
        if (!flags.asset) fail('--asset is required for add-component');
        if (!flags.type) fail('--type is required for add-component');
        const isGuidAC = /^[0-9a-f]{32}$/i.test(flags.asset);
        await submitCommand('add_component', {
          ...(isGuidAC ? { guid: flags.asset } : { assetPath: flags.asset }),
          typeName: flags.type,
        }, flags);
        break;
      }

      case 'remove-component': {
        if (!flags.asset) fail('--asset is required for remove-component');
        if (!flags.type) fail('--type is required for remove-component');
        const isGuidRC = /^[0-9a-f]{32}$/i.test(flags.asset);
        await submitCommand('remove_component', {
          ...(isGuidRC ? { guid: flags.asset } : { assetPath: flags.asset }),
          typeName: flags.type,
        }, flags);
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

      case 'focus-unity': {
        const focused = await focusUnity();
        out({ focused });
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
