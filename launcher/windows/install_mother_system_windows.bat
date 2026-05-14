@echo off
setlocal enableextensions

REM ==========================================================
REM  LocalRDP Mother System installer
REM  - Copies the tray app + backend runtime into
REM    C:\Program Files\LocalRDP Mother System
REM  - Registers it to start automatically at every login
REM  After install the downloaded folder can be deleted; the
REM  app runs from its stable Program Files location.
REM ==========================================================

REM --- Self-elevate (writing to Program Files / HKLM needs admin) ---
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting administrator privileges...
    powershell -Command "Start-Process -Verb RunAs -FilePath '%~f0'"
    exit /b
)

set "SRC=%~dp0"
if not exist "%SRC%LocalRDP-Mother-System.exe" (
    echo ERROR: Could not find LocalRDP-Mother-System.exe next to this installer.
    pause
    exit /b 1
)

set "INSTALL_DIR=%ProgramFiles%\LocalRDP Mother System"
set "TARGET=%INSTALL_DIR%\LocalRDP-Mother-System.exe"

echo Installing LocalRDP Mother System to "%INSTALL_DIR%" ...

REM --- Stop any running instance so files can be replaced ---
taskkill /f /im LocalRDP-Mother-System.exe >nul 2>&1
taskkill /f /im LocalRDP-Admin-Backend.exe >nul 2>&1

if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
copy /y "%SRC%LocalRDP-Mother-System.exe" "%INSTALL_DIR%\" >nul
if %errorlevel% neq 0 (
    echo ERROR: Failed to copy the tray app into Program Files.
    pause
    exit /b 1
)
if exist "%SRC%runtime" xcopy "%SRC%runtime" "%INSTALL_DIR%\runtime\" /e /i /y >nul

REM --- Register as a startup program for all users (stable path) ---
reg add "HKLM\Software\Microsoft\Windows\CurrentVersion\Run" /v LocalRDP_MotherSystem /t REG_SZ /d "\"%TARGET%\"" /f >nul

echo Starting LocalRDP Mother System...
start "" "%TARGET%"

echo.
echo Done. LocalRDP Mother System is installed and will start automatically at login.
echo You can now delete the downloaded folder.
pause
