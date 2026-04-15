@echo off
rem Dreamer CLI wrapper — project-local. Runs the CLI from this project's
rem daemon\ directory. No global install required. Invoke as
rem bin\dreamer (or .\bin\dreamer) from the project root.
node "%~dp0..\daemon\bin\dreamer.js" %*
