'use strict';

const fs = require('fs');
const path = require('path');
const { validateTransition, isTerminalState } = require('./command');
const log = require('./log').create('queue');

const PRUNE_AGE_MS = 60 * 60 * 1000; // 1 hour
const DEBOUNCE_MS = 100;

/**
 * In-memory command queue with JSON file persistence.
 */
class CommandQueue {
  /**
   * @param {string} filePath - Path to the persistence JSON file
   */
  constructor(filePath) {
    this.filePath = filePath;
    /** @type {Map<string, object>} */
    this.commands = new Map();
    this._saveTimer = null;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Load persisted queue from disk. Safe to call if file doesn't exist.
   */
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

  /**
   * Flush any pending writes and clear the debounce timer.
   */
  shutdown() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    this._persistSync();
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  /**
   * Add a command to the queue.
   * @param {object} cmd - A command object (from createCommand)
   * @returns {object} The added command
   */
  add(cmd) {
    this.commands.set(cmd.id, cmd);
    this._scheduleSave();
    return cmd;
  }

  /**
   * Get a command by ID.
   * @param {string} id
   * @returns {object|null}
   */
  get(id) {
    return this.commands.get(id) || null;
  }

  /**
   * Update fields on a command. Validates state transitions.
   * @param {string} id
   * @param {object} changes
   * @returns {object} Updated command
   */
  update(id, changes) {
    const cmd = this.commands.get(id);
    if (!cmd) throw new Error(`Command not found: ${id}`);

    // Validate state transition if state is changing
    if (changes.state && changes.state !== cmd.state) {
      const result = validateTransition(cmd.state, changes.state);
      if (!result.valid) throw new Error(result.reason);
    }

    // Apply changes
    Object.assign(cmd, changes, { updatedAt: new Date().toISOString() });

    // Set timestamp helpers
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

  /**
   * Cancel a command (if not already terminal).
   * @param {string} id
   * @returns {object} Updated command
   */
  cancel(id) {
    const cmd = this.commands.get(id);
    if (!cmd) throw new Error(`Command not found: ${id}`);
    if (isTerminalState(cmd.state)) {
      throw new Error(`Cannot cancel command in terminal state '${cmd.state}'`);
    }
    return this.update(id, { state: 'cancelled' });
  }

  /**
   * List commands, optionally filtered.
   * @param {object} [filters]
   * @param {string} [filters.state]
   * @param {string} [filters.originTaskId]
   * @param {number} [filters.limit]
   * @returns {object[]}
   */
  list(filters = {}) {
    let results = Array.from(this.commands.values());

    if (filters.state) {
      results = results.filter(c => c.state === filters.state);
    }
    if (filters.originTaskId) {
      results = results.filter(c => c.originTaskId === filters.originTaskId);
    }

    // Sort: highest priority first, then oldest first
    results.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return new Date(a.createdAt) - new Date(b.createdAt);
    });

    if (filters.limit && filters.limit > 0) {
      results = results.slice(0, filters.limit);
    }

    return results;
  }

  /**
   * Get all commands in 'dispatched' or 'queued' state that are ready for Unity.
   * The scheduler is responsible for moving commands to 'dispatched' —
   * this just returns what's already dispatched.
   * @returns {object[]}
   */
  getPending() {
    return this.list({ state: 'dispatched' });
  }

  /**
   * Summary stats.
   */
  getStats() {
    const stats = { total: this.commands.size };
    for (const cmd of this.commands.values()) {
      stats[cmd.state] = (stats[cmd.state] || 0) + 1;
    }
    return stats;
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  /**
   * Remove completed commands older than PRUNE_AGE_MS.
   */
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

  /** Debounced persist */
  _scheduleSave() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._persistSync();
    }, DEBOUNCE_MS);
  }

  /** Write queue to disk synchronously */
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
