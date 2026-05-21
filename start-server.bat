@echo off
cd /d "%~dp0"
echo FMEA Web Server starting on http://172.20.77.4:3000
echo Codebeamer iframe: http://172.20.77.4:3000/projects
echo.
npm start -- -p 3000 -H 0.0.0.0
pause
