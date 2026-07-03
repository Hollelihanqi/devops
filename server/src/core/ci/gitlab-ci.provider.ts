import { Injectable } from '@nestjs/common'
import { GitlabService } from '../gitlab.service'
import type { CiAuth, CiBuildRef, CiJobLog, CiProvider, CiProjectMeta } from './ci-provider.interface'

/**
 * 清洗 GitLab job trace：剥离 ANSI 颜色/控制码与 section 标记，
 * 否则前端 <pre> / 模型上下文会混入 \x1b[0K、\x1b[36;1m 等乱码。
 * （原在 DeploymentsService，随日志获取下沉到供应商实现层。）
 */
export function cleanTrace(raw: string): string {
  if (!raw) return ''
  return raw
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '') // CSI 序列：颜色 \x1b[36;1m、清行 \x1b[0K 等
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b[<>=]/g, '')
    .replace(/section_(?:start|end):\d+:[^\r\n]*\r?/g, '') // GitLab 折叠区段标记
    .replace(/\r(?!\n)/g, '\n') // 裸 \r 改成换行，避免覆盖式输出错乱
}

/**
 * GitLab 实现 CiProvider：薄封装，转调已有 GitlabService 方法，不重写 GitLab 逻辑。
 * projectId 统一为 string（GitLab 数字 id 转 string）；CiBuildRef.pipelineId 即 GitLab pipeline id。
 */
@Injectable()
export class GitlabCiProvider implements CiProvider {
  readonly kind = 'gitlab' as const

  constructor(private readonly gitlab: GitlabService) {}

  private pid(projectId: string): number {
    return Number(projectId)
  }

  async getProject(ctx: CiAuth, projectId: string): Promise<CiProjectMeta> {
    const p = await this.gitlab.getProject(ctx.token, this.pid(projectId))
    return {
      id: p.id,
      name: p.name,
      pathWithNamespace: p.path_with_namespace,
      defaultBranch: p.default_branch,
      webUrl: p.web_url,
      description: p.description,
    }
  }

  async listRepoTree(ctx: CiAuth, projectId: string, ref: string): Promise<string[]> {
    const tree = await this.gitlab.listRepoTree(ctx.token, this.pid(projectId), ref)
    return tree.map((t) => t.path)
  }

  getRawFile(ctx: CiAuth, projectId: string, path: string, ref: string): Promise<string | null> {
    return this.gitlab.getRawFile(ctx.token, this.pid(projectId), path, ref)
  }

  /**
   * 取一次流水线下各 job 的清洗日志（按 job id 升序≈stage 顺序）。
   * 跳过未真正运行的 job（created/manual/skipped），与原 DeploymentsService.logs 行为一致。
   */
  async getBuildLogs(ctx: CiAuth, projectId: string, ref: CiBuildRef): Promise<CiJobLog[]> {
    const pid = this.pid(projectId)
    const pipelineId = Number(ref.pipelineId)
    if (!Number.isFinite(pipelineId)) return []
    const jobs = await this.gitlab.listPipelineJobs(ctx.token, pid, pipelineId)
    const ordered = [...jobs].sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
    const out: CiJobLog[] = []
    for (const j of ordered) {
      if (j.status === 'created' || j.status === 'manual' || j.status === 'skipped') continue
      const raw = await this.gitlab.getJobTrace(ctx.token, pid, j.id).catch(() => '')
      const trace = cleanTrace(raw)
      if (trace) out.push({ stage: j.stage, name: j.name, status: j.status, trace })
    }
    return out
  }
}
