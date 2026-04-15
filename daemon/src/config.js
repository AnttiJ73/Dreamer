'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');

const CONFIG_PATH = path.join(path.resolve(__dirname, '..'), '.dreamer-config.json');
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
 * Resolve the daemon port with precedence:
 *   DREAMER_PORT env var > config file `port` > 18710
 */
function getPort() {
  const env = parseInt(process.env.DREAMER_PORT, 10);
  if (Number.isInteger(env) && env > 0) return env;
  const cfg = load();
  if (Number.isInteger(cfg.port) && cfg.port > 0) return cfg.port;
  return DEFAULT_PORT;
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
  isPortFree,
  findFreePort,
};
