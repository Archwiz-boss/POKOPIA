@echo off
chcp 65001 >nul
title Pokopia → GitHub

cd /d "%~dp0"

echo.
echo  ==========================================
echo       Pokopia  一鍵上傳到 GitHub
echo  ==========================================
echo.

:: 顯示目前有哪些變更
echo  [變更清單]
git status --short
echo.

:: 加入所有變更（認證由 Windows 憑證管理員處理，不存在此檔案中）
git add .

:: 確認有沒有東西要 commit
git diff --cached --quiet
if %errorlevel% equ 0 (
    echo  [!] 沒有新的變更，不需要上傳。
    echo.
    pause
    exit /b 0
)

:: 自動用目前時間當 commit 訊息
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
echo  [上傳中] 請稍候...
echo.

git push

if %errorlevel% equ 0 (
    echo.
    echo  [OK] 上傳成功！
    echo       https://github.com/Archwiz-boss/POKOPIA
    echo       GitHub Pages 通常 1~2 分鐘內更新
) else (
    echo.
    echo  [ERR] 上傳失敗
    echo        請確認網路連線，或重新執行以下指令登入：
    echo        git credential reject
    echo        git push
)

echo.
pause
