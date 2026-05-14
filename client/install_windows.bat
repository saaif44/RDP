@echo off
setlocal enableextensions

REM ==========================================================
REM  LocalRDP Client installer
REM   - Copies the client into C:\Program Files\LocalRDP
REM   - Creates a Scheduled Task so it starts automatically
REM     for ANY user at logon, with elevated privileges and
REM     no UAC prompt.
REM
REM  Note: this app captures the screen and controls input, so
REM  it needs an interactive desktop. Windows cannot run that
REM  before someone logs in (Session 0 has no desktop), so the
REM  earliest reliable trigger is "at logon" - which the task
REM  below uses, for every user, automatically.
REM ==========================================================

REM --- Self-elevate (Program Files + Scheduled Task need admin) ---
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting administrator privileges...
    powershell -NoProfile -Command "Start-Process -Verb RunAs -FilePath '%~f0'"
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
set "TASK_NAME=LocalRDP Client"

echo Installing LocalRDP Client to "%INSTALL_DIR%" ...

REM --- Stop any running instance / existing task so files can be replaced ---
schtasks /end /tn "%TASK_NAME%" >nul 2>&1
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

REM --- Create / refresh the startup Scheduled Task -----------------------
REM   -AtLogOn with no user  -> triggers for ANY user that logs on
REM   GroupId S-1-5-32-545   -> BUILTIN\Users, runs in their interactive session
REM   -RunLevel Highest      -> elevated, so it can control elevated windows
REM   ExecutionTimeLimit 0   -> never auto-killed (it is a long-running app)
echo Registering startup task "%TASK_NAME%" ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$a = New-ScheduledTaskAction -Execute '%TARGET%'; $t = New-ScheduledTaskTrigger -AtLogOn; $p = New-ScheduledTaskPrincipal -GroupId 'S-1-5-32-545' -RunLevel Highest; $s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew; Register-ScheduledTask -TaskName '%TASK_NAME%' -Action $a -Trigger $t -Principal $p -Settings $s -Force | Out-Null"
if %errorlevel% neq 0 (
    echo WARNING: Could not create the Scheduled Task. Falling back to the registry Run key.
    reg add "HKLM\Software\Microsoft\Windows\CurrentVersion\Run" /v LocalRDP_Agent /t REG_SZ /d "\"%TARGET%\"" /f >nul
)

echo Starting LocalRDP Client...
start "" "%TARGET%"

echo.
echo Done. LocalRDP Client is installed in Program Files and will start
echo automatically whenever any user logs on to Windows.
echo You can now delete the downloaded file.
pause
