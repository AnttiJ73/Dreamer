'use strict';

const fs = require('fs');
const path = require('path');
const { validateTransition, isTerminalState } = require('./command');
const log = require('./log').create('queue');

const PRUNE_AGE_MS = 60 * 60 * 1000; // 1 hour
const DEBOUNCE_MS = 100;

/** In-memory command queue with JSON file persistence. */
class CommandQueue {
  constructor(filePath) {
    this.filePath = filePath;
    this.commands = new Map();
    this._saveTimer = null;
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          for (const cmd of arr) {
            if (cmd && cmd.id) this.commands.set(cmd.id, cmd);
          }
        }
      }
    } catch (err) {
      log.error(`Failed to load queue file: ${err.message}`);
    }
    this._prune();
  }

  shutdown() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    this._persistSync();
  }

  add(cmd) {
    this.commands.set(cmd.id, cmd);
    this._scheduleSave();
    return cmd;
  }

  get(id) {
    return this.commands.get(id) || null;
  }

  update(id, changes) {
    const cmd = this.commands.get(id);
    if (!cmd) throw new Error(`Command not found: ${id}`);

    if (changes.state && changes.state !== cmd.state) {
      const result = validateTransition(cmd.state, changes.state);
      if (!result.valid) throw new Error(result.reason);
    }

    Object.assign(cmd, changes, { updatedAt: new Date().toISOString() });

    if (changes.state === 'dispatched' && !cmd.dispatchedAt) {
      cmd.dispatchedAt = cmd.updatedAt;
      cmd.attemptCount = (cmd.attemptCount || 0) + 1;
    }
    if (isTerminalState(changes.state) && !cmd.completedAt) {
      cmd.completedAt = cmd.updatedAt;
    }

    this._scheduleSave();
    return cmd;
  }

  cancel(id) {
    const cmd = this.commands.get(id);
    if (!cmd) throw new Error(`Command not found: ${id}`);
    if (isTerminalState(cmd.state)) {
      throw new Error(`Cannot cancel command in terminal state '${cmd.state}'`);
    }
    return this.update(id, { state: 'cancelled' });
  }

  list(filters = {}) {
    let results = Array.from(this.commands.values());

    if (filters.state) {
      results = results.filter(c => c.state === filters.state);
    }
    if (filters.originTaskId) {
      results = results.filter(c => c.originTaskId === filters.originTaskId);
    }

    results.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return new Date(a.createdAt) - new Date(b.createdAt);
    });

    if (filters.limit && filters.limit > 0) {
      results = results.slice(0, filters.limit);
    }

    return results;
  }

  getPending() {
    return this.list({ state: 'dispatched' });
  }

  getStats() {
    const stats = { total: this.commands.size };
    for (const cmd of this.commands.values()) {
      stats[cmd.state] = (stats[cmd.state] || 0) + 1;
    }
    return stats;
  }

  _prune() {
    const cutoff = Date.now() - PRUNE_AGE_MS;
    for (const [id, cmd] of this.commands) {
      if (isTerminalState(cmd.state) && cmd.completedAt) {
        if (new Date(cmd.completedAt).getTime() < cutoff) {
          this.commands.delete(id);
        }
      }
    }
  }

  _scheduleSave() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._persistSync();
    }, DEBOUNCE_MS);
  }

  _persistSync() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const data = JSON.stringify(Array.from(this.commands.values()), null, 2);
      fs.writeFileSync(this.filePath, data, 'utf8');
    } catch (err) {
      log.error(`Failed to persist: ${err.message}`);
    }
  }
}

module.exports = CommandQueue;
