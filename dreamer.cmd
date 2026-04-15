@echo off
rem Dreamer CLI wrapper — project-local. Runs the CLI from this project's
rem daemon\ directory. No global install required. Invoke as dreamer from
rem the project root in cmd/PowerShell.
node "%~dp0daemon\bin\dreamer.js" %*
