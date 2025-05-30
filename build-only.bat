@echo off
echo ============================================
echo    Koishi Plugin mcid-bot 构建脚本
echo ============================================
echo.

echo [1/2] 安装依赖...
call npm install
if errorlevel 1 (
    echo 错误: 安装依赖失败
    pause
    exit /b 1
)

echo [2/2] 构建项目...
call npm run build
if errorlevel 1 (
    echo 错误: 构建失败
    pause
    exit /b 1
)

echo.
echo ============================================
echo    构建完成!
echo ============================================
echo.
echo 编译后的文件在 lib/ 目录中
echo.

pause 