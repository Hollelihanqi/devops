# 产品迭代规划 · CI/CD 多供应商架构 · AI 部署失败诊断 — 开发文档

> 版本：v1　｜　日期：2026-06-18　｜　角色视角：产品 + 架构 + 开发

---

## 0. 一句话方向

> **从「一键部署」走向「会诊断、会解释、会兜底的智能部署助手」。** 部署机制本身是通用品，护城河是**内网 MaaS 网关 + 对仓库代码与流水线日志的完整访问权**——把 AI 接到部署生命周期里，而不是放在旁边当独立问答框。

---

## 1. 迭代路线图（优先级）

### P0 — 让 AI 闭环到部署上（差异化，复用现有能力）
1. **AI 部署失败诊断** ⭐️ 首发。流水线失败 → 自动取失败 Job 日志 + 相关仓库代码 → 模型给「根因 + 修复建议 + 涉及文件」。复用 `ai.service`(工具循环) + `gitlab.service`(job trace)。**本文档 §3 详细设计。**
2. **发布说明 / 变更摘要**：部署前对比「上次部署 commit ~ 本次」，AI 生成本次改了什么、风险点在哪，让人敢点生产部署。

### P1 — 把部署核心做扎实（高频基础体验）
3. **一键回滚**：回滚到上一个成功部署的版本（生产事故救命）。
4. **环境现状看板**：每个环境当前跑的分支/commit、谁何时部署。
5. **生产部署审批 + 并发锁**：prod 需审批；同环境防并发覆盖。

### P2 — 规模化与度量
6. **存储迁移 Postgres**（多实例/持久化，替换内存 Map + JSON）。
7. **审计日志 + DORA 指标**（部署频率/成功率/MTTR）。

### 最后做 — 部署结果飞书通知
8. **部署通知**：成功/失败推送飞书（钉钉/企业微信可同模式扩展）。设计见 §3.5。
   > 按用户要求**排到最后**实现；逻辑只读 `Deployment` 统一字段，不依赖前序功能，随时可插。

> 多个 P1 功能（回滚、看板）也都依赖下面 §2 的供应商抽象，故 §2 是所有后续迭代的公共底座。

---

## 2. CI/CD 多供应商抽象（GitLab 现在，Jenkins 以后）

### 2.1 现状与问题
当前 `GitlabService` 被 `ProjectsService` / `DeploymentsService` 直接依赖，数据模型里到处是 `gitlabProjectId` / `gitlabPipelineId` / `gitlabJobId`。一旦接 Jenkins，会被迫到处加 `if (gitlab) ... else ...`。需要在引入新供应商**之前**先立一层抽象。

### 2.2 目标
- 业务层（部署、诊断、看板）只依赖**抽象接口**，不认识具体是 GitLab 还是 Jenkins。
- GitLab 保持现有实现不变（只是实现接口）；Jenkins 后续新增一个实现类即可接入，**业务代码零改动**。
- 渐进式落地，不做一次性大重构。

### 2.3 接口设计（`server/src/core/ci/`）

```ts
// ci-provider.interface.ts —— 业务层只认这个
export type CiProviderKind = 'gitlab' | 'jenkins'

export interface CiBuildRef {        // 一次「构建/流水线」的供应商无关引用
  pipelineId?: string | number       // GitLab pipeline / Jenkins build number
  jobId?: string | number            // 入口 job
  extra?: Record<string, unknown>    // 供应商私有字段（如 Jenkins jobName）
}

export interface CiBuildStatus {
  status: DeployStatus               // 统一状态：pending/running/success/failed/canceled
  progress: number                   // 0-100
  finishedAt?: string
  durationSec?: number
  webUrl?: string
}

export interface CiProvider {
  kind: CiProviderKind
  // —— 仓库（代码问答 / 诊断要读代码）——
  getProject(ctx: CiAuth, projectId: string): Promise<ProjectMeta>
  listRepoTree(ctx: CiAuth, projectId: string, ref: string): Promise<string[]>
  getRawFile(ctx: CiAuth, projectId: string, path: string, ref: string): Promise<string | null>
  listBranches(ctx: CiAuth, projectId: string): Promise<BranchMeta[]>
  // —— 部署 / 流水线 ——
  triggerBuild(ctx: CiAuth, p: TriggerParams): Promise<CiBuildRef>
  getBuildStatus(ctx: CiAuth, projectId: string, ref: CiBuildRef): Promise<CiBuildStatus>
  getBuildLogs(ctx: CiAuth, projectId: string, ref: CiBuildRef): Promise<CiJobLog[]> // 多 job 清洗后日志
  cancelBuild(ctx: CiAuth, projectId: string, ref: CiBuildRef): Promise<void>
}

export interface CiJobLog { stage: string; name: string; status: string; trace: string }
```

> `CiAuth` 抽象「鉴权上下文」：GitLab 是 OAuth token，Jenkins 是 user+apiToken/crumb。`projectId` 统一成 string（GitLab 数字 id 转 string，Jenkins 用 jobName/path）。

### 2.4 落地步骤（不破坏现网）
1. **Phase 0（随本功能一起做最小子集）**：新建 `core/ci/` 目录与接口；让现有 `GitlabService` 适配出一个 `GitlabCiProvider implements CiProvider`（**薄封装，转调已有方法**，不重写 GitLab 逻辑）。新功能（诊断）只调 `CiProvider`。
2. **Phase 1**：新增 `CiProviderRegistry`，按 `project.provider` 返回对应实现；`DeploymentsService` 逐步从直依赖 `GitlabService` 迁到 `CiProvider`。
3. **Phase 2**：数据模型把 `gitlabProjectId/gitlabPipelineId/gitlabJobId` 收敛为 `provider + externalProjectId + CiBuildRef`（保留兼容字段，平滑迁移）。
4. **Phase 3**：实现 `JenkinsCiProvider`（Job 触发用 `buildWithParameters`，状态查 `/job/:name/:n/api/json`，日志查 `/consoleText`），在「项目-供应商」配置里可选 Jenkins。

> 本次只做 Phase 0 的最小子集——刚好够「失败诊断」用，不提前过度设计。

---

## 3. 首发功能详细设计：AI 部署失败诊断

### 3.1 用户故事
- 作为发起部署的开发者，当部署失败时，我能**一键让 AI 看日志 + 看代码，告诉我为什么失败、怎么修**，而不用自己翻几百行流水线日志。
- 诊断结果可直接转入「代码问答」继续追问。

### 3.2 交互
- 部署详情页（`DeploymentDetail`）/ 历史列表里，**失败**（`status==='failed'`）的部署显示「AI 诊断」按钮。
- 点击 → 抽屉/面板展示：① 根因（一句话）；② 详细分析；③ 修复建议（可含代码片段）；④ 涉及文件（点击可跳代码问答）。
- 诊断结果**落盘缓存**（同一次失败不重复烧 token），可「重新诊断」。

### 3.3 后端流程
```
POST /deployments/:id/diagnose  { model? }
  1. 取部署记录，校验：存在 + status==='failed' + 归属(发起人或 admin)
  2. 经 CiProvider.getBuildLogs() 取失败 job 的清洗日志（复用现有 cleanTrace + logs 拼接逻辑）
  3. 截取「失败 job 的尾部日志」(报错通常在末尾, 取末 ~15KB) 作为锚点
  4. 调 ai.chatAgent()：
       system: 「你是 CI/CD 排障专家，依据失败日志 + 仓库代码定位根因」
       首条 user: 失败日志片段 + 项目/分支/环境信息
       tools: 复用 REPO_TOOLS(list_repo_files/read_file/grep) —— 让模型按需读相关代码
       maxIterations: 较小(如 12)
  5. 解析输出为 { rootCause, analysis, suggestion, files[] }（结构化输出 or 文本+轻解析）
  6. 落盘到 deployment.diagnosis 缓存，返回
```

### 3.4 数据模型（`common/types.ts`）
```ts
export interface DeployDiagnosis {
  rootCause: string
  analysis: string
  suggestion: string
  files: string[]
  model?: string
  createdAt: number
}
// Deployment 增补：diagnosis?: DeployDiagnosis
```

### 3.5 复用点（不重造轮子）
- 日志获取：`DeploymentsService.logs()` 已实现「多 job trace 清洗 + 拼接」，抽出 `getCleanedJobLogs()` 供诊断复用。
- 工具循环：`AiService.chatAgent()` + `REPO_TOOLS`（代码问答已建好）。
- 读代码鉴权：复用用户 GitLab token。

### 3.6 接口
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/deployments/:id/diagnose` | 触发/重新诊断，返回 `DeployDiagnosis` |
| GET | `/deployments/:id/diagnose` | 取已缓存诊断（无则 204/空） |

### 3.7 前端
- `DeploymentDetail.tsx`：失败态加「AI 诊断」按钮 + 结果展示区（根因高亮、建议、涉及文件 Tag 可跳问答）。
- `src/api/` 增 `diagnose(deploymentId, model?)` / `getDiagnosis(deploymentId)`。
- 模型选择复用 `useModelChoice`。

### 3.8 验收标准
- [ ] 仅失败部署可诊断；非失败/越权返回明确错误。
- [ ] 诊断能基于日志 + 真实读到的仓库代码给出根因（引用具体文件）。
- [ ] 结果落盘缓存，重开不重复烧 token；支持「重新诊断」。
- [ ] 诊断里的文件可一键带入「代码问答」继续追问。
- [ ] 诊断逻辑只依赖 `CiProvider` 抽象（不直接 import GitlabService），为 Jenkins 留好口子。
- [ ] 前后端 `tsc --noEmit` 通过。

---

## 3.5 P1 功能设计：部署结果飞书通知

### 目标
部署到达终态（success/failed）时，自动向飞书群推送一张构建报告卡片（对标现网 Jenkins 机器人样式：项目名 + 状态 + 环境/分支/构建号 + 时长 + 发起人 + 「查看详情」按钮）。

### 触发机制
当前部署状态是**懒刷新**（`DeploymentsService.refresh()` 在 list/detail 轮询时把 running→终态）。为保证"没人开页面也能通知"，加一个**后台轮询器**：
- `DeploymentsService` 在 `OnModuleInit` 起一个 `setInterval`（如 15s），扫描所有非终态部署，调 `refresh()`。
- `refresh()` 内检测「非终态 → 终态」跃迁：若 `!dep.notified`，调 `NotifyService.notifyDeployment(dep)` 后 `updateDeployment(id,{notified:true})`，**保证只发一次**。
- 后台轮询需要发起人的 GitLab token（`store.getToken(userId)`）；无 token 时跳过，等下次。

### Webhook 配置（解析顺序：按项目 → 全局）
- 全局：环境变量 `FEISHU_WEBHOOK_URL`（v1 必做，改 .env 即生效）。
- 按项目：`store.feishuWebhooks: Map<projectId,string>` + 设置接口（v1 留口子，前端 UI 可后续补）。
- 解析：`getFeishuWebhook(projectId) = perProject ?? globalEnv`。

### NotifyService（`server/src/core/notify.service.ts`）
- `notifyDeployment(dep, webhookUrl)`：构造飞书 `interactive` 卡片（成功绿/失败红模板）→ axios POST webhook。
- 卡片字段：构建状态、项目名称、环境、分支、构建编号(pipelineId)、运行时长、发起人；按钮跳 `dep.projectWebUrl` 对应 pipeline 页。
- 失败仅告警，不影响部署主流程。

### 数据模型
- `Deployment` 增补 `notified?: boolean`。
- `store` 增 `feishuWebhooks` Map（落盘）+ `getFeishuWebhook/setFeishuWebhook`。

### 接口（v1 可选）
| 方法 | 路径 | 说明 |
|---|---|---|
| PUT | `/projects/:id/notify/feishu` | 设置该项目飞书 webhook（按项目方案才需要） |

### 供应商无关性
通知逻辑只读 `Deployment` 的统一字段（status/env/ref/pipelineId/triggeredByName/projectWebUrl），**不碰 GitLab/Jenkins 细节** → Jenkins 接入后通知自动复用。

### 验收
- [ ] 部署成功/失败各推一张卡片，且**只推一次**（不因多次轮询重复）。
- [ ] 全局 `FEISHU_WEBHOOK_URL` 生效；配了按项目 webhook 时优先用项目的。
- [ ] webhook 故障不影响部署本身。
- [ ] 后台轮询器在无人看页面时也能触发通知。

---

## 4. 实施顺序（建议新开会话逐项做）
1. **Step 1**：建 `core/ci/` 接口 + `GitlabCiProvider` 薄封装（Phase 0 最小子集）。
2. **Step 2**：`DeploymentsService` 抽出 `getCleanedJobLogs()`；新增 `diagnose()`。
3. **Step 3**：`common/types.ts` 加 `DeployDiagnosis`；`store` 加诊断缓存读写。
4. **Step 4**：controller 加两个接口。
5. **Step 5**：前端 `DeploymentDetail` 接入 + api。
6. **Step 6**：`tsc` 双端校验 + 真网关跑一遍失败用例。

---

## 5. 风险与备注
- **Jenkins 差异**：Jenkins 无「pipeline 内多 job trace」概念（是 stage/console），`getBuildLogs` 在 Jenkins 实现里返回单条 console 即可，接口已用 `CiJobLog[]` 兼容。
- **成本控制**：诊断 `maxIterations` 调小、日志只喂尾部片段、结果缓存，避免每次失败都全量烧 token。
- **不过度抽象**：本次只落 Phase 0 最小接口子集，够诊断用即可；完整的供应商收敛（Phase 1-3）随回滚/看板等功能逐步推进。
