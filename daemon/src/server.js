'use strict';

const http = require('http');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');

const CommandQueue = require('./queue');
const UnityState = require('./unity-state');
const Scheduler = require('./scheduler');
const AssetWatcher = require('./asset-watcher');
const { ensureRegisteredPort } = require('./config');
const projectRegistry = require('./project-registry');
const log = require('./log').create('server');
const createCommandHandlers = require('./handlers/commands');
const createUnityHandlers = require('./handlers/unity');
const createStatusHandlers = require('./handlers/status');
const { disableEcoQoSForSelf } = require('./windows-qos');

const DAEMON_DIR = path.resolve(__dirname, '..');
const DAEMON_PROJECT_ROOT = path.resolve(DAEMON_DIR, '..');
const QUEUE_FILE = path.join(DAEMON_DIR, '.dreamer-queue.json');
const PID_FILE = path.join(DAEMON_DIR, '.dreamer-daemon.pid');

const queue = new CommandQueue(QUEUE_FILE);
queue.load();

const unityState = new UnityState();
const scheduler = new Scheduler(queue, unityState);
const assetWatcher = new AssetWatcher(path.resolve(DAEMON_DIR, '..'));
assetWatcher.start();
const commandHandlers = createCommandHandlers(queue, scheduler, unityState, assetWatcher);
const unityHandlers = createUnityHandlers(queue, unityState, scheduler, assetWatcher);
const statusHandlers = createStatusHandlers(queue, unityState, assetWatcher, scheduler);

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw || raw.trim() === '') return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON in request body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': 'http://localhost',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

function parseURL(urlStr) {
  const parsed = new URL(urlStr, 'http://localhost');
  const query = {};
  for (const [k, v] of parsed.searchParams) query[k] = v;
  return { pathname: parsed.pathname, query };
}

function isLocalhost(req) {
  const addr = req.socket.remoteAddress;
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

/** Match `pathname` against a `:id`-style pattern, returning the params or null. */
function matchRoute(pathname, pattern) {
  const pathParts = pathname.split('/').filter(Boolean);
  const patParts = pattern.split('/').filter(Boolean);
  if (pathParts.length !== patParts.length) return null;
  const params = {};
  for (let i = 0; i < patParts.length; i++) {
    if (patParts[i].startsWith(':')) {
      params[patParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
    } else if (patParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

async function handleRequest(req, res) {
  if (req.method === 'OPTIONS') {
    sendJSON(res, 204, null);
    return;
  }

  if (!isLocalhost(req)) {
    sendJSON(res, 403, { error: 'Forbidden: only localhost connections allowed' });
    return;
  }

  const { pathname, query } = parseURL(req.url);
  const method = req.method;

  try {
    let result;

    if (method === 'POST' && pathname === '/api/commands') {
      const body = await readBody(req);
      result = await commandHandlers.submit(body);

    } else if (method === 'GET' && pathname === '/api/commands') {
      result = await commandHandlers.list(query);

    } else if (method === 'GET' && matchRoute(pathname, '/api/commands/:id')) {
      const { id } = matchRoute(pathname, '/api/commands/:id');
      result = await commandHandlers.get(id);

    } else if (method === 'DELETE' && matchRoute(pathname, '/api/commands/:id')) {
      const { id } = matchRoute(pathname, '/api/commands/:id');
      result = await commandHandlers.cancel(id);

    } else if (method === 'GET' && pathname === '/api/unity/pending') {
      result = await unityHandlers.pending();

    } else if (method === 'POST' && pathname === '/api/unity/result') {
      const body = await readBody(req);
      result = await unityHandlers.result(body);

    } else if (method === 'POST' && pathname === '/api/unity/state') {
      const body = await readBody(req);
      result = await unityHandlers.state(body);

    } else if (method === 'POST' && pathname === '/api/unity/heartbeat') {
      const body = await readBody(req);
      result = await unityHandlers.heartbeat(body);

    } else if (method === 'GET' && pathname === '/api/status') {
      result = await statusHandlers.status();

    } else if (method === 'GET' && pathname === '/api/compile-status') {
      result = await statusHandlers.compileStatus();

    } else if (method === 'GET' && pathname === '/api/console') {
      result = await statusHandlers.console(query);

    } else if (method === 'GET' && pathname === '/api/activity') {
      result = await statusHandlers.activity(query);

    } else if (method === 'POST' && pathname === '/api/shutdown') {
      sendJSON(res, 200, { ok: true, message: 'Shutting down' });
      shutdown();
      return;

    } else {
      result = { status: 404, body: { error: `Not found: ${method} ${pathname}` } };
    }

    sendJSON(res, result.status, result.body);

  } catch (err) {
    log.error(`Request error: ${err.message}`);
    sendJSON(res, 500, { error: err.message });
  }
}

const server = http.createServer(handleRequest);

function shutdown() {
  log.info('Shutting down gracefully...');
  scheduler.stop();
  queue.shutdown();

  // Clear daemonPid from registry so the next CLI invocation sees a clean slate.
  try {
    projectRegistry.updateEntry(DAEMON_PROJECT_ROOT, { daemonPid: null });
  } catch { /* ignore */ }

  try {
    if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
  } catch { /* ignore */ }

  server.close(() => {
    log.info('Closed.');
    process.exit(0);
  });

  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

(async () => {
  let port;
  let registryEntry = null;
  try {
    const resolved = await ensureRegisteredPort(DAEMON_PROJECT_ROOT, { daemonRoot: DAEMON_DIR });
    port = resolved.port;
    registryEntry = resolved.entry;
    log.info(`Using port ${port} for project ${DAEMON_PROJECT_ROOT} (source: ${resolved.source})`);
  } catch (err) {
    log.error(`Failed to resolve port from registry: ${err.message}`);
    process.exit(1);
  }

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      log.error(`Port ${port} already in use. Another process is holding it — ` +
        `check the project registry (${projectRegistry.getRegistryPath()}) ` +
        'or stop the conflicting process.');
      process.exit(1);
    }
    log.error(`Server error: ${err.message}`);
  });

  // Dual-stack (IPv4 + IPv6). On Windows, `localhost` resolves to ::1 first for many
  // configurations — binding IPv4-only ('0.0.0.0') leaves IPv6 clients stuck in SYN_SENT
  // until they time out. Node's '::' listens on both stacks. isLocalhost() already accepts
  // 127.0.0.1, ::1, and ::ffff:127.0.0.1.
  server.listen(port, '::', () => {
    log.info(`Listening on [::]:${port} (dual-stack)`);

    // Opt out of Win11 EcoQoS so heartbeats don't slip past the daemon's
    // 25s timeout when this Node process is unfocused under contention.
    disableEcoQoSForSelf();

    try {
      projectRegistry.updateEntry(DAEMON_PROJECT_ROOT, {
        daemonPid: process.pid,
        lastStartedAt: new Date().toISOString(),
      });
    } catch (err) {
      log.warn(`Failed to update registry: ${err.message}`);
    }

    // Legacy PID file — still used by daemon-manager liveness checks.
    try {
      fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');
    } catch (err) {
      log.error(`Failed to write PID file: ${err.message}`);
    }

    scheduler.start();
    log.info('Scheduler started');
  });
})();
