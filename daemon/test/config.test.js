'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

/**
 * config.js captures CONFIG_PATH at module load. To test with a temp path we
 * set DREAMER_CONFIG_PATH *before* requiring the module, and clear require
 * cache between tests so each gets a fresh module with its env-var-driven path.
 */

let tmpDir;
let tmpConfigPath;
let tmpRegistryPath;

function loadConfigModule() {
  delete require.cache[require.resolve('../src/config')];
  // project-registry also caches path in module state, so reload it too.
  delete require.cache[require.resolve('../src/project-registry')];
  return require('../src/config');
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dreamer-cfg-'));
  tmpConfigPath = path.join(tmpDir, 'test-config.json');
  tmpRegistryPath = path.join(tmpDir, 'projects.json');
  process.env.DREAMER_CONFIG_PATH = tmpConfigPath;
  // Isolate getPort() from the real user's ~/.dreamer or %APPDATA% registry.
  // Without this, tests that rely on getPort falling back to config or default
  // will instead pick up the active dev machine's registered port and fail.
  process.env.DREAMER_REGISTRY_PATH = tmpRegistryPath;
  delete process.env.DREAMER_PORT;
});

afterEach(() => {
  delete process.env.DREAMER_CONFIG_PATH;
  delete process.env.DREAMER_REGISTRY_PATH;
  delete process.env.DREAMER_PORT;
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

test('load returns {} when config file does not exist', () => {
  const config = loadConfigModule();
  assert.deepEqual(config.load(), {});
});

test('load returns parsed JSON when config exists', () => {
  fs.writeFileSync(tmpConfigPath, JSON.stringify({ port: 19000, autoFocus: false }));
  const config = loadConfigModule();
  assert.deepEqual(config.load(), { port: 19000, autoFocus: false });
});

test('load returns {} for malformed JSON (no throw)', () => {
  fs.writeFileSync(tmpConfigPath, '{ not valid json');
  const config = loadConfigModule();
  assert.deepEqual(config.load(), {});
});

test('save writes pretty-printed JSON that round-trips through load', () => {
  const config = loadConfigModule();
  config.save({ port: 20000, autoFocus: true, defaultWaitTimeout: 45000 });
  const raw = fs.readFileSync(tmpConfigPath, 'utf8');
  assert.ok(raw.includes('\n'), 'should be pretty-printed');
  assert.deepEqual(config.load(), { port: 20000, autoFocus: true, defaultWaitTimeout: 45000 });
});

test('getPort returns DREAMER_PORT env var when set (highest precedence)', () => {
  fs.writeFileSync(tmpConfigPath, JSON.stringify({ port: 19000 }));
  process.env.DREAMER_PORT = '25555';
  const config = loadConfigModule();
  assert.equal(config.getPort(), 25555);
});

test('getPort falls back to config file port when env is unset', () => {
  fs.writeFileSync(tmpConfigPath, JSON.stringify({ port: 19001 }));
  const config = loadConfigModule();
  assert.equal(config.getPort(), 19001);
});

test('getPort returns 18710 when neither env nor config has a port', () => {
  const config = loadConfigModule();
  assert.equal(config.getPort(), 18710);
});

test('getPort ignores non-integer or non-positive config port values', () => {
  fs.writeFileSync(tmpConfigPath, JSON.stringify({ port: 'nope' }));
  const config = loadConfigModule();
  assert.equal(config.getPort(), 18710);
});

test('isPortFree returns true for a high unused port', async () => {
  const config = loadConfigModule();
  assert.equal(await config.isPortFree(55123), true);
});

test('isPortFree returns false while a listener occupies the port', async () => {
  const config = loadConfigModule();
  const server = net.createServer();
  await new Promise((resolve) => server.listen(55124, '127.0.0.1', resolve));
  try {
    assert.equal(await config.isPortFree(55124), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('findFreePort skips a busy port and returns the next free one', async () => {
  const config = loadConfigModule();
  const server = net.createServer();
  await new Promise((resolve) => server.listen(55125, '127.0.0.1', resolve));
  try {
    const port = await config.findFreePort(55125, 4);
    assert.notEqual(port, 55125);
    assert.ok(port >= 55126 && port < 55129);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('findFreePort returns null when the whole range is busy', async () => {
  const config = loadConfigModule();
  const servers = [];
  try {
    for (const p of [55130, 55131, 55132]) {
      const s = net.createServer();
      await new Promise((resolve) => s.listen(p, '127.0.0.1', resolve));
      servers.push(s);
    }
    const port = await config.findFreePort(55130, 3);
    assert.equal(port, null);
  } finally {
    for (const s of servers) await new Promise((resolve) => s.close(resolve));
  }
});
