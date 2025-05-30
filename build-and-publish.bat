@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ============================================
echo    Koishi Plugin mcid-bot 构建发布脚本
echo ============================================
echo.

REM 检查是否提供了版本参数
if "%~1"=="" (
    echo 错误: 请提供版本号
    echo 用法: build-and-publish.bat [版本号] [提交信息]
    echo 示例: build-and-publish.bat 1.0.2 "修复用户ID解析问题"
    echo.
    pause
    exit /b 1
)

set VERSION=%~1
set COMMIT_MSG=%~2

REM 如果没有提供提交信息，使用默认信息
if "%COMMIT_MSG%"=="" (
    set COMMIT_MSG=v%VERSION%: 版本更新
)

echo 准备发布版本: %VERSION%
echo 提交信息: %COMMIT_MSG%
echo.

REM 确认是否继续
set /p CONFIRM=确认继续吗? (y/N): 
if /i not "%CONFIRM%"=="y" (
    echo 已取消发布
    pause
    exit /b 0
)

echo.
echo [1/6] 检查Git状态...
git status --porcelain > nul
if errorlevel 1 (
    echo 错误: Git仓库状态异常
    pause
    exit /b 1
)

echo [2/6] 更新package.json版本...
powershell -Command "(Get-Content package.json) -replace '\"version\": \".*\"', '\"version\": \"%VERSION%\"' | Set-Content package.json"
if errorlevel 1 (
    echo 错误: 更新package.json失败
    pause
    exit /b 1
)

echo [3/6] 构建项目...
call npm run build
if errorlevel 1 (
    echo 错误: 构建失败
    pause
    exit /b 1
)

echo [4/6] 提交代码到Git...
git add .
git commit -m "%COMMIT_MSG%"
if errorlevel 1 (
    echo 警告: Git提交可能失败，继续执行...
)

echo [5/6] 推送到GitHub...
git push
if errorlevel 1 (
    echo 错误: 推送到GitHub失败
    pause
    exit /b 1
)

echo [6/6] 发布到NPM...
call npm publish
if errorlevel 1 (
    echo 错误: NPM发布失败
    pause
    exit /b 1
)

echo.
echo ============================================
echo    发布完成! 版本 %VERSION% 已成功发布
echo ============================================
echo.
echo NPM包: koishi-plugin-mcid-bot@%VERSION%
echo GitHub: https://github.com/WittF/mcid-bot
echo.

pause 