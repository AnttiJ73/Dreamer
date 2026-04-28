'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');

// CONFIG_PATH precedence: DREAMER_CONFIG_PATH env (tests / dev) > daemon/.dreamer-config.json.
const CONFIG_PATH = process.env.DREAMER_CONFIG_PATH
  || path.join(path.resolve(__dirname, '..'), '.dreamer-config.json');
const DEFAULT_PORT = 18710;

function load() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch { /* ignore malformed */ }
  return {};
}

function save(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

/**
 * Sync port resolution. Precedence: DREAMER_PORT > registry > legacy config > 18710.
 * Fast path — no allocation/probing. Use ensureRegisteredPort() (async) to create entries.
 */
function getPort(projectRoot) {
  const env = parseInt(process.env.DREAMER_PORT, 10);
  if (Number.isInteger(env) && env > 0) return env;

  try {
    // Lazy require — project-registry.js requires us back.
    const registry = require('./project-registry');
    const root = projectRoot || path.resolve(__dirname, '..', '..');
    const port = registry.getPortForProject(root);
    if (Number.isInteger(port) && port > 0) return port;
  } catch { /* fall through to legacy */ }

  const cfg = load();
  if (Number.isInteger(cfg.port) && cfg.port > 0) return cfg.port;
  return DEFAULT_PORT;
}

/** Async port resolver — registers a new entry if one doesn't exist. */
async function ensureRegisteredPort(projectRoot, opts = {}) {
  const env = parseInt(process.env.DREAMER_PORT, 10);
  if (Number.isInteger(env) && env > 0) {
    return { port: env, entry: null, source: 'env' };
  }

  const registry = require('./project-registry');
  // Migration hint: keep existing setups on their legacy-config port for the first registration.
  const legacy = load();
  const preferredPort = Number.isInteger(legacy.port) && legacy.port > 0 ? legacy.port : undefined;

  const entry = await registry.ensureEntry(projectRoot, {
    daemonRoot: opts.daemonRoot,
    preferredPort,
  });
  return { port: entry.port, entry, source: 'registry' };
}

/**
 * Probe loopback port — tests both connect AND bind. On Windows one side can
 * pass while the other fails (daemon binds 0.0.0.0, we probe 127.0.0.1), so
 * the OR is load-bearing.
 */
function isPortFree(port) {
  const connectCheck = new Promise((resolve) => {
    const c = net.createConnection({ port, host: '127.0.0.1' });
    const done = (listening) => { try { c.destroy(); } catch { /* ignore */ } resolve(listening); };
    c.once('connect', () => done(true));
    c.once('error', () => done(false));
    c.setTimeout(300, () => done(false));
  });
  return connectCheck.then((listening) => {
    if (listening) return false;
    return new Promise((resolve) => {
      const s = net.createServer();
      s.once('error', () => resolve(false));
      s.once('listening', () => s.close(() => resolve(true)));
      try { s.listen(port, '0.0.0.0'); }
      catch { resolve(false); }
    });
  });
}

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
