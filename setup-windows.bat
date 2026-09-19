@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo TITech Community Capital - Setup
echo ========================================
echo.

if not exist ".nvmrc" (
  echo ERROR: .nvmrc not found.
  exit /b 1
)

where node >nul 2>&1 || (echo ERROR: Node.js is not installed.& exit /b 1)
where npm >nul 2>&1 || (echo ERROR: npm is not installed.& exit /b 1)

if not exist "backend\package-lock.json" (echo ERROR: backend package-lock.json missing.& exit /b 1)
if not exist "frontend\package-lock.json" (echo ERROR: frontend package-lock.json missing.& exit /b 1)

call npm ci
if errorlevel 1 exit /b 1
call npm --prefix backend ci
if errorlevel 1 exit /b 1
call npm --prefix frontend ci
if errorlevel 1 exit /b 1

if not exist "backend\.env" if exist "backend\.env.example" (
  copy /Y "backend\.env.example" "backend\.env" >nul
  echo Created backend\.env from the example template.
  echo Populate local secrets manually; no production credentials are generated.
)

echo.
echo Setup complete. Run: npm run dev
endlocal
