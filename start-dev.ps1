# 一键启动开发环境：同时拉起后端 BFF（:3000 watch）和前端（:5173）。
# 用法：在仓库根目录执行  ./start-dev.ps1
# 每个服务各开一个新 PowerShell 窗口，方便分别看日志；关窗口即停服务。

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

Write-Host '正在启动 后端 BFF (http://localhost:3000/api) ...' -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
  '-NoExit', '-Command',
  "Set-Location '$root\server'; pnpm start:dev"
)

Write-Host '正在启动 前端 (http://localhost:5173) ...' -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
  '-NoExit', '-Command',
  "Set-Location '$root'; pnpm dev"
)

Write-Host ''
Write-Host '两个服务已在独立窗口启动：' -ForegroundColor Green
Write-Host '  后端  http://localhost:3000/api'
Write-Host '  前端  http://localhost:5173'
Write-Host '关闭对应窗口即可停止服务。'
