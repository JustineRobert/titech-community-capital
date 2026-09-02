@echo off
echo ========================================
echo Community Savings App - Quick Setup
echo ========================================
echo.

cd /d "%~dp0"

echo Checking if we're in the right directory...
if not exist "community-savings-app-backend" (
    echo ERROR: Please run this script from the project root directory
    pause
    exit /b 1
)

echo.
echo Step 1: Installing backend dependencies...
cd community-savings-app-backend
call npm install
if %errorlevel% neq 0 (
    echo ERROR: npm install failed
    pause
    exit /b 1
)

echo.
echo Step 2: Checking for .env file...
if not exist ".env" (
    echo Creating .env file from template...
    if exist ".env.example" (
        copy .env.example .env
        echo.
        echo IMPORTANT: Please edit .env file with your MongoDB connection details!
        echo Opening .env file...
        notepad .env
    ) else (
        echo ERROR: .env.example not found
        pause
        exit /b 1
    )
) else (
    echo .env file already exists
)

echo.
echo Step 3: Starting the development server...
echo.
echo Note: Make sure MongoDB is running before continuing
echo (Install from: https://mongodb.com/try/download/community)
echo.
pause

call npm run dev