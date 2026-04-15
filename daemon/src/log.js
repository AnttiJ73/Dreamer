'use strict';

/**
 * Dreamer console logger.
 *
 * Branded [Dreamer] prefix + module tag + severity color when stdout is a
 * TTY. Colorless when stdout is piped or redirected to a file (the detached
 * daemon writes to .dreamer-daemon.log through an overridden console.log).
 * Set NO_COLOR=1 to disable ANSI in interactive mode too.
 *
 * Usage:
 *   const log = require('./log').create('server');
 *   log.info('Listening on :18710');
 *   log.warn('Stale PID');
 *   log.error('Port in use');
 */

const USE_COLOR = !!process.stdout.isTTY && !process.env.NO_COLOR;

const c = USE_COLOR
  ? {
      reset: '\x1b[0m',
      bold: '\x1b[1m',
      dim: '\x1b[2m',
      cyan: '\x1b[36m',
      yellow: '\x1b[33m',
      red: '\x1b[31m',
      gray: '\x1b[90m',
    }
  : { reset: '', bold: '', dim: '', cyan: '', yellow: '', red: '', gray: '' };

const BRAND = `${c.cyan}${c.bold}[Dreamer]${c.reset}`;

function format(mod, level, msg) {
  const modTag = mod ? `${c.gray}${mod}${c.reset} ` : '';
  const color = level === 'warn' ? c.yellow : level === 'error' ? c.red : '';
  const body = color ? `${color}${msg}${c.reset}` : msg;
  return `${BRAND} ${modTag}${body}`;
}

function create(mod) {
  return {
    info: (msg) => console.log(format(mod, 'info', msg)),
    warn: (msg) => console.log(format(mod, 'warn', msg)),
    error: (msg) => console.error(format(mod, 'error', msg)),
  };
}

module.exports = { create };
