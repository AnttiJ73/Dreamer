'use strict';

/**
 * Multi-project registry: maps Unity project paths to daemon ports.
 *
 * File location:
 *   Windows: %APPDATA%/Dreamer/projects.json
 *   Unix:    ~/.dreamer/projects.json
 *
 * Shape (v1):
 *   {
 *     "version": 1,
 *     "projects": {
 *       "<normalizedPath>": {
 *         "projectPath": "<display path>",
 *         "port": 18710,
 *         "daemonRoot": "<path/to/daemon/>",
 *         "daemonPid": 12345,
 *         "createdAt": ISO,
 *         "lastStartedAt": ISO
 *       },
 *       ...
 *     }
 *   }
 *
 * The registry is the single source of truth for port-per-project routing.
 * Both the daemon (on startup) and every CLI invocation reads this file;
 * the Unity bridge reads a parallel C# implementation (Editor/Core/ProjectRegistry.cs).
 *
 * Port allocation: starts at 18710, picks the first port not used by any
 * other registered project AND actually free on the loopback interface.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { isPortFree } = require('./config');

const REGISTRY_VERSION = 1;
const DEFAULT_PORT_BASE = 18710;
const PORT_RANGE = 100; // search [base, base + PORT_RANGE)

// ── File location ────────────────────────────────────────────────────────────

function getRegistryDir() {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    if (appData) return path.join(appData, 'Dreamer');
  }
  return path.join(os.homedir(), '.dreamer');
}

function getRegistryPath() {
  // Allow test/dev override.
  if (process.env.DREAMER_REGISTRY_PATH) return process.env.DREAMER_REGISTRY_PATH;
  return path.join(getRegistryDir(), 'projects.json');
}

// ── Path normalization ───────────────────────────────────────────────────────

/**
 * Canonical key for registry entries. Case-insensitive on Windows; always
 * forward-slash separated; no trailing slash.
 */
function normalizeProjectPath(p) {
  if (!p || typeof p !== 'string') return null;
  let n = p.replace(/\\/g, '/').replace(/\/+$/, '');
  if (process.platform === 'win32') n = n.toLowerCase();
  return n;
}

/**
 * Walk up from `start` looking for a Unity project root (presence of
 * `ProjectSettings/ProjectVersion.txt`). Returns null if nothing matches.
 */
function resolveProjectRoot(start) {
  let cur = path.resolve(start);
  while (true) {
    try {
      if (fs.existsSync(path.join(cur, 'ProjectSettings', 'ProjectVersion.txt'))) {
        return cur;
      }
    } catch { /* ignore */ }
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

// ── Load / save ──────────────────────────────────────────────────────────────

function emptyRegistry() {
  return { version: REGISTRY_VERSION, projects: {} };
}

function load() {
  const p = getRegistryPath();
  try {
    if (!fs.existsSync(p)) return emptyRegistry();
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return emptyRegistry();
    if (!parsed.projects || typeof parsed.projects !== 'object') parsed.projects = {};
    if (!parsed.version) parsed.version = REGISTRY_VERSION;
    return parsed;
  } catch {
    // Corrupted registry — return empty; caller can choose to rebuild.
    return emptyRegistry();
  }
}

function save(reg) {
  const p = getRegistryPath();
  const dir = path.dirname(p);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch { /* ignore */ }
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(reg, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, p);
}

// ── Lookup ───────────────────────────────────────────────────────────────────

function findEntry(reg, projectPath) {
  const key = normalizeProjectPath(projectPath);
  if (!key || !reg || !reg.projects) return null;
  const entry = reg.projects[key];
  return entry || null;
}

/**
 * Sync, read-only port lookup. Returns null if the project isn't registered.
 */
function getPortForProject(projectPath) {
  const reg = load();
  const entry = findEntry(reg, projectPath);
  return entry ? entry.port : null;
}

// ── Allocation ───────────────────────────────────────────────────────────────

function portsInUse(reg) {
  const used = new Set();
  for (const k of Object.keys(reg.projects || {})) {
    const p = reg.projects[k].port;
    if (Number.isInteger(p)) used.add(p);
  }
  return used;
}

/**
 * Pick the first port not claimed by another registered project AND actually
 * free on the loopback interface (no stray daemon / unrelated process holding
 * it). Returns null if the whole range is exhausted.
 */
async function allocatePort(reg, preferredPort) {
  const used = portsInUse(reg);

  const candidates = [];
  if (Number.isInteger(preferredPort) && preferredPort > 0) candidates.push(preferredPort);
  for (let p = DEFAULT_PORT_BASE; p < DEFAULT_PORT_BASE + PORT_RANGE; p++) {
    if (!candidates.includes(p)) candidates.push(p);
  }

  for (const port of candidates) {
    if (used.has(port)) continue;
    if (await isPortFree(port)) return port;
  }
  return null;
}

// ── Entry lifecycle ──────────────────────────────────────────────────────────

/**
 * Get the registered entry for `projectPath`, creating one (with an allocated
 * port) if none exists. Persists to disk on allocation.
 *
 * @param {string} projectPath - the Unity project root
 * @param {object} [opts]
 * @param {string} [opts.daemonRoot] - path to the daemon/ folder serving this project
 * @param {number} [opts.preferredPort] - port hint (e.g. from migration of old config)
 * @returns {Promise<{port:number, projectPath:string, daemonRoot?:string, ...}>}
 */
async function ensureEntry(projectPath, opts = {}) {
  if (!projectPath) throw new Error('ensureEntry: projectPath is required');
  const key = normalizeProjectPath(projectPath);

  const reg = load();
  const existing = reg.projects[key];
  if (existing && Number.isInteger(existing.port)) {
    // Keep metadata fresh.
    let changed = false;
    if (opts.daemonRoot && existing.daemonRoot !== opts.daemonRoot) {
      existing.daemonRoot = opts.daemonRoot;
      changed = true;
    }
    if (changed) save(reg);
    return existing;
  }

  const port = await allocatePort(reg, opts.preferredPort);
  if (port == null) {
    throw new Error(`No free port in [${DEFAULT_PORT_BASE}, ${DEFAULT_PORT_BASE + PORT_RANGE}) — registry full?`);
  }

  const now = new Date().toISOString();
  const entry = {
    projectPath,
    port,
    daemonRoot: opts.daemonRoot || null,
    daemonPid: null,
    createdAt: now,
    lastStartedAt: null,
  };
  reg.projects[key] = entry;
  save(reg);
  return entry;
}

/**
 * Patch fields on an existing entry (e.g. daemonPid, lastStartedAt). No-op if
 * the entry doesn't exist. Port is never changed by this function.
 */
function updateEntry(projectPath, patch) {
  const key = normalizeProjectPath(projectPath);
  const reg = load();
  const entry = reg.projects[key];
  if (!entry) return null;
  for (const k of Object.keys(patch || {})) {
    if (k === 'port') continue; // never overwrite port this way
    entry[k] = patch[k];
  }
  save(reg);
  return entry;
}

/** Remove an entry (used by admin commands, not auto-cleanup). */
function removeEntry(projectPath) {
  const key = normalizeProjectPath(projectPath);
  const reg = load();
  if (!reg.projects[key]) return false;
  delete reg.projects[key];
  save(reg);
  return true;
}

/** All registered projects (array of entries). */
function listEntries() {
  const reg = load();
  return Object.values(reg.projects || {});
}

module.exports = {
  REGISTRY_VERSION,
  DEFAULT_PORT_BASE,
  PORT_RANGE,
  getRegistryPath,
  normalizeProjectPath,
  resolveProjectRoot,
  load,
  save,
  findEntry,
  getPortForProject,
  ensureEntry,
  updateEntry,
  removeEntry,
  listEntries,
  allocatePort,
};
