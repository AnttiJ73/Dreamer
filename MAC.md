# Dreamer on macOS

**Status:** untested. Developed and verified on Windows only. The
author does not have a Mac. If you try it, please post about it with
what worked and what didn't — Claude can usually patch the gaps
directly on your end.

## What should work

Dreamer's core is platform-agnostic:

- Node.js daemon — zero external deps, built-in modules only
- HTTP bridge between daemon and Unity Editor
- Command queue, scheduler, compile-gating, auto-refresh on file changes
- Unity C# package — uses Unity's own APIs, no platform branches
- `bin/dreamer` POSIX wrapper (run `chmod +x bin/dreamer` after install)
- `fs.watch` recursive mode for the asset watcher (supported on macOS)

## What is Windows-only

One feature: **auto-focus Unity when it stalls.** Uses PowerShell +
Win32 APIs (`SetForegroundWindow`, `ShowWindow`). On macOS, the
focus-steal code is guarded by a `process.platform === 'win32'` check
and silently becomes a no-op — commands still queue and execute, they
just won't force Unity to the foreground.

The reason this feature exists is that **Windows Unity's main thread
stops ticking entirely when the Editor is unfocused.** macOS Unity
keeps ticking when backgrounded (though it may be throttled by the OS
when minimized to the Dock). So in practice Mac users rarely need the
auto-focus behavior at all.

If you hit stalls where Unity is minimized to the Dock and throttled,
a Mac version of the focus call would be ~15 lines invoking
AppleScript:

```bash
osascript -e 'tell application "Unity" to activate'
```

Drop this into `daemon/src/daemon-manager.js` in a `process.platform
=== 'darwin'` branch next to the existing Windows PowerShell block.

## Install on macOS

Same as the README — paste the one-line prompt into Claude Code. The
installer is a git clone + file copy, no platform-specific steps
beyond `chmod +x bin/dreamer` (which `INSTALL.md` already does).

## Reporting issues

Post about it in the Skoo group

Or open a GitHub issue with:

- macOS version
- Unity version
- Node version (`node --version`)
- What you ran
- What happened vs. what you expected
- Output of `./bin/dreamer status`

Or just ask Claude in the project to fix it — the daemon source is
right there in `daemon/src/`, and most platform gaps are small.
