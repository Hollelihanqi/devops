import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { GitlabService } from '../core/gitlab.service'
import { StoreService } from '../core/store.service'
import { FeishuService } from '../core/feishu.service'
import { ProjectsService } from '../projects/projects.service'
import { AiService } from '../prompts/ai.service'
import {
  CI_PROVIDER,
  type CiAuth,
  type CiJobLog,
  type CiProjectMeta,
  type CiProvider,
} from '../core/ci/ci-provider.interface'
import { REPO_TOOLS, runRepoTool, isIgnoredPath } from '../core/ci/repo-tools'
import type { Deployment, DeployDiagnosis, DeployStatus, SessionUser } from '../common/types'

interface CreatePayload {
  projectId: number
  env: string
  ref?: string
  variables?: Record<string, string>
  note?: string
}

// ---- AI 失败诊断预算（成本控制：尾部日志 + 较小迭代 + 结果缓存）----
const DIAGNOSE_LOG_TAIL = 15_000 // 喂给模型的失败日志尾部字符数（报错通常在末尾）
const DIAGNOSE_MAX_ITERATIONS = 12 // 工具循环上限，比代码问答更小，控制烧 token

const DIAGNOSE_SYSTEM = [
  '你是资深 CI/CD 排障专家。请依据「失败流水线日志 + 仓库代码」定位本次部署失败的根因，并给出可执行的修复建议。',
  '你可以调用工具浏览 / 读取仓库代码（list_repo_files / read_file / grep）：',
  '从日志里的报错信息、文件名、行号、失败命令出发，用 grep / read_file 去仓库里核对真实代码与配置',
  '（如 .gitlab-ci.yml、依赖清单、报错涉及的源码），不要凭空猜测；读够相关文件再下结论。',
  '',
  '完成后，只输出一个 JSON 对象（不要任何额外文字、不要 markdown 代码块围栏），结构如下：',
  '{"rootCause":"一句话根因","analysis":"详细分析：日志关键报错 + 结合代码的解释","suggestion":"具体修复建议，可含代码片段","files":["涉及的真实仓库文件路径"]}',
  'files 只填你确实读过 / 确认相关的真实仓库路径；没有则给空数组。',
].join('\n')

@Injectable()
export class DeploymentsService {
  constructor(
    private readonly gitlab: GitlabService,
    private readonly store: StoreService,
    private readonly projects: ProjectsService,
    private readonly ai: AiService,
    private readonly feishu: FeishuService,
    @Inject(CI_PROVIDER) private readonly ci: CiProvider,
  ) {}

  private token(user: SessionUser): string {
    const t = this.store.getToken(user.id)
    if (!t) throw new UnauthorizedException('GitLab 授权已失效，请重新登录')
    return t
  }

  private mapStatus(s: string): DeployStatus {
    if (s === 'success') return 'success'
    if (s === 'failed') return 'failed'
    if (s === 'canceled' || s === 'skipped') return 'canceled'
    if (s === 'running') return 'running'
    return 'pending'
  }

  private static readonly TERMINAL: DeployStatus[] = ['success', 'failed', 'canceled']
  private isTerminal(s: DeployStatus) {
    return DeploymentsService.TERMINAL.includes(s)
  }

  /**
   * 由 pipeline job 状态推导 0-100 进度：终态 job 计满分、进行中 job 计半分，
   * 流水线整体未结束前封顶 99%，避免提前显示 100%。
   */
  private jobProgress(jobs: any[], pipelineStatus: string): number {
    if (['success', 'failed', 'canceled', 'skipped'].includes(pipelineStatus)) return 100
    if (!jobs.length) return 0
    let credit = 0
    for (const j of jobs) {
      if (['success', 'failed', 'canceled', 'skipped'].includes(j.status)) credit += 1
      else if (['running', 'pending', 'preparing', 'waiting_for_resource', 'scheduled'].includes(j.status))
        credit += 0.5
    }
    return Math.min(Math.round((credit / jobs.length) * 100), 99)
  }

  /**
   * 从 GitLab 拉取最新 pipeline + jobs，回写状态/完成时间，并附加实时进度。
   * detail 与 list 共用：未结束的记录才打 GitLab，终态直接返回。
   */
  private async refresh(token: string, dep: Deployment): Promise<Deployment> {
    if (!dep.gitlabPipelineId) return { ...dep, progress: 0 }
    if (this.isTerminal(dep.status)) return { ...dep, progress: 100 }

    const [pipeline, jobs] = await Promise.all([
      this.gitlab.getPipeline(token, dep.gitlabProjectId, dep.gitlabPipelineId),
      this.gitlab.listPipelineJobs(token, dep.gitlabProjectId, dep.gitlabPipelineId),
    ])
    const status = this.mapStatus(pipeline.status)
    const patch: Partial<Deployment> = { status }
    if (this.isTerminal(status)) {
      patch.finishedAt = new Date().toISOString()
      patch.durationSec = pipeline.duration ?? undefined
      if (status === 'failed') patch.failReason = `流水线 #${pipeline.id} 执行失败`
    }
    this.store.updateDeployment(dep.id, patch)
    // 部署刚进入终态（成功/失败/取消）时发一次飞书通知；refresh 入口已保证旧状态非终态，故这里即首次进入终态
    if (this.isTerminal(status)) {
      this.feishu.notifyDeployment(this.store.getDeployment(dep.id)!).catch(() => {})
    }
    return { ...this.store.getDeployment(dep.id)!, progress: this.jobProgress(jobs, pipeline.status) }
  }

  /**
   * 触发部署（策略 C，见需求文档 §8.3/§8.5）：
   * 在目标分支创建 pipeline → 找到入口 manual job（build_*）→ play → deploy 自动级联。
   */
  async create(user: SessionUser, payload: CreatePayload): Promise<Deployment> {
    const token = this.token(user)
    const envs = await this.projects.environments(user, payload.projectId)
    const env = envs.find((e) => e.envCode === payload.env)
    if (!env) throw new NotFoundException('该项目未配置此环境')
    if (!env.deployable) throw new ForbiddenException('无权限部署到该环境')

    const ref = payload.ref || env.ref
    const project = await this.gitlab.getProject(token, payload.projectId)

    // 1. 创建流水线
    const pipeline = await this.gitlab.createPipeline(token, payload.projectId, ref, payload.variables)

    // 2. 找到入口手动 job（优先 stage=build / 名称 build_*）
    const jobs = await this.gitlab.listPipelineJobs(token, payload.projectId, pipeline.id)
    const manualJobs = jobs.filter((j) => j.status === 'manual')
    const entry =
      manualJobs.find((j) => j.stage === 'build') ||
      manualJobs.find((j) => /^build/i.test(j.name)) ||
      manualJobs.find((j) => /^deploy/i.test(j.name)) ||
      manualJobs[0]

    let jobId: number | undefined
    if (entry) {
      const played = await this.gitlab.playJob(token, payload.projectId, entry.id)
      jobId = played.id
    }
    // 若无 manual job，则流水线自动执行（方案 A 兜底），无需 play

    // 3. 落库
    return this.store.createDeployment({
      gitlabProjectId: payload.projectId,
      projectName: project.name,
      projectWebUrl: project.web_url,
      ref,
      envCode: env.envCode,
      status: 'running',
      gitlabPipelineId: pipeline.id,
      gitlabJobId: jobId,
      triggeredByUserId: user.id,
      triggeredByName: user.name,
      note: payload.note,
      startedAt: new Date().toISOString(),
    })
  }

  /** 详情：实时刷新 pipeline 状态并回写，附带实时进度 */
  async detail(user: SessionUser, id: number): Promise<Deployment> {
    const dep = this.store.getDeployment(id)
    if (!dep) throw new NotFoundException('部署记录不存在')
    if (!dep.gitlabPipelineId || this.isTerminal(dep.status)) {
      return { ...dep, progress: dep.gitlabPipelineId ? 100 : 0 }
    }
    return this.refresh(this.token(user), dep)
  }

  /**
   * 取某次部署各 job 的清洗日志（按 stage/job 顺序），供日志查看与失败诊断复用。
   * 走 CiProvider 抽象——具体的 trace 清洗与 job 过滤在供应商实现里（见开发文档 §3.5）。
   */
  private getCleanedJobLogs(token: string, dep: Deployment): Promise<CiJobLog[]> {
    return this.ci.getBuildLogs({ token }, String(dep.gitlabProjectId), {
      pipelineId: dep.gitlabPipelineId,
      jobId: dep.gitlabJobId,
    })
  }

  /** 增量日志：拼接 build + deploy 等 job 的 trace，按 offset 切片 */
  async logs(user: SessionUser, id: number, offset = 0) {
    const dep = this.store.getDeployment(id)
    if (!dep || !dep.gitlabPipelineId) throw new NotFoundException('部署记录不存在')
    const token = this.token(user)
    const jobLogs = await this.getCleanedJobLogs(token, dep)
    let full = ''
    for (const j of jobLogs) full += `\n===== ${j.stage} · ${j.name} (${j.status}) =====\n${j.trace}`
    const content = full.slice(offset)
    const pipeline = await this.gitlab.getPipeline(token, dep.gitlabProjectId, dep.gitlabPipelineId)
    const finished = ['success', 'failed', 'canceled', 'skipped'].includes(pipeline.status)
    return { content, nextOffset: full.length, finished }
  }

  async cancel(user: SessionUser, id: number) {
    const dep = this.store.getDeployment(id)
    if (!dep || !dep.gitlabPipelineId) throw new NotFoundException('部署记录不存在')
    // 仅部署发起人（或管理员）可取消，避免他人误取消进行中的部署
    if (dep.triggeredByUserId !== user.id && !user.isAdmin)
      throw new ForbiddenException('只有部署发起人可以取消该部署')
    await this.gitlab.cancelPipeline(this.token(user), dep.gitlabProjectId, dep.gitlabPipelineId)
    this.store.updateDeployment(id, { status: 'canceled', finishedAt: new Date().toISOString() })
    return null
  }

  /**
   * 列表：未结束的记录并发刷新 GitLab 状态并附带实时进度，终态直接返回。
   * 进行中记录数通常很少（内部工具单实例），并发拉取可接受；
   * GitLab 异常或无 token 时回退近似值，保证列表始终可返回。
   */
  async list(user: SessionUser, filter: { projectId?: number; status?: string }) {
    const stored = this.store.listDeployments(filter)
    const token = this.store.getToken(user.id)
    const list = await Promise.all(
      stored.map(async (dep) => {
        if (!dep.gitlabPipelineId || this.isTerminal(dep.status)) {
          return { ...dep, progress: dep.gitlabPipelineId ? 100 : 0 }
        }
        if (!token) return { ...dep, progress: 60 }
        try {
          return await this.refresh(token, dep)
        } catch {
          return { ...dep, progress: 60 } // GitLab 抖动：保留近似值，下一轮重试
        }
      }),
    )
    return { list, total: list.length, page: 1, pageSize: list.length }
  }

  // ---- AI 部署失败诊断（见开发文档 §3）----

  /**
   * 触发 / 重新诊断：取失败流水线尾部日志作锚点 + 工具循环按需读仓库代码，
   * 让模型给出「根因 + 详细分析 + 修复建议 + 涉及文件」，结果落盘缓存。
   * 仅依赖 CiProvider 抽象（不直接读 GitLab），为 Jenkins 留口子。
   */
  async diagnose(user: SessionUser, id: number, model?: string): Promise<DeployDiagnosis> {
    const dep = this.store.getDeployment(id)
    if (!dep) throw new NotFoundException('部署记录不存在')
    if (dep.status !== 'failed') throw new BadRequestException('仅失败的部署可以诊断')
    if (dep.triggeredByUserId !== user.id && !user.isAdmin)
      throw new ForbiddenException('只有部署发起人可以诊断该部署')
    if (!dep.gitlabPipelineId) throw new BadRequestException('该部署没有关联的流水线，无法诊断')

    const token = this.token(user)
    const key = this.ai.resolveKey(user.id)
    const ctx: CiAuth = { token }
    const pid = String(dep.gitlabProjectId)

    // 1. 失败 job 清洗日志 → 截取尾部作锚点（报错通常在末尾）
    const jobLogs = await this.getCleanedJobLogs(token, dep)
    const failed = jobLogs.filter((j) => j.status === 'failed')
    const focus = failed.length ? failed : jobLogs
    const logText = focus
      .map((j) => `===== ${j.stage} · ${j.name} (${j.status}) =====\n${j.trace}`)
      .join('\n')
    const tail = logText.length > DIAGNOSE_LOG_TAIL ? logText.slice(-DIAGNOSE_LOG_TAIL) : logText

    // 2. 项目信息 + 仓库文件清单（供工具按需读相关代码）
    const project = await this.ci.getProject(ctx, pid)
    const codeRef = dep.ref
    const tree = await this.ci.listRepoTree(ctx, pid, codeRef).catch(() => [])
    const files = tree.filter((p) => !isIgnoredPath(p))

    const fileCache = new Map<string, string | null>()
    const readRaw = async (path: string): Promise<string | null> => {
      if (fileCache.has(path)) return fileCache.get(path)!
      const raw = await this.ci.getRawFile(ctx, pid, path, codeRef).catch(() => null)
      fileCache.set(path, raw)
      return raw
    }
    const onTool = (name: string, input: Record<string, unknown>) =>
      runRepoTool(name, input, files, readRaw)

    // 3. 工具循环诊断
    const result = await this.ai.chatAgent(key, {
      system: DIAGNOSE_SYSTEM,
      messages: [{ role: 'user', content: this.buildDiagnoseUser(project, dep, tail || '（未取到失败日志）') }],
      tools: REPO_TOOLS,
      model,
      maxIterations: DIAGNOSE_MAX_ITERATIONS,
      onTool,
    })

    // 4. 解析为结构化诊断并落盘缓存
    const diagnosis = this.parseDiagnosis(result.text, this.ai.resolveModel(model))
    this.store.setDiagnosis(id, diagnosis)
    return diagnosis
  }

  /** 取已缓存的诊断（无则 null），供前端重开时直接展示，不重复烧 token */
  getDiagnosis(user: SessionUser, id: number): DeployDiagnosis | null {
    const dep = this.store.getDeployment(id)
    if (!dep) throw new NotFoundException('部署记录不存在')
    if (dep.triggeredByUserId !== user.id && !user.isAdmin)
      throw new ForbiddenException('无权查看该部署的诊断')
    return dep.diagnosis ?? null
  }

  private buildDiagnoseUser(project: CiProjectMeta, dep: Deployment, tail: string): string {
    return [
      `项目名称：${project.name}`,
      `仓库路径：${project.pathWithNamespace ?? ''}`,
      `部署环境：${dep.envCode}`,
      `部署分支：${dep.ref}`,
      `流水线：#${dep.gitlabPipelineId ?? '-'}`,
      '',
      '失败流水线日志（尾部片段，报错通常在末尾）：',
      '<logs>',
      tail,
      '</logs>',
      '',
      '请结合上面的失败日志，按需读取仓库相关代码定位根因，最后只输出约定的 JSON。',
    ].join('\n')
  }

  /** 把模型输出解析为结构化诊断；非 JSON 时整段文本兜底放入 analysis，保证仍有可读结果 */
  private parseDiagnosis(text: string, model?: string): DeployDiagnosis {
    const now = Date.now()
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        const raw = JSON.parse(text.slice(start, end + 1)) as Partial<DeployDiagnosis>
        if (raw.rootCause || raw.analysis || raw.suggestion) {
          return {
            rootCause: String(raw.rootCause ?? '').trim() || '（未明确给出根因，详见分析）',
            analysis: String(raw.analysis ?? '').trim(),
            suggestion: String(raw.suggestion ?? '').trim(),
            files: Array.isArray(raw.files) ? raw.files.map(String).filter(Boolean).slice(0, 20) : [],
            model,
            createdAt: now,
          }
        }
      } catch {
        // 落到下面的纯文本兜底
      }
    }
    return {
      rootCause: '（模型未按结构化格式返回，详见分析）',
      analysis: text.trim() || '（模型未返回内容，请重试）',
      suggestion: '',
      files: [],
      model,
      createdAt: now,
    }
  }
}
