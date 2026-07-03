# 一键部署系统 · BFF 后端（NestJS）

代理 GitLab API、持有 token、统一鉴权与审计。前端通过 `/api/*` 调用本服务。

## 技术栈
NestJS 10 + TypeScript + @nestjs/jwt + @nestjs/config + axios。
存储层为**内存实现**（`src/core/store.service.ts`，MVP），接口化隔离，生产前替换为 Prisma + PostgreSQL（见需求文档 §9）。

## 配置
```bash
cp .env.example .env   # 填入 GitLab OAuth 应用的 client_id/secret 等
```
关键变量：`GITLAB_URL`、`GITLAB_CLIENT_ID/SECRET`、`OAUTH_REDIRECT_URI`、`JWT_SECRET`、`FRONTEND_URL`。
> 需先在 GitLab 后台创建 OAuth Application（scope=`api`），回调地址填 `OAUTH_REDIRECT_URI`。
> 管理员：`ADMIN_USERNAMES=alice,bob`（逗号分隔 GitLab 用户名）。

## 运行
```bash
pnpm install --ignore-workspace   # 注意：因仓库根有 pnpm-workspace.yaml，需 --ignore-workspace 隔离安装
pnpm build                        # nest build → dist/
pnpm start                        # node dist/main.js（默认 :3000）
pnpm start:dev                    # 开发热重载
```
> 若遇 `ERR_PNPM_IGNORED_BUILDS`（@nestjs/core 的非必需 postinstall），可直接用
> `node node_modules/@nestjs/cli/bin/nest.js build` 构建。

## 已实现接口（对应需求文档 §10）
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/auth/login` | 跳转 GitLab OAuth |
| GET | `/api/auth/callback` | 回调建会话，带 token 重定向回前端 |
| GET | `/api/auth/me` | 当前用户 |
| POST | `/api/auth/logout` | 登出 |
| GET | `/api/groups/tree` | 分组树 |
| GET | `/api/projects` | 项目列表（权限继承 GitLab，含最近部署） |
| GET | `/api/projects/:id/branches` | 分支列表 |
| GET | `/api/projects/:id/environments` | 可部署环境（分支推断+配置覆盖，含 deployable） |
| POST/DELETE | `/api/projects/:id/favorite` | 收藏 |
| POST | `/api/deployments` | 触发部署 |
| GET | `/api/deployments/:id` | 部署详情（实时状态） |
| GET | `/api/deployments/:id/logs` | 增量日志 |
| POST | `/api/deployments/:id/cancel` | 取消 |
| GET | `/api/deployments` | 部署历史 |

## 部署触发逻辑（核心，见需求文档 §8.3/§8.5）
`DeploymentsService.create`：解析环境绑定分支 → 校验用户 access_level → `POST /pipeline` 创建流水线 → 在 jobs 中找入口 `manual` job（优先 stage=build / `build_*`）→ `play` → `deploy_*` 靠 `needs` 自动级联。无 manual job 时回退为流水线自动执行。

## 待完善（生产前）
- 内存存储 → Prisma + PostgreSQL；token 加密存储
- OAuth token 过期自动 refresh
- 审计日志落库、部署历史时间范围/触发人筛选、SSE 实时推送、Webhook 替代轮询
