'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { getPort, ensureRegisteredPort } = require('./config');

const DAEMON_DIR = path.resolve(__dirname, '..');
const DAEMON_PROJECT_ROOT = path.resolve(DAEMON_DIR, '..');
const PID_FILE = path.join(DAEMON_DIR, '.dreamer-daemon.pid');
const SERVER_JS = path.join(__dirname, 'server.js');

function getDaemonUrl() {
  return `http://127.0.0.1:${getPort(DAEMON_PROJECT_ROOT)}`;
}

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

async function isDaemonRunning() {
  if (!fs.existsSync(PID_FILE)) return false;

  let pid;
  try {
    pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
  } catch {
    return false;
  }

  try {
    process.kill(pid, 0);
  } catch {
    // Stale PID file — process is gone.
    try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
    return false;
  }

  try {
    const resp = await httpRequest('GET', '/api/status');
    return resp.status === 200;
  } catch {
    return false;
  }
}

async function startDaemon() {
  const already = await isDaemonRunning();
  if (already) return;

  // Register/resolve port BEFORE spawn — otherwise the CLI's cached getDaemonUrl()
  // can fall through to the default while the daemon allocates a different port.
  try {
    await ensureRegisteredPort(DAEMON_PROJECT_ROOT, { daemonRoot: DAEMON_DIR });
  } catch (err) {
    throw new Error(`Cannot start daemon: failed to register project port — ${err.message}`);
  }

  const child = spawn(process.execPath, [SERVER_JS, '--daemon'], {
    cwd: DAEMON_DIR,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  });
  child.unref();

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

async function stopDaemon() {
  try {
    await httpRequest('POST', '/api/shutdown');
    await sleep(500);
    const running = await isDaemonRunning();
    if (!running) return;
  } catch { /* HTTP failed, try PID kill */ }

  if (fs.existsSync(PID_FILE)) {
    try {
      const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
      process.kill(pid, 'SIGTERM');
      await sleep(500);
    } catch { /* ignore */ }

    try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
  }
}

async function ensureDaemon() {
  const running = await isDaemonRunning();
  if (!running) await startDaemon();
}

/**
 * Focus the Unity Editor window matching `projectRoot` (Windows only).
 * Falls back to first foreground-capable Unity.exe when projectRoot is omitted.
 * The path-match is load-bearing — multi-Unity-instance setups otherwise focus
 * the wrong window and nudge the wrong project.
 */
async function focusUnity(projectRoot) {
  if (process.platform !== 'win32') return false;

  const targetRoot = projectRoot || path.resolve(__dirname, '..', '..');
  // Normalize to forward slashes + lowercase so PowerShell -like matches case-insensitively
  // regardless of drive-letter/slash variation between Unity and filesystem.
  const target = targetRoot.replace(/\\/g, '/').toLowerCase();

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
      # Walk every Unity.exe process and find the one whose command line has
      # -projectpath matching our target. Use Win32_Process (CIM) for command-
      # line access. Normalise slashes + case on both sides.
      #
      # IMPORTANT: we derive the backslash via [char]92 rather than typing one
      # literally. Node's child_process.spawn on Windows mangles backslashes
      # when passing the -Command block (they get partially consumed by the
      # CreateProcess command-line quoting rules), which silently broke the
      # earlier regex/Replace approaches.
      $target = '${target}'
      $bs = [char]92
      $matched = $null
      try {
        $cims = Get-CimInstance Win32_Process -Filter "Name='Unity.exe'" -ErrorAction SilentlyContinue
        foreach ($cim in $cims) {
          $cl = $cim.CommandLine
          if ($cl -eq $null) { continue }
          # Skip AssetImportWorker / batch-mode children — they include -batchMode.
          if ($cl -like '*-batchMode*') { continue }
          $normalLower = $cl.Replace($bs, '/').ToLower()
          if ($normalLower -like "*-projectpath*$target*") {
            $matched = $cim.ProcessId
            break
          }
        }
      } catch { }

      if ($matched -ne $null) {
        $p = Get-Process -Id $matched -ErrorAction SilentlyContinue
      } else {
        # Fallback: first foreground-capable Unity.exe (legacy behaviour).
        $p = Get-Process -Name Unity -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
      }

      if ($p -and $p.MainWindowHandle -ne 0) {
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
        if ($matched -ne $null) { Write-Output "focused:matched" } else { Write-Output "focused:fallback" }
      } else {
        Write-Output "not_found"
      }
    `], { stdio: ['ignore', 'pipe', 'pipe'] });

    let output = '';
    ps.stdout.on('data', (d) => { output += d.toString(); });
    ps.on('close', () => {
      // `includes`, not `startsWith`: the Win32 method calls return bools that
      // PowerShell prints to stdout by default (True\nTrue\n...), so the
      // "focused:..." / "not_found" signal line is never the first line.
      resolve(output.includes('focused'));
    });
    ps.on('error', () => resolve(false));

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
