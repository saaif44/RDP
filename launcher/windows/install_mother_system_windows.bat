@echo off
setlocal enableextensions

REM ==========================================================
REM  LocalRDP Mother System installer
REM   - Copies the tray app + backend runtime into
REM     C:\Program Files\LocalRDP Mother System
REM   - Creates a Scheduled Task so it starts automatically
REM     for ANY user at logon, with elevated privileges and
REM     no UAC prompt.
REM
REM  Note: the tray app needs an interactive desktop, which
REM  Windows only provides after logon (Session 0 has no
REM  desktop). The task below therefore uses an "at logon"
REM  trigger - the earliest reliable point - for every user.
REM ==========================================================

REM --- Self-elevate (Program Files + Scheduled Task need admin) ---
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting administrator privileges...
    powershell -NoProfile -Command "Start-Process -Verb RunAs -FilePath '%~f0'"
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
set "TASK_NAME=LocalRDP Mother System"

echo Installing LocalRDP Mother System to "%INSTALL_DIR%" ...

REM --- Stop any running instance / existing task so files can be replaced ---
schtasks /end /tn "%TASK_NAME%" >nul 2>&1
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

REM --- Create / refresh the startup Scheduled Task -----------------------
REM   -AtLogOn with no user  -> triggers for ANY user that logs on
REM   GroupId S-1-5-32-545   -> BUILTIN\Users, runs in their interactive session
REM   -RunLevel Highest      -> elevated, so the backend ports bind cleanly
REM   ExecutionTimeLimit 0   -> never auto-killed (it is a long-running app)
echo Registering startup task "%TASK_NAME%" ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$a = New-ScheduledTaskAction -Execute '%TARGET%'; $t = New-ScheduledTaskTrigger -AtLogOn; $p = New-ScheduledTaskPrincipal -GroupId 'S-1-5-32-545' -RunLevel Highest; $s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew; Register-ScheduledTask -TaskName '%TASK_NAME%' -Action $a -Trigger $t -Principal $p -Settings $s -Force | Out-Null"
if %errorlevel% neq 0 (
    echo WARNING: Could not create the Scheduled Task. Falling back to the registry Run key.
    reg add "HKLM\Software\Microsoft\Windows\CurrentVersion\Run" /v LocalRDP_MotherSystem /t REG_SZ /d "\"%TARGET%\"" /f >nul
)

echo Starting LocalRDP Mother System...
start "" "%TARGET%"

echo.
echo Done. LocalRDP Mother System is installed in Program Files and will
echo start automatically whenever any user logs on to Windows.
echo You can now delete the downloaded folder.
pause
