@echo off
echo Installing PyInstaller...
pip install pyinstaller

echo Building Client Executable for Windows...
pyinstaller --onefile --noconsole --name "RDP_Agent_Windows" agent.py

echo Build complete! You can find the executable in the 'dist' folder.
pause
