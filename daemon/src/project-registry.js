'use strict';

// Multi-project registry — single source of truth for port-per-project routing.
// File: %APPDATA%/Dreamer/projects.json (Windows) or ~/.dreamer/projects.json (Unix).
// Daemon, CLI, and Unity bridge (Editor/Core/ProjectRegistry.cs) all read it.
// Port allocation walks [18710, 18810) for a free port not claimed elsewhere.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { isPortFree } = require('./config');

const REGISTRY_VERSION = 1;
const DEFAULT_PORT_BASE = 18710;
const PORT_RANGE = 100;

function getRegistryDir() {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    if (appData) return path.join(appData, 'Dreamer');
  }
  return path.join(os.homedir(), '.dreamer');
}

function getRegistryPath() {
  if (process.env.DREAMER_REGISTRY_PATH) return process.env.DREAMER_REGISTRY_PATH;
  return path.join(getRegistryDir(), 'projects.json');
}

/** Canonical registry key. Case-insensitive on Windows; forward-slash; no trailing slash. */
function normalizeProjectPath(p) {
  if (!p || typeof p !== 'string') return null;
  let n = p.replace(/\\/g, '/').replace(/\/+$/, '');
  if (process.platform === 'win32') n = n.toLowerCase();
  return n;
}

/** Walk up from `start` to a Unity project root (ProjectSettings/ProjectVersion.txt). */
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

function findEntry(reg, projectPath) {
  const key = normalizeProjectPath(projectPath);
  if (!key || !reg || !reg.projects) return null;
  const entry = reg.projects[key];
  return entry || null;
}

/** Sync, read-only port lookup. Returns null if the project isn't registered. */
function getPortForProject(projectPath) {
  const reg = load();
  const entry = findEntry(reg, projectPath);
  return entry ? entry.port : null;
}

function portsInUse(reg) {
  const used = new Set();
  for (const k of Object.keys(reg.projects || {})) {
    const p = reg.projects[k].port;
    if (Number.isInteger(p)) used.add(p);
  }
  return used;
}

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

/** Get-or-create a registry entry for `projectPath`. Allocates a port + persists. */
async function ensureEntry(projectPath, opts = {}) {
  if (!projectPath) throw new Error('ensureEntry: projectPath is required');
  const key = normalizeProjectPath(projectPath);

  const reg = load();
  const existing = reg.projects[key];
  if (existing && Number.isInteger(existing.port)) {
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

/** Patch fields on an existing entry. No-op if absent. Port is never patched. */
function updateEntry(projectPath, patch) {
  const key = normalizeProjectPath(projectPath);
  const reg = load();
  const entry = reg.projects[key];
  if (!entry) return null;
  for (const k of Object.keys(patch || {})) {
    if (k === 'port') continue;
    entry[k] = patch[k];
  }
  save(reg);
  return entry;
}

function removeEntry(projectPath) {
  const key = normalizeProjectPath(projectPath);
  const reg = load();
  if (!reg.projects[key]) return false;
  delete reg.projects[key];
  save(reg);
  return true;
}

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
