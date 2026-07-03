# GitLab OAuth 应用配置操作清单

> **作者**：lihanqi
> **创建时间**：2026-06-09 ｜ **最后整理**：2026-06-10
> **生成方式**：Claude Code（模型 Claude Fable 5，`claude-fable-5`）辅助编写
> 目的：为「一键部署系统」在公司 GitLab（http://10.0.6.203:8088/）创建 OAuth 应用，拿到 `client_id` / `client_secret`，使前后端能用 GitLab 账号登录并触发部署。
> 适用：本系统 BFF 后端的 `server/.env`。

> ⚠️ **现状说明（2026-06-10）**：当前生产环境登录已改用 **GitLab 个人访问令牌（PAT）**，未走 OAuth。本文档保留，供后续切回 OAuth 登录时使用；compose 启动时的 `GITLAB_CLIENT_ID/SECRET/OAUTH_REDIRECT_URI not set` 警告即因 OAuth 变量未配置，无害可忽略。

---

## 一、选择应用类型（先决定）

| 类型 | 创建入口 | 谁能用 | 推荐 |
| --- | --- | --- | --- |
| **实例级应用（Instance-wide）** | 管理员后台 | 全公司所有 GitLab 用户 | ✅ **推荐**，内部统一平台首选 |
| 组级应用（Group） | 某 Group 设置 | 该 Group 成员 | 仅服务单个部门时可用 |
| 用户级应用（User-owned） | 个人设置 | 仅创建者本人 | 仅本地自测临时用 |

> 实例级应用需要 **GitLab 管理员（Admin）权限**。若你不是管理员，请把本清单第三节交给运维/管理员操作，或先用「用户级应用」自测（见附录）。

---

## 二、创建前确认 3 个值

1. **回调地址（Redirect URI）** —— 必须与后端 `OAUTH_REDIRECT_URI` **完全一致**（含协议、端口、路径）：
   - 开发联调：`http://localhost:3000/api/auth/callback`
   - 生产部署：`http://<部署中心域名或IP>:<端口>/api/auth/callback`
   - 可同时填多个（每行一个），开发+生产一起填，省得来回改。
2. **Scope（权限范围）**：勾选 **`api`**（完整 API 权限）。
   - ⚠️ 必须是 `api` 而非 `read_api`——因为本系统要**触发流水线 / play job**，只读权限不够。
3. **Confidential（机密应用）**：勾选 **是 / Yes**（我们有后端持有 `client_secret`）。

---

## 三、创建步骤（实例级 · 管理员）

1. 用管理员账号登录 http://10.0.6.203:8088/
2. 进入 **Admin Area（管理中心）** → 左侧 **Applications（应用）** → **New application（新建应用）**
   - 直达地址：`http://10.0.6.203:8088/admin/applications/new`
3. 填写表单：
   - **Name（名称）**：`一键部署系统`（或 Deploy Center）
   - **Redirect URI**：填第二节的回调地址（多个换行）
   - **Trusted（受信任）**：建议 **勾选**——受信任应用对所有用户**跳过逐次授权确认页**，内部工具体验更顺；不勾则每个用户首次登录会看到一次授权确认页（也可接受）。
   - **Confidential**：**勾选**
   - **Scopes**：勾选 **`api`**
4. 点击 **Save application（保存）**
5. 保存后页面会显示：
   - **Application ID** → 即 `client_id`
   - **Secret** → 即 `client_secret`（⚠️ 只完整显示一次，立即复制保存；新版需点 “Copy/Reveal”）

---

## 四、填入后端配置

把拿到的值填进 `server/.env`（从 `server/.env.example` 复制）：

```env
GITLAB_URL=http://10.0.6.203:8088
GITLAB_CLIENT_ID=<上一步的 Application ID>
GITLAB_CLIENT_SECRET=<上一步的 Secret>
OAUTH_REDIRECT_URI=http://localhost:3000/api/auth/callback   # 必须与应用里填的完全一致
JWT_SECRET=<生成一段长随机串>                                  # 见下
FRONTEND_URL=http://localhost:5173
ADMIN_USERNAMES=<你的GitLab用户名>                            # 逗号分隔，决定谁是平台管理员
```

生成 `JWT_SECRET`（任选其一）：
```bash
# Node
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# PowerShell
[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
```

---

## 五、验证登录闭环

```bash
# 后端
cd server && pnpm install --ignore-workspace && pnpm start    # :3000
# 前端（另开终端）
pnpm install && pnpm dev                                       # :5173
```

1. 浏览器打开 http://localhost:5173
2. 因未登录触发 401 → 自动跳转 `/api/auth/login` → 跳到 GitLab 授权页
3. （若应用未设 Trusted）点击 **Authorize（授权）**
4. 跳回前端，地址栏短暂出现 `?token=...` 后被清除，进入项目列表 → 成功 ✅

**自检：** 直接访问 `http://localhost:3000/api/auth/login` 应当 302 跳到 GitLab 的 `/oauth/authorize?...`。若跳转地址里的 `client_id`/`redirect_uri` 不对，回到第三/四节核对。

---

## 六、常见报错对照

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `The redirect URI included is not valid` | 回调地址与应用里填的不一致 | 让 `OAUTH_REDIRECT_URI` 与应用 Redirect URI **逐字符**相同（注意端口/末尾斜杠/http vs https） |
| 授权后报 `state 校验失败` | 跨进程重启或多实例（内存存 state） | 同一进程内重试；生产换 Redis 存 state |
| 触发部署 403 / 权限不足 | scope 选了 `read_api` | 改为 `api` 重新创建/编辑应用 |
| 回调 `invalid_client` | client_id/secret 填错或应用被删 | 核对 `server/.env`，必要时重置 Secret |
| 能登录但项目列表为空 | 该账号在 GitLab 无可见项目，或 token 失效 | 换有项目权限的账号；确认 `GITLAB_URL` 正确 |

---

## 附录：用户级应用（无管理员权限时自测）

1. 登录 GitLab → 右上头像 → **Preferences / Edit profile** → 左侧 **Applications**
   - 直达：`http://10.0.6.203:8088/-/user_settings/applications`（旧版为 `/profile/applications`）
2. **Add new application**，其余字段同第二/三节（Redirect URI、勾选 `api`、Confidential）
3. 保存后同样得到 Application ID 与 Secret，填入 `server/.env`
> 局限：用户级应用只有创建者本人能用来登录，**不适合给团队共用**，仅做本地自测。
