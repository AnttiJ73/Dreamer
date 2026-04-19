'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');

// Path precedence: DREAMER_CONFIG_PATH env var > conventional daemon/.dreamer-config.json.
// The env-var override exists primarily for tests and unusual dev setups.
const CONFIG_PATH = process.env.DREAMER_CONFIG_PATH
  || path.join(path.resolve(__dirname, '..'), '.dreamer-config.json');
const DEFAULT_PORT = 18710;

/** Read `.dreamer-config.json`. Returns `{}` if missing or malformed. */
function load() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch { /* ignore malformed */ }
  return {};
}

/** Atomically write `.dreamer-config.json` (pretty-printed). */
function save(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

/**
 * Synchronous port resolution. Precedence:
 *   DREAMER_PORT env var > per-project registry entry > legacy .dreamer-config.json > 18710
 *
 * This is the fast path used by every CLI HTTP call and by the daemon's own
 * startup — it does no port allocation, no file writes, no probing. If no
 * registry entry exists for this project, callers that need to *create* one
 * should use ensureRegisteredPort() (async) instead.
 *
 * @param {string} [projectRoot] - the Unity project root; defaults to the
 *   daemon's own project (daemon folder's parent).
 */
function getPort(projectRoot) {
  const env = parseInt(process.env.DREAMER_PORT, 10);
  if (Number.isInteger(env) && env > 0) return env;

  try {
    // Lazy require to avoid a cycle with project-registry.js at module load.
    const registry = require('./project-registry');
    const root = projectRoot || path.resolve(__dirname, '..', '..');
    const port = registry.getPortForProject(root);
    if (Number.isInteger(port) && port > 0) return port;
  } catch { /* fall through to legacy */ }

  const cfg = load();
  if (Number.isInteger(cfg.port) && cfg.port > 0) return cfg.port;
  return DEFAULT_PORT;
}

/**
 * Asynchronous variant used by the daemon at startup and by the CLI's
 * `ensureDaemon()` path: resolves a port for `projectRoot`, registering a new
 * entry in the projects registry if one doesn't exist yet.
 *
 * @param {string} projectRoot - absolute path to the Unity project root
 * @param {object} [opts]
 * @param {string} [opts.daemonRoot]
 * @returns {Promise<{port:number, entry:object|null, source:string}>}
 */
async function ensureRegisteredPort(projectRoot, opts = {}) {
  const env = parseInt(process.env.DREAMER_PORT, 10);
  if (Number.isInteger(env) && env > 0) {
    return { port: env, entry: null, source: 'env' };
  }

  const registry = require('./project-registry');
  // If the legacy per-project config has a port, honour it as a migration hint
  // the first time we register — keeps existing setups on their chosen port.
  const legacy = load();
  const preferredPort = Number.isInteger(legacy.port) && legacy.port > 0 ? legacy.port : undefined;

  const entry = await registry.ensureEntry(projectRoot, {
    daemonRoot: opts.daemonRoot,
    preferredPort,
  });
  return { port: entry.port, entry, source: 'registry' };
}

/**
 * Probe whether a TCP port on localhost is free. Tests both directions:
 *   1. Can we connect? If yes, something is listening → NOT free.
 *   2. Can we bind? If no (EADDRINUSE), something holds it → NOT free.
 * Needed on Windows where one side of the test can pass while the other fails
 * (e.g. daemon binds 0.0.0.0, we probe 127.0.0.1 — bind may succeed, connect
 * will still succeed and reveal the collision).
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function isPortFree(port) {
  // Step 1 — if we can connect, something is listening.
  const connectCheck = new Promise((resolve) => {
    const c = net.createConnection({ port, host: '127.0.0.1' });
    const done = (listening) => { try { c.destroy(); } catch { /* ignore */ } resolve(listening); };
    c.once('connect', () => done(true));
    c.once('error', () => done(false));
    c.setTimeout(300, () => done(false));
  });
  return connectCheck.then((listening) => {
    if (listening) return false;
    // Step 2 — nothing is listening; can we bind?
    return new Promise((resolve) => {
      const s = net.createServer();
      s.once('error', () => resolve(false));
      s.once('listening', () => s.close(() => resolve(true)));
      try { s.listen(port, '0.0.0.0'); }
      catch { resolve(false); }
    });
  });
}

/**
 * Find the first free port in [start, start+count). Returns the port or null.
 * @param {number} [start=18710]
 * @param {number} [count=10]
 */
async function findFreePort(start = DEFAULT_PORT, count = 10) {
  for (let p = start; p < start + count; p++) {
    if (await isPortFree(p)) return p;
  }
  return null;
}

module.exports = {
  CONFIG_PATH,
  DEFAULT_PORT,
  load,
  save,
  getPort,
  ensureRegisteredPort,
  isPortFree,
  findFreePort,
};
