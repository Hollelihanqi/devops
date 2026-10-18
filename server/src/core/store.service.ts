import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as fs from 'fs'
import * as path from 'path'
import type {
  Conversation,
  Deployment,
  DeployDiagnosis,
  ProjectEnvConfig,
  ProjectMemory,
  Prompt,
  SessionUser,
  StoredToken,
} from '../common/types'

/**
 * 存储层：内存 Map + JSON 文件落盘。
 * 启动时从 DATA_FILE 恢复，写操作后防抖落盘，进程退出前兜底 flush。
 * 崩溃防护：落盘走「fsync 临时文件 → rename」，每日轮转快照到 backups/；
 * 主文件损坏时留档 .corrupt-* 并尝试从备份恢复，均失败则拒绝启动（绝不带空存储覆写仅存的恢复机会）。
 * 数据量小、单实例内部工具适用；高并发/多实例请切换 Prisma + PostgreSQL（见需求文档 §9）。
 */
@Injectable()
export class StoreService implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly config: ConfigService) {}

  private readonly logger = new Logger(StoreService.name)

  private users = new Map<number, SessionUser>()
  private tokens = new Map<number, StoredToken>()
  private deployments = new Map<number, Deployment>()
  private favorites = new Map<number, Set<number>>() // userId -> projectIds
  private envConfigs = new Map<number, ProjectEnvConfig[]>() // projectId -> configs
  private userOverrides = new Map<number, { isAdmin?: boolean; disabled?: boolean }>() // 管理页设置的角色/状态
  private prompts = new Map<number, Prompt>() // AI 提示词库
  private aiKeys = new Map<number, string>() // userId -> AES-GCM 加密后的网关 API Key
  private conversations = new Map<number, Conversation>() // 项目代码问答会话（含历史消息）
  private projectMemory = new Map<string, ProjectMemory>() // `${userId}:${projectId}` -> 项目长期记忆
  private oauthStates = new Map<string, number>() // state -> createdAt（短时态，不落盘）
  private seq = 1

  // ---- 持久化 ----
  private dataFile = ''
  private tmpFile = ''
  private backupsDir = '' // 每日快照目录，主文件损坏时的恢复来源
  private lastBackupDay = ''
  private saveTimer: NodeJS.Timeout | null = null

  onModuleInit() {
    this.dataFile =
      this.config.get<string>('DATA_FILE') || path.join(process.cwd(), 'data', 'store.json')
    this.tmpFile = `${this.dataFile}.tmp`
    this.backupsDir = path.join(path.dirname(this.dataFile), 'backups')
    this.load()
  }

  onModuleDestroy() {
    // 退出前把未落盘的防抖写刷掉
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    this.persist()
  }

  private load() {
    if (!fs.existsSync(this.dataFile)) {
      this.logger.log(`无历史数据文件，使用空存储（将写入 ${this.dataFile}）`)
      return
    }
    try {
      this.loadFrom(this.dataFile)
    } catch (e) {
      // 主文件损坏：先移出留档（.corrupt-<ts>），再试最新备份；
      // 都失败则抛错拒绝启动——绝不能带空存储继续跑，否则首次落盘会把仅存的恢复机会也覆盖掉
      const corrupt = `${this.dataFile}.corrupt-${Date.now()}`
      try {
        fs.renameSync(this.dataFile, corrupt)
        this.logger.error(`数据文件损坏，已移至 ${corrupt}：${(e as Error).message}`)
      } catch (renameErr) {
        this.logger.error(
          `数据文件损坏且无法移出（${(renameErr as Error).message}）：${(e as Error).message}`,
        )
      }
      const backup = this.latestBackup()
      if (backup) {
        try {
          this.loadFrom(backup)
          this.logger.warn(`已从备份 ${backup} 恢复（数据回退到备份时点，请人工核对）`)
          return
        } catch (be) {
          this.logger.error(`备份 ${backup} 亦损坏：${(be as Error).message}`)
        }
      }
      throw new Error(
        `持久化数据无法恢复（主文件与备份均不可用），已拒绝启动以防覆盖，请人工检查 ${path.dirname(this.dataFile)}`,
      )
    }
  }

  private loadFrom(file: string) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
    this.seq = raw.seq ?? 1
    this.users = new Map(raw.users ?? [])
    this.tokens = new Map(raw.tokens ?? [])
    this.deployments = new Map(raw.deployments ?? [])
    this.favorites = new Map(
      (raw.favorites ?? []).map(([uid, arr]: [number, number[]]) => [uid, new Set(arr)]),
    )
    this.envConfigs = new Map(raw.envConfigs ?? [])
    this.userOverrides = new Map(raw.userOverrides ?? [])
    this.prompts = new Map(raw.prompts ?? [])
    this.aiKeys = new Map(raw.aiKeys ?? [])
    this.conversations = new Map(raw.conversations ?? [])
    this.projectMemory = new Map(raw.projectMemory ?? [])
    this.logger.log(
      `已从 ${file} 恢复数据：用户 ${this.users.size}、部署 ${this.deployments.size}、收藏用户 ${this.favorites.size}、提示词 ${this.prompts.size}`,
    )
  }

  /** backups/ 里最新的每日快照（文件名含日期，字典序即时间序） */
  private latestBackup(): string | undefined {
    if (!fs.existsSync(this.backupsDir)) return undefined
    const files = fs
      .readdirSync(this.backupsDir)
      .filter((f) => /^store-\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort()
    return files.length ? path.join(this.backupsDir, files[files.length - 1]) : undefined
  }

  /** 写操作后调用：300ms 防抖，合并高频写入 */
  private schedulePersist() {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.persist()
    }, 300)
  }

  /**
   * 原子写入：临时文件写完先 fsync 再 rename，最后刷目录项——
   * 断电时要么旧文件完好、要么新文件完整，不会出现空文件/半截文件。
   */
  private persist() {
    if (!this.dataFile) return
    try {
      try {
        this.rotateBackup()
      } catch (e) {
        this.logger.warn(`每日快照失败（不影响本次落盘）：${(e as Error).message}`)
      }
      const snapshot = {
        seq: this.seq,
        users: [...this.users],
        tokens: [...this.tokens],
        deployments: [...this.deployments],
        favorites: [...this.favorites].map(([uid, set]) => [uid, [...set]]),
        envConfigs: [...this.envConfigs],
        userOverrides: [...this.userOverrides],
        prompts: [...this.prompts],
        aiKeys: [...this.aiKeys],
        conversations: [...this.conversations],
        projectMemory: [...this.projectMemory],
      }
      fs.mkdirSync(path.dirname(this.dataFile), { recursive: true })
      const fd = fs.openSync(this.tmpFile, 'w')
      try {
        fs.writeFileSync(fd, JSON.stringify(snapshot))
        fs.fsyncSync(fd)
      } finally {
        fs.closeSync(fd)
      }
      fs.renameSync(this.tmpFile, this.dataFile)
      this.fsyncDir(path.dirname(this.dataFile))
    } catch (e) {
      this.logger.error(`持久化失败：${(e as Error).message}`)
    }
  }

  /** 每天首次落盘前，把现有主文件快照进 backups/（保留最近 14 份），主文件损坏时由此恢复 */
  private rotateBackup() {
    const today = new Date().toISOString().slice(0, 10)
    if (this.lastBackupDay === today || !fs.existsSync(this.dataFile)) return
    fs.mkdirSync(this.backupsDir, { recursive: true })
    fs.copyFileSync(this.dataFile, path.join(this.backupsDir, `store-${today}.json`))
    this.lastBackupDay = today
    const files = fs
      .readdirSync(this.backupsDir)
      .filter((f) => /^store-\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort()
    for (const f of files.slice(0, Math.max(0, files.length - 14))) {
      fs.rmSync(path.join(this.backupsDir, f), { force: true })
    }
  }

  /** 刷目录项让 rename 本身也落盘；Windows 等不支持打开目录的平台忽略 */
  private fsyncDir(dir: string) {
    try {
      const fd = fs.openSync(dir, 'r')
      try {
        fs.fsyncSync(fd)
      } finally {
        fs.closeSync(fd)
      }
    } catch {
      // 目录不可打开/fsync 时放弃，rename 的持久性由文件 fsync 兜底
    }
  }

  // ---- OAuth state（CSRF 防护，10 分钟有效，进程内即可，不落盘）----
  saveState(state: string) {
    this.oauthStates.set(state, Date.now())
  }
  consumeState(state: string): boolean {
    const t = this.oauthStates.get(state)
    this.oauthStates.delete(state)
    return !!t && Date.now() - t < 10 * 60_000
  }

  // ---- 用户 / token ----
  private envAdmins(): string[] {
    return (this.config.get<string>('ADMIN_USERNAMES') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }

  /** 是否环境变量指定的固定管理员（不可在界面取消） */
  isEnvAdmin(username: string): boolean {
    return this.envAdmins().includes(username)
  }

  upsertUser(u: Omit<SessionUser, 'isAdmin'>): SessionUser {
    const o = this.userOverrides.get(u.id) ?? {}
    const user: SessionUser = {
      ...u,
      isAdmin: this.isEnvAdmin(u.username) || !!o.isAdmin,
      disabled: !!o.disabled,
    }
    this.users.set(user.id, user)
    this.schedulePersist()
    return user
  }

  /** 管理页：设置/取消管理员（环境变量管理员始终保持管理员） */
  setUserAdmin(userId: number, on: boolean) {
    const o = this.userOverrides.get(userId) ?? {}
    o.isAdmin = on
    this.userOverrides.set(userId, o)
    const u = this.users.get(userId)
    if (u) this.users.set(userId, { ...u, isAdmin: this.isEnvAdmin(u.username) || on })
    this.schedulePersist()
  }

  /** 管理页：禁用/启用账号，即时生效（JwtGuard 每次请求都读 users） */
  setUserDisabled(userId: number, on: boolean) {
    const o = this.userOverrides.get(userId) ?? {}
    o.disabled = on
    this.userOverrides.set(userId, o)
    const u = this.users.get(userId)
    if (u) this.users.set(userId, { ...u, disabled: on })
    this.schedulePersist()
  }
  getUser(id: number) {
    return this.users.get(id)
  }
  listUsers(): SessionUser[] {
    return [...this.users.values()]
  }
  /** 当前是否持有有效 GitLab token（用于管理页展示授权状态） */
  hasToken(userId: number): boolean {
    return this.tokens.has(userId)
  }
  setToken(userId: number, token: StoredToken) {
    this.tokens.set(userId, token)
    this.schedulePersist()
  }
  getToken(userId: number): string | undefined {
    return this.tokens.get(userId)?.accessToken
  }
  clearToken(userId: number) {
    this.tokens.delete(userId)
    this.schedulePersist()
  }

  // ---- 收藏 ----
  getFavorites(userId: number): Set<number> {
    return this.favorites.get(userId) ?? new Set()
  }
  toggleFavorite(userId: number, projectId: number, on: boolean) {
    const set = this.favorites.get(userId) ?? new Set<number>()
    if (on) set.add(projectId)
    else set.delete(projectId)
    this.favorites.set(userId, set)
    this.schedulePersist()
  }

  // ---- 环境配置 ----
  getEnvConfigs(projectId: number): ProjectEnvConfig[] | undefined {
    return this.envConfigs.get(projectId)
  }
  setEnvConfigs(projectId: number, configs: ProjectEnvConfig[]) {
    this.envConfigs.set(projectId, configs)
    this.schedulePersist()
  }
  deleteEnvConfigs(projectId: number) {
    this.envConfigs.delete(projectId)
    this.schedulePersist()
  }

  // ---- 部署记录 ----
  createDeployment(d: Omit<Deployment, 'id'>): Deployment {
    const dep: Deployment = { ...d, id: this.seq++ }
    this.deployments.set(dep.id, dep)
    this.schedulePersist()
    return dep
  }
  getDeployment(id: number) {
    return this.deployments.get(id)
  }
  updateDeployment(id: number, patch: Partial<Deployment>) {
    const d = this.deployments.get(id)
    if (d) {
      this.deployments.set(id, { ...d, ...patch })
      this.schedulePersist()
    }
  }
  listDeployments(filter: { projectId?: number; status?: string }): Deployment[] {
    let list = [...this.deployments.values()]
    if (filter.projectId) list = list.filter((d) => d.gitlabProjectId === filter.projectId)
    if (filter.status) list = list.filter((d) => d.status === filter.status)
    return list.sort((a, b) => b.id - a.id)
  }
  /** 某项目最近一次部署（用于项目列表展示） */
  lastDeployByProject(projectId: number): Deployment | undefined {
    return this.listDeployments({ projectId })[0]
  }
  /** 取某次部署的 AI 失败诊断缓存（无则 undefined） */
  getDiagnosis(id: number): DeployDiagnosis | undefined {
    return this.deployments.get(id)?.diagnosis
  }
  /** 落盘某次部署的 AI 失败诊断结果 */
  setDiagnosis(id: number, diagnosis: DeployDiagnosis) {
    this.updateDeployment(id, { diagnosis })
  }

  // ---- AI 提示词库 ----
  listPrompts(userId: number): Prompt[] {
    return [...this.prompts.values()].filter((p) => p.userId === userId)
  }
  /** 别人共享给该用户的提示词（owner 不是自己、但 sharedTo 含自己） */
  listSharedInPrompts(userId: number): Prompt[] {
    return [...this.prompts.values()].filter(
      (p) => p.userId !== userId && (p.sharedTo ?? []).includes(userId),
    )
  }
  getPrompt(id: number): Prompt | undefined {
    return this.prompts.get(id)
  }
  createPrompt(p: Omit<Prompt, 'id'>): Prompt {
    const prompt: Prompt = { ...p, id: this.seq++ }
    this.prompts.set(prompt.id, prompt)
    this.schedulePersist()
    return prompt
  }
  updatePrompt(id: number, patch: Partial<Prompt>): Prompt | undefined {
    const p = this.prompts.get(id)
    if (!p) return undefined
    const next = { ...p, ...patch }
    this.prompts.set(id, next)
    this.schedulePersist()
    return next
  }
  deletePrompt(id: number) {
    this.prompts.delete(id)
    this.schedulePersist()
  }

  // ---- AI 网关 Key（存的是加密后的密文，加解密在 PromptsService）----
  setAiKey(userId: number, encrypted: string) {
    this.aiKeys.set(userId, encrypted)
    this.schedulePersist()
  }
  getAiKey(userId: number): string | undefined {
    return this.aiKeys.get(userId)
  }
  clearAiKey(userId: number) {
    this.aiKeys.delete(userId)
    this.schedulePersist()
  }

  // ---- 项目代码问答：会话历史 ----
  /** 新建空会话 */
  createConversation(c: Omit<Conversation, 'id'>): Conversation {
    const conv: Conversation = { ...c, id: this.seq++ }
    this.conversations.set(conv.id, conv)
    this.schedulePersist()
    return conv
  }
  getConversation(id: number): Conversation | undefined {
    return this.conversations.get(id)
  }
  /** 列出某用户在某项目下的会话（按更新时间倒序，不含消息体，供侧栏列表） */
  listConversations(userId: number, projectId: number): Omit<Conversation, 'messages'>[] {
    return [...this.conversations.values()]
      .filter((c) => c.userId === userId && c.gitlabProjectId === projectId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(({ messages, ...rest }) => rest)
  }
  updateConversation(id: number, patch: Partial<Omit<Conversation, 'id' | 'userId'>>) {
    const c = this.conversations.get(id)
    if (!c) return
    this.conversations.set(id, { ...c, ...patch, updatedAt: Date.now() })
    this.schedulePersist()
  }
  deleteConversation(id: number) {
    this.conversations.delete(id)
    this.schedulePersist()
  }

  // ---- 项目代码问答：长期记忆 ----
  private memoryKey(userId: number, projectId: number): string {
    return `${userId}:${projectId}`
  }
  getProjectMemory(userId: number, projectId: number): ProjectMemory | undefined {
    return this.projectMemory.get(this.memoryKey(userId, projectId))
  }
  setProjectMemory(userId: number, projectId: number, summary: string) {
    this.projectMemory.set(this.memoryKey(userId, projectId), {
      userId,
      gitlabProjectId: projectId,
      summary,
      updatedAt: Date.now(),
    })
    this.schedulePersist()
  }
}
