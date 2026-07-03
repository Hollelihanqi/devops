# 一键部署系统 · 前端（GitLab Deploy Center）

公司内部项目部署平台前端。按分组浏览/搜索项目 → 选环境（分支自动带出）→ 一键触发 GitLab CI/CD 部署 → 实时查看状态与日志 → 回溯部署历史。

需求与架构详见 [`docs/01-需求与架构设计.md`](docs/01-需求与架构设计.md)，全部文档索引见 [`docs/README.md`](docs/README.md)。

## 技术栈

- **Vite 8** + **React 18** + **TypeScript**
- **pnpm 11**（包管理）
- **UnoCSS 66**（原子化样式，配 antd 共用设计 token）
- **Ant Design 5**（UI 组件，中文 locale）
- **TanStack Query**（服务端数据缓存）+ **Zustand**（轻量全局态）
- **React Router v6**（路由 + 懒加载）
- **axios**（统一请求封装，`/api` 由 BFF 代理）

## 快速开始

```bash
pnpm install            # 安装前端依赖（首次会提示批准 esbuild 构建脚本，已在 pnpm-workspace.yaml 配置）
pnpm -C server install  # 安装后端依赖（首次）
cp .env.example .env    # 配置后端地址 VITE_API_TARGET

pnpm dev:all            # 一键同时启动前端(:5173)+后端(:3000)，同一窗口分色日志，Ctrl+C 全停
```

> **一键启动**：`pnpm dev:all` 用 concurrently 同时拉起前后端，`web`（青色）= 前端 http://localhost:5173 ，`server`（绿色）= 后端 http://localhost:3000/api 。

其他常用命令：

```bash
pnpm dev       # 只起前端 http://localhost:5173
pnpm server    # 只起后端 watch（= pnpm -C server start:dev）
pnpm build     # 类型检查 + 生产构建
pnpm preview   # 预览构建产物
```

> 开发期 `/api/*` 请求通过 `vite.config.ts` 的 proxy 转发到 `VITE_API_TARGET`（默认 `http://localhost:3000`）的 BFF 后端。Windows 也可双击/右键运行根目录 `start-dev.ps1`（弹两个独立窗口），效果同 `pnpm dev:all`。

## 目录结构

```
src/
├── api/            # 接口层：http 封装 + auth/projects/deployments + 类型定义
├── components/     # 通用组件（AppLayout 响应式布局）
├── features/
│   ├── auth/       # 登录态（OAuth 跳转由后端处理）
│   ├── projects/   # 分组树 + 项目卡片列表 + 搜索 + 收藏
│   ├── deploy/     # 部署面板（选环境→自动带分支→二次确认）
│   ├── monitor/    # 部署详情：实时状态 + 步骤 + 日志流
│   └── history/    # 部署历史（桌面表格 / 移动列表）
├── stores/         # zustand（auth）
├── router/         # 路由表 + 懒加载
├── App.tsx         # ConfigProvider(antd) + QueryClient + Router
└── main.tsx        # 入口（uno.css + reset）
```

## 设计约定

- **响应式**：基于 antd `Grid.useBreakpoint` + 栅格。侧边栏在小屏自动折叠为抽屉；项目列表用自适应卡片网格（`xs/sm/xl/xxl`）；历史在移动端降级为列表。
- **样式分工**：布局/间距用 UnoCSS 原子类（`flex-center`、`p-4` 等），组件内部样式与主题色走 antd `ConfigProvider.theme.token`，两者共用同一组色值（主色 `#1677ff`）。
- **环境与分支绑定**：用户选环境，系统按 `project_env_config.ref` 自动带出分支；高级模式可手动切换分支（见需求文档 §6.5）。

## 后端 BFF

后端（NestJS）在 [`server/`](server/)，已实现全部接口契约（OAuth、项目/分组/分支/环境、部署触发与监控）。详见 [`server/README.md`](server/README.md)。

### 全链路联调
先在 `server/.env` 配好 GitLab OAuth 应用，然后一键启动：

```bash
pnpm install && pnpm -C server install   # 首次装依赖
pnpm dev:all                             # 前端 :5173 + 后端 :3000
```

登录流程：前端任意请求触发 401 → 跳 `/api/auth/login` → GitLab 授权 → 回调建会话 → 带 token 重定向回前端（`main.tsx` 自动存入 localStorage）。

### 数据持久化
后端默认用 **JSON 文件落盘**（`StoreService`）：用户/收藏/部署记录等启动时从 `server/data/store.json` 恢复，写操作后自动落盘，**重启不丢数据**。可用环境变量 `DATA_FILE` 自定义文件路径。高并发/多实例场景请切换到 `server/prisma/schema.prisma` 已备好的 Prisma + PostgreSQL 方案。
