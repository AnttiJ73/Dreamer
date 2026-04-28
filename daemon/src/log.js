'use strict';

// Two modes: human (TTY, colored `[Dreamer] module msg`, NO_COLOR disables) and
// structured (JSON lines to `.dreamer-daemon.log` when --daemon or DREAMER_LOG_FORMAT=json).
// The detached daemon spawns with stdio:'ignore', so structured mode writes
// directly to the file stream — console.* would go to /dev/null.

const fs = require('fs');
const path = require('path');

const IS_DAEMON = process.argv.includes('--daemon');
const FORMAT_JSON = IS_DAEMON || process.env.DREAMER_LOG_FORMAT === 'json';
const USE_COLOR = !!process.stdout.isTTY && !process.env.NO_COLOR && !FORMAT_JSON;

const LOG_FILE_PATH = path.join(path.resolve(__dirname, '..'), '.dreamer-daemon.log');

let _stream = null;
function getStream() {
  if (_stream) return _stream;
  if (IS_DAEMON) {
    _stream = fs.createWriteStream(LOG_FILE_PATH, { flags: 'a' });
  }
  return _stream;
}

const c = USE_COLOR
  ? {
      reset: '\x1b[0m',
      bold: '\x1b[1m',
      cyan: '\x1b[36m',
      yellow: '\x1b[33m',
      red: '\x1b[31m',
      gray: '\x1b[90m',
    }
  : { reset: '', bold: '', cyan: '', yellow: '', red: '', gray: '' };

const BRAND = `${c.cyan}${c.bold}[Dreamer]${c.reset}`;

function emitHuman(mod, level, msg) {
  const modTag = mod ? `${c.gray}${mod}${c.reset} ` : '';
  const color = level === 'warn' ? c.yellow : level === 'error' ? c.red : '';
  const body = color ? `${color}${msg}${c.reset}` : msg;
  const line = `${BRAND} ${modTag}${body}`;
  if (level === 'error') console.error(line);
  else console.log(line);
}

function emitJson(mod, level, msg) {
  const record = {
    ts: new Date().toISOString(),
    level,
    module: mod || null,
    msg,
  };
  const line = JSON.stringify(record) + '\n';
  const stream = getStream();
  if (stream) {
    stream.write(line);
  } else {
    if (level === 'error') process.stderr.write(line);
    else process.stdout.write(line);
  }
}

const emit = FORMAT_JSON ? emitJson : emitHuman;

function create(mod) {
  return {
    info: (msg) => emit(mod, 'info', msg),
    warn: (msg) => emit(mod, 'warn', msg),
    error: (msg) => emit(mod, 'error', msg),
  };
}

module.exports = { create };
