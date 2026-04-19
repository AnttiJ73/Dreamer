---
name: Bug report
about: A Dreamer CLI / daemon / Unity bridge misbehavior
title: ''
labels: bug
assignees: ''
---

**What went wrong**

Describe the symptom in one or two sentences. What command did you run,
what happened, what did you expect?

**Repro**

1.
2.
3.

**Environment** (please fill in — missing env info is the #1 reason bugs
go unactioned)

- OS: (e.g. Windows 11 26100, macOS 14.5, Ubuntu 22.04)
- Unity version: (e.g. 6000.0.32f1)
- Node version: `node --version`
- Dreamer commit SHA: `cat daemon/.dreamer-source.json` → `sha` field
- Claude Code version (if applicable): `claude --version`

**Diagnostics**

Paste the output of:

```
./bin/dreamer status
./bin/dreamer compile-status
./bin/dreamer queue
```

Relevant daemon log excerpts (`daemon/.dreamer-daemon.log`) — tail of
the failure window, not the whole file.

**Extra context**

Screenshots, Unity console output, or anything else that helps.
