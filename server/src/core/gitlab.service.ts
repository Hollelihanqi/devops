import { Injectable, BadGatewayException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import axios, { AxiosInstance } from 'axios'

/** GitLab REST API v4 封装。所有业务调用以「用户 token」发起，权限天然继承。 */
@Injectable()
export class GitlabService {
  constructor(private readonly config: ConfigService) {}

  private get baseUrl() {
    return this.config.get<string>('GITLAB_URL')!.replace(/\/$/, '')
  }

  private client(token: string): AxiosInstance {
    return axios.create({
      baseURL: `${this.baseUrl}/api/v4`,
      headers: { Authorization: `Bearer ${token}` },
      timeout: 20_000,
    })
  }

  private async call<T>(p: Promise<{ data: T }>): Promise<T> {
    try {
      return (await p).data
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || 'GitLab 请求失败'
      throw new BadGatewayException(`GitLab: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`)
    }
  }

  // ---------- 用户 ----------
  getUser(token: string) {
    return this.call<any>(this.client(token).get('/user'))
  }

  // ---------- 分组 / 项目 ----------
  listGroups(token: string) {
    return this.call<any[]>(
      this.client(token).get('/groups', { params: { per_page: 100, order_by: 'name', sort: 'asc' } }),
    )
  }

  listProjects(token: string, opts: { groupId?: number; keyword?: string }) {
    if (opts.groupId) {
      return this.call<any[]>(
        this.client(token).get(`/groups/${opts.groupId}/projects`, {
          params: { include_subgroups: true, simple: true, search: opts.keyword, per_page: 100, order_by: 'last_activity_at' },
        }),
      )
    }
    return this.call<any[]>(
      this.client(token).get('/projects', {
        params: { membership: true, simple: true, search: opts.keyword, per_page: 100, order_by: 'last_activity_at' },
      }),
    )
  }

  getProject(token: string, projectId: number) {
    return this.call<any>(this.client(token).get(`/projects/${projectId}`))
  }

  /** 仓库语言占比（按默认分支 HEAD 统计）：如 { Vue: 60.2, JavaScript: 39.8 } */
  getLanguages(token: string, projectId: number) {
    return this.call<Record<string, number>>(
      this.client(token).get(`/projects/${projectId}/languages`),
    )
  }

  // ---------- 仓库文件 ----------
  /** 判断仓库某文件是否存在（404 → false，其余错误照常抛出） */
  async repoFileExists(token: string, projectId: number, filePath: string, ref: string): Promise<boolean> {
    try {
      await this.client(token).head(
        `/projects/${projectId}/repository/files/${encodeURIComponent(filePath)}`,
        { params: { ref } },
      )
      return true
    } catch (e: any) {
      if (e?.response?.status === 404) return false
      const msg = e?.response?.data?.message || e?.message || 'GitLab 请求失败'
      throw new BadGatewayException(`GitLab: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`)
    }
  }

  createRepoFile(
    token: string,
    projectId: number,
    filePath: string,
    body: { branch: string; content: string; commit_message: string },
  ) {
    return this.call<any>(
      this.client(token).post(
        `/projects/${projectId}/repository/files/${encodeURIComponent(filePath)}`,
        body,
      ),
    )
  }

  /**
   * 用 Commits API 在一次提交里创建/更新文件，并可借 start_branch 从基分支「顺手」建出目标分支。
   * 比「先建分支再写文件」少一次往返、且原子。action 由调用方按文件是否已存在传 create/update。
   */
  commitFile(
    token: string,
    projectId: number,
    body: {
      branch: string
      startBranch?: string
      message: string
      action: 'create' | 'update'
      filePath: string
      content: string
    },
  ) {
    const payload: any = {
      branch: body.branch,
      commit_message: body.message,
      actions: [{ action: body.action, file_path: body.filePath, content: body.content }],
    }
    // start_branch 仅在目标分支尚不存在、需要从基分支新建时传
    if (body.startBranch) payload.start_branch = body.startBranch
    return this.call<any>(
      this.client(token).post(`/projects/${projectId}/repository/commits`, payload),
    )
  }

  createMergeRequest(
    token: string,
    projectId: number,
    body: { source_branch: string; target_branch: string; title: string; description?: string },
  ) {
    return this.call<any>(
      this.client(token).post(`/projects/${projectId}/merge_requests`, {
        source_branch: body.source_branch,
        target_branch: body.target_branch,
        title: body.title,
        description: body.description,
        remove_source_branch: true,
      }),
    )
  }

  /** GitLab CI 语法校验（按项目上下文，能识别 include/变量）。失败时返回 valid:false 而非抛错。 */
  lintCi(token: string, projectId: number, content: string) {
    return this.call<{ valid: boolean; errors: string[]; warnings: string[] }>(
      this.client(token).post(`/projects/${projectId}/ci/lint`, { content }),
    )
  }

  /**
   * 递归列出仓库文件树（仅返回 blob，即文件，不含目录）。
   * GitLab 树接口是偏移分页，逐页拉取直到返回不足一页或达到上限，避免大仓库拖垮请求。
   */
  async listRepoTree(
    token: string,
    projectId: number,
    ref: string,
    maxFiles = 2000,
  ): Promise<{ path: string; type: string }[]> {
    const client = this.client(token)
    const perPage = 100
    const all: { path: string; type: string }[] = []
    try {
      for (let page = 1; page <= Math.ceil(maxFiles / perPage); page++) {
        const resp = await client.get(`/projects/${projectId}/repository/tree`, {
          params: { ref, recursive: true, per_page: perPage, page },
        })
        const rows = (resp.data as any[]) ?? []
        for (const r of rows) if (r?.type === 'blob') all.push({ path: r.path, type: r.type })
        if (rows.length < perPage || all.length >= maxFiles) break
      }
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || 'GitLab 请求失败'
      throw new BadGatewayException(`GitLab: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`)
    }
    return all.slice(0, maxFiles)
  }

  /** 取仓库单个文件原文（404 返回 null，其余错误照常抛出） */
  async getRawFile(
    token: string,
    projectId: number,
    filePath: string,
    ref: string,
  ): Promise<string | null> {
    try {
      const resp = await this.client(token).get(
        `/projects/${projectId}/repository/files/${encodeURIComponent(filePath)}/raw`,
        { params: { ref }, responseType: 'text', transformResponse: [(d) => d] },
      )
      return typeof resp.data === 'string' ? resp.data : String(resp.data ?? '')
    } catch (e: any) {
      if (e?.response?.status === 404) return null
      const msg = e?.response?.data?.message || e?.message || 'GitLab 请求失败'
      throw new BadGatewayException(`GitLab: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`)
    }
  }

  getBranches(token: string, projectId: number, keyword?: string) {
    return this.call<any[]>(
      this.client(token).get(`/projects/${projectId}/repository/branches`, {
        params: { search: keyword, per_page: 100 },
      }),
    )
  }

  // ---------- 流水线 / Job ----------
  createPipeline(token: string, projectId: number, ref: string, variables?: Record<string, string>) {
    const body: any = { ref }
    if (variables) body.variables = Object.entries(variables).map(([key, value]) => ({ key, value }))
    return this.call<any>(this.client(token).post(`/projects/${projectId}/pipeline`, body))
  }

  getPipeline(token: string, projectId: number, pipelineId: number) {
    return this.call<any>(this.client(token).get(`/projects/${projectId}/pipelines/${pipelineId}`))
  }

  listPipelineJobs(token: string, projectId: number, pipelineId: number) {
    return this.call<any[]>(
      this.client(token).get(`/projects/${projectId}/pipelines/${pipelineId}/jobs`, {
        params: { per_page: 100 },
      }),
    )
  }

  playJob(token: string, projectId: number, jobId: number) {
    return this.call<any>(this.client(token).post(`/projects/${projectId}/jobs/${jobId}/play`))
  }

  getJobTrace(token: string, projectId: number, jobId: number): Promise<string> {
    return this.call<string>(
      this.client(token).get(`/projects/${projectId}/jobs/${jobId}/trace`, { responseType: 'text' }),
    )
  }

  cancelPipeline(token: string, projectId: number, pipelineId: number) {
    return this.call<any>(this.client(token).post(`/projects/${projectId}/pipelines/${pipelineId}/cancel`))
  }
}
