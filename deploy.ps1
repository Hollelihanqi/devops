# 一键部署到 CentOS：打包源码 → scp 上传 → 远端 docker compose 重建
# 用法：pnpm deploy
# 改服务器/目录只动下面两行即可

$ErrorActionPreference = 'Stop'

$Server    = 'root@10.0.157.73'      # 部署目标：SSH 用户@IP
$RemoteDir = '/opt/deploy-center'    # 服务器上放代码的目录（需已存在，且有 .env）

Write-Host '==> 1/3 打包源码...' -ForegroundColor Cyan
tar czf deploy.tgz --exclude=node_modules --exclude=server/node_modules --exclude=dist --exclude=.git --exclude=deploy.tgz --exclude=.env --exclude=server/.env .
if ($LASTEXITCODE -ne 0) { throw 'tar 打包失败' }

Write-Host '==> 2/3 上传到服务器（提示密码就输服务器密码）...' -ForegroundColor Cyan
scp -o StrictHostKeyChecking=accept-new deploy.tgz "${Server}:${RemoteDir}/"
if ($LASTEXITCODE -ne 0) { throw 'scp 上传失败' }

Write-Host '==> 3/3 服务器解压并重建容器（首次较慢，要拉镜像+装依赖）...' -ForegroundColor Cyan
ssh -o StrictHostKeyChecking=accept-new $Server "cd $RemoteDir && tar xzf deploy.tgz && rm -f deploy.tgz && docker compose up -d --build"
if ($LASTEXITCODE -ne 0) { throw '远端部署失败' }

Remove-Item deploy.tgz -ErrorAction SilentlyContinue
Write-Host '==> 部署完成！访问 http://10.0.157.73:8080' -ForegroundColor Green
