# 内存/JSON 存储迁移到 Prisma + PostgreSQL

> **作者**：lihanqi
> **创建时间**：2026-06-09（拆分自原《生产部署清单》）｜ **最后整理**：2026-06-10
> **生成方式**：Claude Code（模型 Claude Fable 5，`claude-fable-5`）辅助编写
> **状态**：📋 未实施。当前生产用 StoreService 的 JSON 文件落盘（挂 `serverdata` 卷，重启不丢），db 容器已随 compose 起着备用。
> 已预置制品：`server/prisma/schema.prisma`（覆盖需求文档 §9 全部模型）。

---

## 为什么要迁

`server/src/core/store.service.ts` 当前是**内存 Map + JSON 文件落盘**：数据量小、单实例够用，但不适合多实例/高并发，也缺乏事务与查询能力。生产正式化建议替换为 Prisma + PostgreSQL。

迁移的关键前提：**StoreService 是唯一持久化边界**，所有业务模块都按 `StoreService` 注入 —— 换实现不需要动任何 controller/service 调用方。

---

## 1. 安装依赖

```bash
cd server
pnpm add @prisma/client
pnpm add -D prisma
```

## 2. 配置连接 & 生成

`server/.env` 增加（compose 中已通过 `DATABASE_URL` 注入）：

```env
DATABASE_URL=postgresql://deploy:密码@db:5432/deploy_center
```

```bash
node node_modules/prisma/build/index.js generate          # 生成 client
node node_modules/prisma/build/index.js migrate deploy    # 应用迁移（生产）
# 首次本地开发用：prisma migrate dev --name init
```

## 3. 接入 NestJS（保持接口不变，平滑替换）

1. 新增 `PrismaService`（封装 `PrismaClient`，`onModuleInit` 调 `$connect()`）。
2. 新增 `PrismaStoreService`，**实现与 `StoreService` 完全相同的方法签名**（`upsertUser` / `getToken` / `createDeployment` / `listDeployments` / `getFavorites` / `getEnvConfigs` / `listUsers` / `deleteEnvConfigs` …），内部改用 Prisma 查询。
   - `oauthStates` 这类短期态建议改用 Redis 或带 TTL 的表。
3. 在 `CoreModule` 用 `PrismaStoreService` 提供 `StoreService` token：

   ```ts
   providers: [GitlabService, PrismaService,
     { provide: StoreService, useClass: PrismaStoreService }],
   exports: [GitlabService, StoreService, PrismaService],
   ```

4. token 加密：`accessTokenEnc` / `refreshTokenEnc` 用 `crypto`（AES-256-GCM，密钥放环境变量）加解密，切勿明文落库。

## 4. Dockerfile 启用 Prisma

`server/Dockerfile` 内已预留注释行，接入后取消注释：

```dockerfile
RUN node node_modules/prisma/build/index.js generate
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
```

并在容器启动前执行迁移（entrypoint 或 compose 启动命令里 `prisma migrate deploy`）。

## 5. 数据迁移

切换前把现有 JSON 数据导入 PG：写一次性脚本读 `serverdata` 卷里的 `store.json`，按模型写入数据库（用户、部署记录、收藏、环境配置），核对条数后再切流量。
