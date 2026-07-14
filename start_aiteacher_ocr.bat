@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "PY_EXE="
set "FLAGS_use_mkldnn=0"
set "FLAGS_use_onednn=0"
set "FLAGS_tracer_onednn_ops_on="
set "OMP_NUM_THREADS=2"

where python.exe >nul 2>nul
if errorlevel 1 (
  echo [AITeacher OCR] Python was not found in PATH.
  echo Install Python 3.10+ first, then run:
  echo python -m pip install paddlepaddle paddleocr
  pause
  exit /b 1
)
for /f "delims=" %%I in ('where python.exe 2^>nul') do if not defined PY_EXE set "PY_EXE=%%I"

echo [AITeacher OCR] Starting PaddleOCR local proxy...
echo [AITeacher OCR] First recognition may download/load OCR models.
echo [AITeacher OCR] Paddle MKLDNN/oneDNN acceleration is disabled for Windows CPU stability.
echo [AITeacher OCR] Keep this window open. Press Ctrl+C to stop.
echo.
"%PY_EXE%" "scripts\local_ocr_paddle.py" --port 8790
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo [AITeacher OCR] The OCR service stopped with exit code %EXIT_CODE%.
  echo Install dependencies if needed:
  echo python -m pip install paddlepaddle paddleocr
  pause
)

exit /b %EXIT_CODE%
