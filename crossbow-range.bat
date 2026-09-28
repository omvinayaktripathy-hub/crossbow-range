@echo off
title Crossbow Range - Launcher
color 0B

echo.
echo  ============================================
echo    CROSSBOW RANGE - One Click Launcher
echo  ============================================
echo.

:: Move to the directory where this .bat file lives
cd /d "%~dp0"

:: ---- Check Node.js ----
where node >nul 2>nul
if errorlevel 1 (
    echo  [ERROR] Node.js is not installed or not in PATH.
    echo.
    echo  Please install Node.js from: https://nodejs.org/
    echo  Then run this file again.
    echo.
    pause
    exit /b 1
)

echo  [OK] Node.js detected:
node -v
echo.

:: ---- Install dependencies if node_modules is missing ----
if not exist "node_modules" (
    echo  [SETUP] Installing dependencies for the first time...
    echo  This may take a minute...
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo  [ERROR] npm install failed.
        pause
        exit /b 1
    )
    echo.
    echo  [OK] Dependencies installed.
    echo.
) else (
    echo  [OK] Dependencies already installed.
    echo.
)

:: ---- Ensure public/ folder exists ----
if not exist "public" (
    echo  [WARN] 'public' folder not found.
    echo         Make sure index.html, game.js and style.css are inside a folder named "public".
    echo.
)

:: ---- Seed data/scores.json from scores.json on first run ----
if not exist "data" mkdir "data"
if not exist "data\scores.json" (
    if exist "scores.json" (
        echo  [SETUP] Seeding data\scores.json from scores.json...
        copy /y "scores.json" "data\scores.json" >nul
        echo  [OK] Seed data copied.
        echo.
    ) else (
        echo  [] No seed scores.json found - starting with an empty leaderboard.
        echo.
    )
)

:: ---- Open the browser after a short delay ----
echo  [START] Launching server and opening browser...
start "" cmd /c "timeout /t 2 >nul & start http://localhost:3000"

:: ---- Start the server (this keeps the window open) ----
echo.
echo  ============================================
echo    Server running at http://localhost:3000
echo    Press CTRL+C to stop the server
echo  ============================================
echo.
node server.js

:: If the server exits, pause so the user can read any error
echo.
echo  Server stopped.
pause