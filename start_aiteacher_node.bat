@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "APP_URL=http://127.0.0.1:5173/"
set "KEY_FILE=%~dp01.md"
set "NODE_EXE="
set "CHROME_EXE="
set "CHECK_ONLY=0"
if /I "%~1"=="--check" set "CHECK_ONLY=1"

if not exist "%KEY_FILE%" if not exist "%~dp0.env" (
  echo [AITeacher] Missing local model config.
  echo Create 1.md with KEY: and URL:, or create .env from .env.example.
  if "%CHECK_ONLY%"=="0" pause
  exit /b 1
)

where node.exe >nul 2>nul
if errorlevel 1 (
  echo [AITeacher] Node.js was not found in PATH.
  echo Install Node.js 18+ or use the Python proxy.
  if "%CHECK_ONLY%"=="0" pause
  exit /b 1
)
for /f "delims=" %%I in ('where node.exe 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%I"

if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined CHROME_EXE if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined CHROME_EXE if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not defined CHROME_EXE for /f "delims=" %%I in ('where chrome.exe 2^>nul') do if not defined CHROME_EXE set "CHROME_EXE=%%I"

if /I "%~1"=="--check" (
  echo [AITeacher] Environment check passed.
  echo Node: %NODE_EXE%
  echo Key file: %KEY_FILE%
  exit /b 0
)

if defined CHROME_EXE (
  set "AITEACHER_CHROME=%CHROME_EXE%"
  start "" /B powershell.exe -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -Command "$url='%APP_URL%'; $chrome=$env:AITEACHER_CHROME; for($i=0; $i -lt 120; $i++){ try { $response=Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 1; if($response.StatusCode -eq 200){ Start-Process -FilePath $chrome -ArgumentList $url; exit 0 } } catch {}; Start-Sleep -Milliseconds 500 }; exit 1"
)

echo [AITeacher] Starting local web and Node model proxy...
echo [AITeacher] Keep this window open. Press Ctrl+C to stop.
echo.
"%NODE_EXE%" "scripts\local_proxy_node.js" --key-file "%KEY_FILE%"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo [AITeacher] The local service stopped with exit code %EXIT_CODE%.
  pause
)

exit /b %EXIT_CODE%
