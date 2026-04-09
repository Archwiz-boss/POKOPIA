@echo off
title Pokopia - Push to GitHub

cd /d "%~dp0"

echo.
echo  ==========================================
echo       Pokopia - Push to GitHub
echo  ==========================================
echo.

echo  [Changes]
git status --short
echo.

git add .

git diff --cached --quiet
if %errorlevel% equ 0 (
    echo  [INFO] No changes to commit.
    echo.
    pause
    exit /b 0
)

for /f "tokens=1-3 delims=/" %%a in ("%date%") do (
    set YY=%%a
    set MM=%%b
    set DD=%%c
)
for /f "tokens=1-2 delims=:." %%a in ("%time: =0%") do (
    set HH=%%a
    set MI=%%b
)
set TIMESTAMP=%YY%-%MM%-%DD% %HH%:%MI%

git commit -m "update: %TIMESTAMP%"

echo.
echo  [Pushing] Please wait...
echo.

git push

if %errorlevel% equ 0 (
    echo.
    echo  [OK] Push successful!
    echo       https://github.com/Archwiz-boss/POKOPIA
    echo       GitHub Pages updates in ~1-2 minutes.
) else (
    echo.
    echo  [ERROR] Push failed.
    echo          Check your internet connection and try again.
)

echo.
pause
