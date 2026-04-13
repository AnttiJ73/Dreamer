'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DAEMON_DIR = path.resolve(__dirname, '..');
const PID_FILE = path.join(DAEMON_DIR, '.dreamer-daemon.pid');
const SERVER_JS = path.join(__dirname, 'server.js');

/**
 * Get the daemon base URL (respects DREAMER_PORT env).
 * @returns {string}
 */
function getDaemonUrl() {
  const port = parseInt(process.env.DREAMER_PORT, 10) || 18710;
  return `http://127.0.0.1:${port}`;
}

/**
 * Make a simple HTTP request and return parsed JSON.
 * @param {string} method
 * @param {string} urlPath
 * @param {object|null} [body]
 * @returns {Promise<{ status: number, data: any }>}
 */
function httpRequest(method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const base = getDaemonUrl();
    const url = new URL(urlPath, base);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
      timeout: 5000,
    };

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let data = null;
        try { data = JSON.parse(raw); } catch { data = raw; }
        resolve({ status: res.statusCode, data });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

/**
 * Check if the daemon is running by PID file + HTTP health check.
 * @returns {Promise<boolean>}
 */
async function isDaemonRunning() {
  // Quick check: PID file exists?
  if (!fs.existsSync(PID_FILE)) return false;

  let pid;
  try {
    pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
  } catch {
    return false;
  }

  // Check if process exists
  try {
    process.kill(pid, 0); // signal 0 = check existence
  } catch {
    // Process doesn't exist — stale PID file
    try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
    return false;
  }

  // Verify via HTTP health check
  try {
    const resp = await httpRequest('GET', '/api/status');
    return resp.status === 200;
  } catch {
    return false;
  }
}

/**
 * Start the daemon as a detached background process.
 * @returns {Promise<void>}
 */
async function startDaemon() {
  const already = await isDaemonRunning();
  if (already) return;

  // Spawn detached
  const child = spawn(process.execPath, [SERVER_JS, '--daemon'], {
    cwd: DAEMON_DIR,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  });
  child.unref();

  // Wait for the daemon to become ready (poll for up to 5s)
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    await sleep(200);
    try {
      const resp = await httpRequest('GET', '/api/status');
      if (resp.status === 200) return;
    } catch { /* not ready yet */ }
  }

  throw new Error('Daemon failed to start within 5 seconds');
}

/**
 * Stop the daemon gracefully.
 * @returns {Promise<void>}
 */
async function stopDaemon() {
  // Try HTTP shutdown first
  try {
    await httpRequest('POST', '/api/shutdown');
    // Wait a moment for clean exit
    await sleep(500);
    // Verify
    const running = await isDaemonRunning();
    if (!running) return;
  } catch { /* HTTP failed, try PID kill */ }

  // Fallback: kill by PID
  if (fs.existsSync(PID_FILE)) {
    try {
      const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
      process.kill(pid, 'SIGTERM');
      await sleep(500);
    } catch { /* ignore */ }

    // Clean up PID file
    try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
  }
}

/**
 * Ensure the daemon is running. Starts it if not.
 * @returns {Promise<void>}
 */
async function ensureDaemon() {
  const running = await isDaemonRunning();
  if (!running) {
    await startDaemon();
  }
}

/**
 * Focus the Unity Editor window (Windows only).
 * Uses PowerShell to call SetForegroundWindow on the Unity process.
 * @returns {Promise<boolean>} true if Unity was found and focused
 */
async function focusUnity() {
  if (process.platform !== 'win32') {
    // macOS/Linux: not implemented yet
    return false;
  }

  return new Promise((resolve) => {
    const ps = spawn('powershell', ['-NoProfile', '-Command', `
      Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        public class Win32Focus {
          [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
          [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
          [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
          [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
          [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
          [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
          [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
          [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
          [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
        }
"@
      $p = Get-Process -Name Unity -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
      if ($p) {
        $hwnd = $p.MainWindowHandle
        if ([Win32Focus]::IsIconic($hwnd)) {
          [Win32Focus]::ShowWindow($hwnd, 9)
        }
        # Attach to foreground thread to bypass focus-steal prevention
        $fg = [Win32Focus]::GetForegroundWindow()
        $fgThread = [Win32Focus]::GetWindowThreadProcessId($fg, [ref]0)
        $ourThread = [Win32Focus]::GetCurrentThreadId()
        [Win32Focus]::AttachThreadInput($ourThread, $fgThread, $true)
        # Simulate Alt press/release to allow SetForegroundWindow
        [Win32Focus]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
        [Win32Focus]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
        [Win32Focus]::SetForegroundWindow($hwnd)
        [Win32Focus]::BringWindowToTop($hwnd)
        [Win32Focus]::AttachThreadInput($ourThread, $fgThread, $false)
        Write-Output "focused"
      } else {
        Write-Output "not_found"
      }
    `], { stdio: ['ignore', 'pipe', 'pipe'] });

    let output = '';
    ps.stdout.on('data', (d) => { output += d.toString(); });
    ps.on('close', () => {
      resolve(output.trim().includes('focused'));
    });
    ps.on('error', () => resolve(false));

    // Timeout after 3s
    setTimeout(() => { try { ps.kill(); } catch {} resolve(false); }, 3000);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  isDaemonRunning,
  startDaemon,
  stopDaemon,
  ensureDaemon,
  getDaemonUrl,
  httpRequest,
  focusUnity,
};
