@echo off
rem Double-click to open the Ink Overlay Installer window. Needs Python 3 (python.org) on this PC.
cd /d "%~dp0"
where pyw >nul 2>nul && (start "" pyw ink_overlay_installer.py & exit /b)
where pythonw >nul 2>nul && (start "" pythonw ink_overlay_installer.py & exit /b)
echo Python is not installed. Get it from https://www.python.org/downloads/ (tick "Add python.exe to PATH"), then try again.
pause
