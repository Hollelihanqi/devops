# ---------- Build ----------
# 钉死 alpine3.21（2025-10 的 Node 22.20 代）：镜像源 2026-06 同步的
# 22-alpine(=22.22/alpine3.23) 在本服务器老内核上 io_uring/SQLite 全挂
FROM node:22-alpine3.21 AS build
WORKDIR /app

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV PNPM_STORE_DIR=/tmp/pnpm-store
# 关掉 libuv 的 io_uring：新版 Node 镜像启用了它，但宿主机 Docker 的
# seccomp 会把 io_uring 系统调用拦成 EPERM，导致写文件随机报错
ENV UV_USE_IO_URING=0

# 不用 corepack（新镜像里 corepack prepare 报 EPERM）；
# 也不用 pnpm config set（同样报 EPERM），改用命令行参数传配置
RUN npm i -g pnpm@11.2.2

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# store 放 tmpfs：pnpm 的 SQLite 索引在服务器 overlayfs 上报 disk I/O error；
# import-method=copy 保证 node_modules 是真实拷贝，store 用完即弃没关系
RUN --mount=type=tmpfs,target=/tmp/pnpm-store \
    pnpm install --frozen-lockfile --store-dir=$PNPM_STORE_DIR --package-import-method=copy

COPY . .
RUN node node_modules/typescript/bin/tsc --noEmit \
 && node node_modules/vite/bin/vite.js build

# ---------- Runtime ----------
FROM nginx:alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
