@echo off
setlocal

cd /d "%~dp0"

echo Building Mother System dashboard...
pushd dashboard
call npm run build
if errorlevel 1 (
  popd
  echo Dashboard build failed.
  exit /b 1
)
popd

echo Preparing backend public dashboard files...
if exist server\public rmdir /s /q server\public
mkdir server\public
xcopy dashboard\dist\* server\public\ /E /I /Y >nul
if errorlevel 1 (
  echo Failed to copy dashboard build into server\public.
  exit /b 1
)

echo Done. Start Mother System with start_mother_hidden.vbs.
