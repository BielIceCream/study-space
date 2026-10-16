@echo off
cd /d "%~dp0"
if exist "%~dp0runtime\node.exe" (
  set "STUDYSPACE_NODE=%~dp0runtime\node.exe"
) else (
  set "STUDYSPACE_NODE=node"
)
"%STUDYSPACE_NODE%" "%~dp0runtime\launcher.mjs" --stop
if errorlevel 1 pause
