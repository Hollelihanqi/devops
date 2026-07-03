import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { GitlabService } from '../core/gitlab.service'
import { StoreService } from '../core/store.service'
import { AiService, type ChatTurn } from '../prompts/ai.service'
import { REPO_TOOLS, runRepoTool, isIgnoredPath } from '../core/ci/repo-tools'
import type { ProjectEnvConfig, SessionUser } from '../common/types'

/** 默认「分支→环境」推断约定（见需求文档 §6.5），仅作初值，可被配置覆盖 */
const ENV_CONVENTION: { branch: string; envCode: string; name: string; prod?: boolean }[] = [
  { branch: 'develop', envCode: 'test', name: '测试' },
  { branch: 'release', envCode: 'staging', name: '预发' },
  { branch: 'staging', envCode: 'staging', name: '预发' },
  { branch: 'master', envCode: 'prod', name: '生产', prod: true },
  { branch: 'main', envCode: 'prod', name: '生产', prod: true },
]

/** CI 配置文件路径（按 GitLab 默认约定，不处理自定义 ci_config_path） */
const CI_FILE = '.gitlab-ci.yml'
const CI_CACHE_TTL = 10 * 60_000
/** 项目类型识别缓存 TTL：类型几乎不变，缓存久一点（1 小时） */
const KIND_CACHE_TTL = 60 * 60_000

@Injectable()
export class ProjectsService {
  constructor(
    private readonly gitlab: GitlabService,
    private readonly store: StoreService,
    private readonly config: ConfigService,
    private readonly ai: AiService,
  ) {}

  private readonly logger = new Logger(ProjectsService.name)
  /** projectId -> 是否存在 .gitlab-ci.yml（带 TTL，避免列表每次刷新都打满 GitLab） */
  private ciCache = new Map<number, { has: boolean; at: number }>()
  /** projectId -> 识别出的项目类型标签（Vue/React/小程序/Java/Go），带 TTL；类型很少变，TTL 较长 */
  private kindCache = new Map<number, { kind?: string; at: number }>()

  /**
   * 检测 CI 配置：先查默认分支；没有再查各环境绑定分支（覆盖配置优先，否则按约定分支）。
   * GitLab 的 .gitlab-ci.yml 按分支生效，部署走的是环境绑定分支上的 yml，
   * 只查默认分支会把「yml 只在 develop 上」的项目误判为不可部署。
   */
  private async detectCiConfig(
    token: string,
    projectId: number,
    defaultBranch: string,
  ): Promise<boolean> {
    if (await this.gitlab.repoFileExists(token, projectId, CI_FILE, defaultBranch)) return true

    const override = this.store.getEnvConfigs(projectId)
    let candidates: string[]
    if (override?.length) {
      candidates = override.map((c) => c.ref)
    } else {
      const branches = await this.gitlab.getBranches(token, projectId)
      const names = new Set(branches.map((b) => b.name))
      candidates = ENV_CONVENTION.map((c) => c.branch).filter((b) => names.has(b))
    }
    for (const ref of [...new Set(candidates)].filter((r) => r && r !== defaultBranch)) {
      if (await this.gitlab.repoFileExists(token, projectId, CI_FILE, ref)) return true
    }
    return false
  }

  private async hasCiConfig(
    token: string,
    projectId: number,
    defaultBranch: string,
    force = false,
  ): Promise<boolean> {
    const hit = this.ciCache.get(projectId)
    if (!force && hit && Date.now() - hit.at < CI_CACHE_TTL) return hit.has
    try {
      const has = await this.detectCiConfig(token, projectId, defaultBranch)
      this.ciCache.set(projectId, { has, at: Date.now() })
      return has
    } catch {
      // 临时故障不写缓存：退回旧值，没有旧值按未配置处理（部署入口置灰，安全侧）
      return hit?.has ?? false
    }
  }

  private token(user: SessionUser): string {
    const t = this.store.getToken(user.id)
    if (!t) throw new UnauthorizedException('GitLab 授权已失效，请重新登录')
    return t
  }

  // ---- 项目类型识别（卡片标签）----

  /** 带缓存地识别项目类型标签（Vue/React/小程序/Java/Go），识别不出返回 undefined */
  private async projectKind(
    token: string,
    projectId: number,
    defaultBranch: string,
    force = false,
  ): Promise<string | undefined> {
    const hit = this.kindCache.get(projectId)
    if (!force && hit && Date.now() - hit.at < KIND_CACHE_TTL) return hit.kind
    try {
      const kind = await this.detectProjectKind(token, projectId, defaultBranch)
      this.kindCache.set(projectId, { kind, at: Date.now() })
      return kind
    } catch {
      // 临时故障不写缓存：退回旧值（没有就当识别不出，不显示标签）
      return hit?.kind
    }
  }

  /**
   * 识别项目类型：
   * 1) 先用 GitLab 语言占比（一次调用）判定 Go / Java / Vue；
   * 2) 主语言是 JS/TS（或带 Vue）时，再读 package.json 区分 React / Vue / 小程序；
   * 3) 语言占比为空（默认分支可能是空 main，无实际代码）时，回退到 develop/master/main 上按文件探测。
   */
  private async detectProjectKind(
    token: string,
    projectId: number,
    defaultBranch: string,
  ): Promise<string | undefined> {
    const langs = await this.gitlab
      .getLanguages(token, projectId)
      .catch(() => ({} as Record<string, number>))
    const best = this.topKnownLang(langs)
    if (best === 'Go') return 'Go'
    if (best === 'Java') return 'Java'
    if (best === 'Python') return 'Python'
    if (best === 'Vue' || best === 'JS') {
      const fe = await this.classifyFrontend(token, projectId, defaultBranch)
      if (fe) return fe
      return best === 'Vue' ? 'Vue' : undefined
    }
    // 语言占比为空 → 默认分支没代码，回退到其它常用分支按文件探测
    if (!Object.keys(langs).length) {
      return this.detectKindByFiles(token, projectId, defaultBranch)
    }
    return undefined
  }

  /** 取语言占比里我们关心的最高占比语言；JS/TS 归一为 'JS' 交给 package.json 进一步区分 */
  private topKnownLang(
    langs: Record<string, number>,
  ): 'Go' | 'Java' | 'Python' | 'Vue' | 'JS' | undefined {
    let best: 'Go' | 'Java' | 'Python' | 'Vue' | 'JS' | undefined
    let pct = -1
    for (const [lang, raw] of Object.entries(langs)) {
      const p = Number(raw) || 0
      let mapped: 'Go' | 'Java' | 'Python' | 'Vue' | 'JS' | undefined
      if (lang === 'Go') mapped = 'Go'
      else if (lang === 'Java') mapped = 'Java'
      else if (lang === 'Python') mapped = 'Python'
      else if (lang === 'Vue') mapped = 'Vue'
      else if (lang === 'JavaScript' || lang === 'TypeScript') mapped = 'JS'
      if (mapped && p > pct) {
        best = mapped
        pct = p
      }
    }
    return best
  }

  /** 读某分支的 package.json 区分前端类型（小程序 / React / Vue），读不到或认不出返回 undefined */
  private async classifyFrontend(
    token: string,
    projectId: number,
    ref: string,
  ): Promise<string | undefined> {
    const raw = await this.gitlab.getRawFile(token, projectId, 'package.json', ref).catch(() => null)
    if (!raw) return undefined
    return this.classifyPackageJson(raw)
  }

  private classifyPackageJson(raw: string): string | undefined {
    let pkg: any
    try {
      pkg = JSON.parse(raw)
    } catch {
      return undefined
    }
    const deps: Record<string, string> = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
    const names = Object.keys(deps)
    const has = (re: RegExp) => names.some((n) => re.test(n))
    // 小程序优先：uni-app(@dcloudio) / Taro(@tarojs) / 原生小程序字段（底层可能也用 vue/react）
    if (has(/^@dcloudio\//) || has(/^@tarojs\//) || 'miniprogram' in pkg) return '小程序'
    if ('react' in deps || 'react-dom' in deps) return 'React'
    if ('vue' in deps || has(/^@vue\//)) return 'Vue'
    // 有 package.json 但不是上述前端框架 → 视为纯 Node.js（后端/SDK/工具库等）
    return 'Node.js'
  }

  /** 默认分支无代码时的回退：按 develop/master/main(/默认分支) 顺序探测关键文件 */
  private async detectKindByFiles(
    token: string,
    projectId: number,
    defaultBranch: string,
  ): Promise<string | undefined> {
    // 默认分支已知是空的，放最后；优先探测最可能有代码的 develop/master/main
    const refs = [...new Set(['develop', 'master', 'main', defaultBranch])].filter(Boolean)
    const exists = (path: string, ref: string) =>
      this.gitlab.repoFileExists(token, projectId, path, ref).catch(() => false)
    for (const ref of refs) {
      const fe = await this.classifyFrontend(token, projectId, ref)
      if (fe) return fe
      if (await exists('go.mod', ref)) return 'Go'
      if ((await exists('pom.xml', ref)) || (await exists('build.gradle', ref))) return 'Java'
      if (
        (await exists('requirements.txt', ref)) ||
        (await exists('pyproject.toml', ref)) ||
        (await exists('setup.py', ref)) ||
        (await exists('Pipfile', ref))
      )
        return 'Python'
      if (await exists('project.config.json', ref)) return '小程序'
    }
    return undefined
  }

  async groupTree(user: SessionUser) {
    const groups = await this.gitlab.listGroups(this.token(user))
    const byId = new Map<number, any>()
    groups.forEach((g) =>
      byId.set(g.id, { id: g.id, gitlabGroupId: g.id, name: g.name, fullPath: g.full_path, parentId: g.parent_id, children: [] }),
    )
    const roots: any[] = []
    byId.forEach((node) => {
      const parent = node.parentId && byId.get(node.parentId)
      if (parent) parent.children.push(node)
      else roots.push(node)
    })
    return roots
  }

  async list(
    user: SessionUser,
    q: { groupId?: number; keyword?: string; onlyFavorite?: boolean; fresh?: boolean },
  ) {
    const token = this.token(user)
    const projects = await this.gitlab.listProjects(token, {
      groupId: q.groupId,
      keyword: q.keyword,
    })
    const favs = this.store.getFavorites(user.id)
    let list = projects.map((p) => {
      const last = this.store.lastDeployByProject(p.id)
      return {
        id: p.id,
        gitlabProjectId: p.id,
        name: p.name,
        pathWithNamespace: p.path_with_namespace,
        webUrl: p.web_url,
        groupName: p.namespace?.name ?? '',
        defaultBranch: p.default_branch ?? 'master',
        favorite: favs.has(p.id),
        hasCiConfig: false,
        kind: undefined as string | undefined,
        lastDeploy: last
          ? { env: last.envCode, status: last.status, at: last.startedAt }
          : undefined,
      }
    })
    if (q.onlyFavorite) list = list.filter((p) => p.favorite)

    // 批量检测 .gitlab-ci.yml 是否存在（缓存命中直接返回，未命中分片并发，避免一次打满 GitLab）
    const CHUNK = 10
    for (let i = 0; i < list.length; i += CHUNK) {
      await Promise.all(
        list.slice(i, i + CHUNK).map(async (p) => {
          const [ci, kind] = await Promise.all([
            this.hasCiConfig(token, p.gitlabProjectId, p.defaultBranch, q.fresh),
            this.projectKind(token, p.gitlabProjectId, p.defaultBranch, q.fresh),
          ])
          p.hasCiConfig = ci
          p.kind = kind
        }),
      )
    }
    return { list, total: list.length, page: 1, pageSize: list.length }
  }

  branches(user: SessionUser, projectId: number, keyword?: string) {
    return this.gitlab
      .getBranches(this.token(user), projectId, keyword)
      .then((bs) => bs.map((b) => ({ name: b.name, default: b.default, protected: b.protected })))
  }

  /** 环境配置明细：覆盖配置优先，否则按分支约定推断（管理页与部署面板共用） */
  async envConfigsDetail(
    user: SessionUser,
    projectId: number,
  ): Promise<{ source: 'override' | 'convention'; configs: ProjectEnvConfig[] }> {
    const override = this.store.getEnvConfigs(projectId)
    if (override?.length) return { source: 'override', configs: override }

    const branches = await this.gitlab.getBranches(this.token(user), projectId)
    const branchNames = new Set(branches.map((b) => b.name))
    const minTest = Number(this.config.get('DEPLOY_MIN_ACCESS_TEST') ?? 30)
    const minProd = Number(this.config.get('DEPLOY_MIN_ACCESS_PROD') ?? 40)
    const configs: ProjectEnvConfig[] = ENV_CONVENTION.filter((c) => branchNames.has(c.branch)).map(
      (c) => ({
        envCode: c.envCode,
        name: c.name,
        ref: c.branch,
        strategy: 'manual_job',
        minAccessLevel: c.prod ? minProd : minTest,
      }),
    )
    return { source: 'convention', configs }
  }

  /** 保存环境覆盖配置（管理员） */
  saveEnvConfigs(projectId: number, configs: ProjectEnvConfig[]) {
    if (!Array.isArray(configs) || configs.length === 0)
      throw new BadRequestException('环境配置不能为空，如需恢复默认请用「恢复默认约定」')
    const seen = new Set<string>()
    for (const c of configs) {
      if (!c?.envCode?.trim() || !c?.name?.trim() || !c?.ref?.trim())
        throw new BadRequestException('envCode / name / ref 均不能为空')
      if (!['manual_job', 'create_pipeline'].includes(c.strategy))
        throw new BadRequestException(`非法 strategy：${c.strategy}`)
      if (!Number.isFinite(Number(c.minAccessLevel)))
        throw new BadRequestException('minAccessLevel 必须是数字')
      if (seen.has(c.envCode)) throw new BadRequestException(`环境编码重复：${c.envCode}`)
      seen.add(c.envCode)
    }
    this.store.setEnvConfigs(
      projectId,
      configs.map((c) => ({
        envCode: c.envCode.trim(),
        name: c.name.trim(),
        ref: c.ref.trim(),
        strategy: c.strategy,
        minAccessLevel: Number(c.minAccessLevel),
      })),
    )
    return null
  }

  /** 删除覆盖配置，回到分支约定推断（管理员） */
  resetEnvConfigs(projectId: number) {
    this.store.deleteEnvConfigs(projectId)
    return null
  }

  /** 项目可部署环境：默认按分支推断 + 配置覆盖，并按用户 access_level 标记是否可部署 */
  async environments(user: SessionUser, projectId: number) {
    const token = this.token(user)
    const [detail, project] = await Promise.all([
      this.envConfigsDetail(user, projectId),
      this.gitlab.getProject(token, projectId),
    ])
    const access: number = project?.permissions?.project_access?.access_level
      ?? project?.permissions?.group_access?.access_level ?? 0

    // 去重（同 envCode 取首个）
    const seen = new Set<string>()
    return detail.configs
      .filter((c) => (seen.has(c.envCode) ? false : seen.add(c.envCode)))
      .map((c) => ({
        envCode: c.envCode,
        name: c.name,
        ref: c.ref,
        deployable: access >= c.minAccessLevel,
      }))
  }

  /**
   * AI 生成 / 优化 .gitlab-ci.yml。
   * 汇总「项目类型 + 关键清单文件 + 该分支现有 yml + 环境分支映射」作为上下文，
   * 并在 system 里硬约束部署中心触发模型（入口 build_* 挂 when:manual，deploy_* 靠 needs 级联），
   * 否则生成的 yml「一键部署」会 play 不到正确的入口 job。返回纯 yml（已剥离代码块围栏）。
   */
  async generateCiConfig(
    user: SessionUser,
    projectId: number,
    body: { ref?: string; requirement?: string; model?: string; base?: string },
  ): Promise<{ content: string }> {
    const key = this.ai.resolveKey(user.id)
    const token = this.token(user)
    const project = await this.gitlab.getProject(token, projectId)
    const ref = (body?.ref ?? '').trim() || project.default_branch || 'master'

    const [kind, repoExisting, manifests, envDetail] = await Promise.all([
      this.projectKind(token, projectId, ref).catch(() => undefined),
      this.gitlab.getRawFile(token, projectId, CI_FILE, ref).catch(() => null),
      this.readManifests(token, projectId, ref),
      this.envConfigsDetail(user, projectId).catch(() => ({ source: 'convention' as const, configs: [] })),
    ])

    // 多轮精修：前端把右侧编辑器当前草稿作为 base 传来时，以草稿（而非仓库已提交的 yml）为优化基准，
    // 这样「再加一个 test 阶段」能在上一版结果上继续改，而不是从仓库旧文件重新生成。
    const draft = body?.base?.trim()
    const existing = draft || repoExisting

    const system = this.buildCiGenSystem()
    const userMsg = this.buildCiGenUser({
      project,
      ref,
      kind,
      existing,
      manifests,
      envConfigs: envDetail.configs,
      requirement: body?.requirement?.trim(),
    })
    const text = await this.ai.chatConversation(key, {
      system,
      messages: [{ role: 'user', content: userMsg }],
      model: body?.model,
    })
    return { content: this.stripCodeFence(text) }
  }

  /** 读取某分支上现有的 .gitlab-ci.yml 原文（不存在返回 exists:false），供编辑器加载 */
  async getCiConfig(
    user: SessionUser,
    projectId: number,
    ref?: string,
  ): Promise<{ exists: boolean; content: string; ref: string }> {
    const token = this.token(user)
    const project = await this.gitlab.getProject(token, projectId)
    const branch = (ref ?? '').trim() || project.default_branch || 'master'
    const raw = await this.gitlab.getRawFile(token, projectId, CI_FILE, branch).catch(() => null)
    return { exists: raw != null, content: raw ?? '', ref: branch }
  }

  /** GitLab CI 语法校验（提交前） */
  async lintCiConfig(user: SessionUser, projectId: number, content: string) {
    if (!content?.trim()) throw new BadRequestException('CI 配置内容不能为空')
    return this.gitlab.lintCi(this.token(user), projectId, content)
  }

  /**
   * 提交 .gitlab-ci.yml：
   * - mode='commit'：提交到 targetBranch；若给了 newBranch 则从 targetBranch 建新分支再提交。
   * - mode='merge_request'：从 targetBranch 建 newBranch 提交，并发起 newBranch → targetBranch 的 MR。
   * 文件 create/update 按目标基分支上是否已存在自动判定（解决「已有 yml 也能编辑」）。
   */
  async commitCiConfig(
    user: SessionUser,
    projectId: number,
    body: {
      content: string
      mode?: 'commit' | 'merge_request'
      targetBranch?: string
      newBranch?: string
      commitMessage?: string
      mrTitle?: string
      mrDescription?: string
    },
  ): Promise<{ committedBranch?: string; mergeRequestUrl?: string; fileAction: 'create' | 'update' }> {
    const content = body?.content
    if (!content?.trim()) throw new BadRequestException('CI 配置内容不能为空')
    const token = this.token(user)
    const project = await this.gitlab.getProject(token, projectId)
    const mode = body?.mode === 'merge_request' ? 'merge_request' : 'commit'
    const targetBranch = (body?.targetBranch ?? '').trim() || project.default_branch || 'master'
    const newBranch = (body?.newBranch ?? '').trim()
    const message = (body?.commitMessage ?? '').trim() || 'chore: 配置 .gitlab-ci.yml（部署中心）'

    if (mode === 'merge_request' && !newBranch)
      throw new BadRequestException('合并请求模式必须提供新分支名')

    // 实际写入的分支：MR 模式或显式建分支时用 newBranch，否则直接写 targetBranch
    const writeBranch = newBranch || targetBranch
    // 基分支：仅当 writeBranch 与 targetBranch 不同（即要新建）时传 start_branch
    const startBranch = writeBranch !== targetBranch ? targetBranch : undefined
    // create/update 以「基分支」上文件是否存在判定（新分支继承基分支内容）
    const baseRef = startBranch ?? writeBranch
    const exists = await this.gitlab.repoFileExists(token, projectId, CI_FILE, baseRef).catch(() => false)
    const action: 'create' | 'update' = exists ? 'update' : 'create'

    await this.gitlab.commitFile(token, projectId, {
      branch: writeBranch,
      startBranch,
      message,
      action,
      filePath: CI_FILE,
      content,
    })

    if (mode === 'merge_request') {
      const mr = await this.gitlab.createMergeRequest(token, projectId, {
        source_branch: writeBranch,
        target_branch: targetBranch,
        title: (body?.mrTitle ?? '').trim() || message,
        description: body?.mrDescription,
      })
      // MR 尚未合并，目标分支 CI 状态未变，不动 ciCache
      return { mergeRequestUrl: mr?.web_url, fileAction: action }
    }

    // 直接提交：失效该项目 CI 检测缓存，前端刷新即可见「可部署」
    this.ciCache.delete(projectId)
    return { committedBranch: writeBranch, fileAction: action }
  }

  /** 读取常见构建清单文件（截断），供 AI 判断技术栈与构建命令 */
  private async readManifests(
    token: string,
    projectId: number,
    ref: string,
  ): Promise<{ path: string; text: string }[]> {
    const out: { path: string; text: string }[] = []
    for (const path of CI_MANIFEST_FILES) {
      const raw = await this.gitlab.getRawFile(token, projectId, path, ref).catch(() => null)
      if (raw) out.push({ path, text: raw.slice(0, CI_MANIFEST_CHARS) })
    }
    return out
  }

  /** 剥离模型输出里的 ```yaml ... ``` 围栏，返回纯 yml */
  private stripCodeFence(text: string): string {
    const fence = text.match(/```(?:ya?ml)?\s*\n([\s\S]*?)\n```/i)
    return (fence ? fence[1] : text).trim()
  }

  private buildCiGenSystem(): string {
    return [
      '你是 GitLab CI/CD 配置专家，为「部署中心」生成或优化 .gitlab-ci.yml。',
      '',
      '【部署中心触发模型（务必遵守）】',
      '1. 入口构建 job 命名为 build_<服务名>（单服务可用 build），stage=build，且必须挂 `when: manual`；',
      '2. 部署 job 命名为 deploy_<服务名>（单服务可用 deploy），stage=deploy，通过 `needs: [build_<服务名>]` 自动级联，不要给 deploy job 加 when: manual；',
      '3. 部署中心「一键部署」= 创建流水线后 play 入口 build_* 手动 job，其余靠 needs 自动跑。若把 manual 挂在 deploy 上会导致级联断裂。',
      '',
      '【输出要求】',
      '- 只输出最终 .gitlab-ci.yml 的纯文本内容，不要任何解释、不要 markdown 代码块围栏；',
      '- 内容必须是合法 YAML，可被 GitLab 解析；',
      '- 根据技术栈给出可用的 stages、构建与部署脚本占位（构建命令尽量贴合识别到的框架）；',
      '- 若已存在 yml，则在其基础上优化/修正，保留用户原有的合理配置，不要凭空大改；',
      '- 用户会用一段自由文本描述构建/部署信息（如 node/pnpm 版本、部署路径、端口、服务器 IP、环境分支等），请从中解析并在 yml 中实际采用这些值，不要留占位 TODO。',
    ].join('\n')
  }

  private buildCiGenUser(ctx: {
    project: any
    ref: string
    kind?: string
    existing: string | null
    manifests: { path: string; text: string }[]
    envConfigs: ProjectEnvConfig[]
    requirement?: string
  }): string {
    const envText = ctx.envConfigs.length
      ? ctx.envConfigs.map((c) => `${c.name}(${c.envCode}) → 分支 ${c.ref}`).join('；')
      : '（未配置，按分支约定：develop=测试 / master|main=生产）'
    const manifestBlocks = ctx.manifests
      .map((m) => `<file path="${m.path}">\n${m.text}\n</file>`)
      .join('\n\n')
    return [
      `项目名称：${ctx.project.name}`,
      `仓库路径：${ctx.project.path_with_namespace ?? ''}`,
      `当前分支：${ctx.ref}`,
      `识别到的技术栈：${ctx.kind ?? '未识别'}`,
      `环境与分支映射：${envText}`,
      ctx.requirement ? `\n用户描述（请从中解析构建/部署信息并采用）：${ctx.requirement}` : '',
      '',
      ctx.existing ? '现有 .gitlab-ci.yml（请在此基础上优化）：' : '（仓库当前没有 .gitlab-ci.yml，请新建）',
      ctx.existing ? `<file path=".gitlab-ci.yml">\n${ctx.existing.slice(0, CI_MANIFEST_CHARS * 2)}\n</file>` : '',
      '',
      ctx.manifests.length ? '构建清单文件（用于判断技术栈与构建命令）：' : '',
      manifestBlocks,
      '',
      '请输出最终的 .gitlab-ci.yml 纯文本内容：',
    ]
      .filter(Boolean)
      .join('\n')
  }

  toggleFavorite(user: SessionUser, projectId: number, on: boolean) {
    this.store.toggleFavorite(user.id, projectId, on)
    return null
  }

  // ---- 仓库代码问答（AI）----

  /**
   * 针对单个项目仓库代码的问答（Agent 工具循环）：
   * 给模型 list_repo_files / read_file / grep 三件工具，让它自己浏览、检索、读全文，
   * 「读够为止」而非按固定文件数封顶——真正的全文阅读。
   * 同时：① 注入该项目的长期记忆；② 把问答落盘成会话历史；③ 问答后增量更新项目记忆。
   */
  async chat(
    user: SessionUser,
    projectId: number,
    body: { conversationId?: number; question?: string; messages?: ChatTurn[]; model?: string; ref?: string },
  ): Promise<{ conversationId: number; title: string; answer: string; usedFiles: string[]; ref: string }> {
    const model = body?.model
    // 问题来源：优先显式 question，兼容旧版传 messages（取最后一条 user）
    const question = (
      body?.question ??
      [...(body?.messages ?? [])].reverse().find((m) => m?.role === 'user')?.content ??
      ''
    ).trim()
    if (!question) throw new BadRequestException('请输入要咨询的问题')
    if (question.length > 8000) throw new BadRequestException('单条问题过长，请精简到 8000 字以内')

    // 解析会话（续聊则校验归属，历史以服务端落盘为准）
    let conv = body?.conversationId ? this.store.getConversation(body.conversationId) : undefined
    if (conv && conv.userId !== user.id) throw new ForbiddenException('无权访问该会话')

    const key = this.ai.resolveKey(user.id)
    const token = this.token(user)
    const project = await this.gitlab.getProject(token, projectId)
    // 分支优先级：本次显式指定 > 会话原分支 > 仓库默认分支
    const ref = (body?.ref ?? '').trim() || conv?.ref || project.default_branch || 'master'

    const tree = await this.gitlab.listRepoTree(token, projectId, ref).catch(() => [])
    const files = tree.map((t) => t.path).filter((p) => !isIgnoredPath(p))

    // 工具共享的文件内容缓存：read_file 与 grep 复用，避免重复打 GitLab
    const fileCache = new Map<string, string | null>()
    const readRaw = async (path: string): Promise<string | null> => {
      if (fileCache.has(path)) return fileCache.get(path)!
      const raw = await this.gitlab.getRawFile(token, projectId, path, ref).catch(() => null)
      fileCache.set(path, raw)
      return raw
    }
    const onTool = (name: string, input: Record<string, unknown>) =>
      runRepoTool(name, input, files, readRaw)

    const memory = this.store.getProjectMemory(user.id, projectId)
    const system = this.buildAgentSystem(project, ref, files, memory?.summary)
    // 历史以服务端会话为准，只取最近若干轮控制 token
    const priorTurns: ChatTurn[] = (conv?.messages ?? [])
      .slice(-CHAT_HISTORY_TURNS)
      .map((m) => ({ role: m.role, content: m.content }))

    const result = await this.ai.chatAgent(key, {
      system,
      messages: [...priorTurns, { role: 'user', content: question }],
      tools: REPO_TOOLS,
      model,
      maxIterations: AGENT_MAX_ITERATIONS,
      onTool,
    })
    const answer = result.text || '（模型未返回文本回答，请重试或换一个问题）'
    // 实际读过的文件（去重，按首次出现顺序），用于前端「参考文件」展示
    const usedFiles = [
      ...new Set(
        result.toolCalls
          .filter((c) => c.name === 'read_file' && typeof c.input.path === 'string')
          .map((c) => String(c.input.path)),
      ),
    ]

    // 落盘会话历史
    const now = Date.now()
    if (!conv) {
      conv = this.store.createConversation({
        userId: user.id,
        gitlabProjectId: projectId,
        projectName: project.name,
        title: this.deriveTitle(question),
        ref,
        model,
        messages: [],
        createdAt: now,
        updatedAt: now,
      })
    }
    const messages = [
      ...conv.messages,
      { role: 'user' as const, content: question, ts: now },
      { role: 'assistant' as const, content: answer, usedFiles, ts: Date.now() },
    ]
    this.store.updateConversation(conv.id, { messages, ref, model })

    // 异步增量更新项目长期记忆（best-effort，不阻塞本次回答）
    void this.updateProjectMemory(key, user.id, projectId, project, messages, memory?.summary, model).catch(
      (e) => this.logger.warn(`更新项目记忆失败：${(e as Error).message}`),
    )

    return { conversationId: conv.id, title: conv.title, answer, usedFiles, ref }
  }

  // ---- 会话历史 CRUD（按 用户+项目 私有） ----
  listConversations(user: SessionUser, projectId: number) {
    return this.store.listConversations(user.id, projectId)
  }
  getConversation(user: SessionUser, id: number) {
    const conv = this.store.getConversation(id)
    if (!conv || conv.userId !== user.id) throw new ForbiddenException('无权访问该会话')
    return conv
  }
  renameConversation(user: SessionUser, id: number, title: string) {
    this.getConversation(user, id)
    const t = (title ?? '').trim().slice(0, 60)
    if (!t) throw new BadRequestException('标题不能为空')
    this.store.updateConversation(id, { title: t })
    return null
  }
  deleteConversation(user: SessionUser, id: number) {
    this.getConversation(user, id)
    this.store.deleteConversation(id)
    return null
  }

  /** 用首个问题生成会话标题 */
  private deriveTitle(question: string): string {
    const t = question.replace(/\s+/g, ' ').trim()
    return t.length > 24 ? t.slice(0, 24) + '…' : t
  }

  /** 拼装 Agent 工具循环的 system 提示（含项目信息、目录概览、注入的长期记忆） */
  private buildAgentSystem(project: any, ref: string, allFiles: string[], memory?: string): string {
    const treeText = allFiles.slice(0, AGENT_TREE_PREVIEW).join('\n')
    const treeNote =
      allFiles.length > AGENT_TREE_PREVIEW
        ? `\n（仅预览前 ${AGENT_TREE_PREVIEW} 个，共 ${allFiles.length} 个；完整清单请用 list_repo_files）`
        : ''
    return [
      '你是一名资深工程师，专门回答关于「当前 GitLab 项目仓库代码」的问题。',
      '你可以调用以下工具浏览和读取仓库（按需多次调用，不要怕多读）：',
      '- list_repo_files(glob?)：列出/按子串筛选仓库文件路径；',
      '- read_file(path)：读取某个文件的完整内容；',
      '- grep(query, path_glob?)：在仓库里全文检索关键词，定位代码所在文件与行号。',
      '工作方式：先用 grep / list_repo_files 定位相关文件，再用 read_file 读全文；需要读多少文件就读多少，读全读透后再作答。',
      '回答要求：',
      '1. 只依据实际读到的代码作答，引用时标明文件路径，必要时给出关键代码片段；',
      '2. 没读到足够信息时，继续调用工具去读，不要凭空编造不存在的代码；',
      '3. 用简洁的中文回答。',
      '',
      `项目名称：${project.name}`,
      `仓库路径：${project.path_with_namespace ?? ''}`,
      `当前分支：${ref}`,
      project.description ? `项目描述：${project.description}` : '',
      memory ? `\n关于本项目你在历史对话中已积累的记忆（可作为背景参考，但仍以本次实际读到的代码为准）：\n${memory}` : '',
      '',
      '仓库目录结构预览：',
      treeText + treeNote,
    ]
      .filter(Boolean)
      .join('\n')
  }

  /**
   * 增量更新项目长期记忆：把「旧记忆 + 最近一轮问答」交给模型，重写出一份精炼的项目要点。
   * 让模型只输出纯文本要点，控制长度；失败不影响主流程。
   */
  private async updateProjectMemory(
    key: string,
    userId: number,
    projectId: number,
    project: any,
    messages: { role: 'user' | 'assistant'; content: string }[],
    oldMemory: string | undefined,
    model?: string,
  ): Promise<void> {
    const recent = messages
      .slice(-2)
      .map((m) => `${m.role === 'user' ? '问' : '答'}：${m.content.slice(0, 2000)}`)
      .join('\n')
    const system =
      '你负责维护某个代码项目的「长期记忆」：用要点形式记录该项目稳定、可复用的事实' +
      '（技术栈、目录与模块职责、入口与启动方式、关键实现位置、部署方式等）。' +
      `根据已有记忆和最新一轮问答，输出更新后的完整记忆，纯文本要点、不超过 ${MEMORY_MAX_CHARS} 字，` +
      '不要输出解释或代码块标记，不要记录与具体项目无关的闲聊。'
    const user = `项目：${project.name}\n\n已有记忆：\n${oldMemory || '（暂无）'}\n\n最新一轮问答：\n${recent}\n\n请输出更新后的完整项目记忆：`
    const text = await this.ai.chatConversation(key, {
      system,
      messages: [{ role: 'user', content: user }],
      model,
      maxTokens: 2048,
    })
    const summary = text.trim().slice(0, MEMORY_MAX_CHARS)
    if (summary) this.store.setProjectMemory(userId, projectId, summary)
  }
}

// ---- 代码问答（Agent 工具循环）预算规则 ----
// 用「最大迭代轮数」控预算，而非固定文件数；模型可按需多读，逼近全文阅读。
// 仓库工具集（REPO_TOOLS）与单次工具结果上限已下沉到 core/ci/repo-tools，与失败诊断共享。
const AGENT_MAX_ITERATIONS = 24 // 工具循环最多轮数（够读几十个文件 + 多次检索）
const AGENT_TREE_PREVIEW = 400 // system 里目录预览条数（完整清单走 list_repo_files）
const MEMORY_MAX_CHARS = 4_000 // 项目长期记忆摘要字符上限
const CHAT_HISTORY_TURNS = 12

// CI 生成时读取的清单文件（判断技术栈/构建命令），及单文件截断长度
const CI_MANIFEST_FILES = ['package.json', 'pom.xml', 'build.gradle', 'go.mod', 'requirements.txt', 'pyproject.toml', 'Dockerfile', 'Makefile']
const CI_MANIFEST_CHARS = 4_000
