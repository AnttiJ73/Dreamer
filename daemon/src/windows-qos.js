'use strict';

const { spawn } = require('child_process');
const log = require('./log').create('windows-qos');

/**
 * Opt this Node process out of Windows EcoQoS power throttling. Without this,
 * Win11 22H2+ aggressively throttles unfocused console processes — the daemon
 * gets ~25-second scheduling stalls under contention (multi-instance Unity,
 * battery saver, etc.), heartbeats arrive late, and the bridge appears to
 * disconnect when nothing has actually crashed.
 *
 * Generic fix that works across Node and Windows versions: SetProcessInformation
 * with PROCESS_POWER_THROTTLING_EXECUTION_SPEED disabled. We invoke it via a
 * detached PowerShell helper because Node has no direct kernel32 binding and
 * we want to keep the daemon at zero external dependencies.
 *
 * Fire-and-forget — the daemon is fully functional whether this succeeds or not,
 * and Linux/macOS no-op cleanly.
 */
function disableEcoQoSForSelf() {
  if (process.platform !== 'win32') return;

  const pid = process.pid;
  const ps = `
    $ErrorActionPreference = 'SilentlyContinue'
    Add-Type @"
      using System;
      using System.Runtime.InteropServices;
      public class DreamerQoS {
        [StructLayout(LayoutKind.Sequential)]
        public struct PROCESS_POWER_THROTTLING_STATE {
          public uint Version;
          public uint ControlMask;
          public uint StateMask;
        }
        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool CloseHandle(IntPtr h);
        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool SetProcessInformation(
          IntPtr hProcess, int cls, ref PROCESS_POWER_THROTTLING_STATE info, int size);
      }
"@
    # PROCESS_SET_INFORMATION (0x0200) | PROCESS_QUERY_INFORMATION (0x0400)
    $h = [DreamerQoS]::OpenProcess(0x0600, $false, ${pid})
    if ($h -eq [IntPtr]::Zero) { exit 1 }
    $s = New-Object DreamerQoS+PROCESS_POWER_THROTTLING_STATE
    $s.Version = 1
    $s.ControlMask = 1   # PROCESS_POWER_THROTTLING_EXECUTION_SPEED
    $s.StateMask = 0     # explicit opt-out
    $sz = [System.Runtime.InteropServices.Marshal]::SizeOf($s)
    $ok = [DreamerQoS]::SetProcessInformation($h, 4, [ref]$s, $sz)
    [DreamerQoS]::CloseHandle($h) | Out-Null
    if (-not $ok) { exit 2 }
  `;

  try {
    const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      stdio: 'ignore',
      windowsHide: true,
    });
    child.on('error', () => { /* PowerShell unavailable — silently ignore */ });
    child.on('exit', (code) => {
      if (code === 0) {
        log.info('Disabled Windows EcoQoS for daemon process — background timers will not be throttled.');
      } else if (code === 1) {
        log.warn('Could not OpenProcess on self for EcoQoS opt-out — daemon may be throttled when unfocused.');
      } else if (code === 2) {
        log.warn('SetProcessInformation(ProcessPowerThrottling) failed — daemon may be throttled when unfocused.');
      }
      // Other non-zero codes (PowerShell parse errors etc.) silently ignored —
      // the daemon's main job is unaffected and we don't want to noise the log.
    });
  } catch {
    /* spawn threw — silently ignore */
  }
}

module.exports = { disableEcoQoSForSelf };
