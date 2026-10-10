@echo off
cd /d "%~dp0"
echo Starting AuraFilm...
start "" http://localhost:8080
if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" main.py
) else (
    python main.py
)
pause
