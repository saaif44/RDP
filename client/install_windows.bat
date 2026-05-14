@echo off
setlocal enableextensions

REM ==========================================================
REM  LocalRDP Client installer
REM  - Copies the client into C:\Program Files\LocalRDP
REM  - Registers it to start automatically at every login
REM  After install the downloaded file can be deleted; the app
REM  runs from its stable Program Files location.
REM ==========================================================

REM --- Self-elevate (writing to Program Files / HKLM needs admin) ---
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting administrator privileges...
    powershell -Command "Start-Process -Verb RunAs -FilePath '%~f0'"
    exit /b
)

REM --- Locate the client executable shipped next to this installer ---
set "SRC=%~dp0LocalRDP-Client-Windows.exe"
if not exist "%SRC%" set "SRC=%~dp0LocalRDP-Client.exe"
if not exist "%SRC%" set "SRC=%~dp0RDP_Agent.exe"
if not exist "%SRC%" (
    echo ERROR: Could not find the LocalRDP client executable next to this installer.
    pause
    exit /b 1
)

set "INSTALL_DIR=%ProgramFiles%\LocalRDP"
set "TARGET=%INSTALL_DIR%\LocalRDP-Client.exe"

echo Installing LocalRDP Client to "%INSTALL_DIR%" ...

REM --- Stop any running instance so the file can be replaced ---
taskkill /f /im LocalRDP-Client.exe >nul 2>&1
taskkill /f /im LocalRDP-Client-Windows.exe >nul 2>&1
taskkill /f /im RDP_Agent.exe >nul 2>&1

if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
copy /y "%SRC%" "%TARGET%" >nul
if %errorlevel% neq 0 (
    echo ERROR: Failed to copy the client executable into Program Files.
    pause
    exit /b 1
)

REM --- Register as a startup program for all users (stable path) ---
reg add "HKLM\Software\Microsoft\Windows\CurrentVersion\Run" /v LocalRDP_Agent /t REG_SZ /d "\"%TARGET%\"" /f >nul

echo Starting LocalRDP Client...
start "" "%TARGET%"

echo.
echo Done. LocalRDP Client is installed and will start automatically at login.
echo You can now delete the downloaded file.
pause
