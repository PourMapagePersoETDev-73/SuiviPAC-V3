@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PY="

where py >nul 2>nul && set "PY=py"
if not defined PY if exist "%LOCALAPPDATA%\Programs\Thonny\python.exe" set "PY=%LOCALAPPDATA%\Programs\Thonny\python.exe"
if not defined PY if exist "%ProgramFiles(x86)%\Thonny\python.exe" set "PY=%ProgramFiles(x86)%\Thonny\python.exe"
if not defined PY if exist "%ProgramFiles%\Thonny\python.exe" set "PY=%ProgramFiles%\Thonny\python.exe"
if not defined PY where python >nul 2>nul && set "PY=python"

if not defined PY goto nopython

echo Python utilise : %PY%
echo.
echo [1/2] Installation des modules...
"%PY%" -m pip install -r requirements.txt
if errorlevel 1 goto erreur

echo.
echo [2/2] Fabrication de l'exe (2 a 5 minutes)...
"%PY%" -m PyInstaller --noconsole --onefile --name SuiviPAC --hidden-import matplotlib.backends.backend_tkagg --hidden-import lxml._elementpath --hidden-import cryptography.hazmat.primitives.ciphers.aead suivi_pac.py
if errorlevel 1 goto erreur
if not exist "dist\SuiviPAC.exe" goto erreur

echo.
echo ============================================================
echo  TERMINE : le programme est ici :
echo  %~dp0dist\SuiviPAC.exe
echo ============================================================
pause
exit /b 0

:nopython
echo.
echo ERREUR : Python est introuvable sur cet ordinateur.
echo Solution : ouvrez Thonny, menu Outils, "Ouvrir l'interpreteur systeme",
echo puis tapez la commande indiquee dans LISEZMOI.md (section "Si le .bat ne marche pas").
pause
exit /b 1

:erreur
echo.
echo ERREUR : l'exe n'a PAS ete cree. Regardez les messages ci-dessus
echo (copiez-les pour demander de l'aide).
pause
exit /b 1
