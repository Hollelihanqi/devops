/**
 * CI/CD 多供应商抽象（见开发文档 §2）。
 * 本文件只落 Phase 0 最小子集——刚好够「AI 部署失败诊断」用：
 * 读项目元信息、读仓库代码（诊断按需读相关文件）、取失败构建的清洗日志。
 * 触发 / 状态 / 取消 / 分支列表等留待 Phase 1+ 再逐步收敛进来，业务层届时零改动。
 */
import type { DeployStatus } from '../../common/types'

/** 注入令牌：业务层以此注入「抽象的 CiProvider」，而非具体的 GitLab 实现 */
export const CI_PROVIDER = Symbol('CI_PROVIDER')

export type CiProviderKind = 'gitlab' | 'jenkins'

/** 鉴权上下文：GitLab 为用户 OAuth token；Jenkins 后续可扩展为 user+apiToken/crumb */
export interface CiAuth {
  token: string
}

/** 一次「构建 / 流水线」的供应商无关引用 */
export interface CiBuildRef {
  /** GitLab pipeline / Jenkins build number */
  pipelineId?: string | number
  /** 入口 job */
  jobId?: string | number
  /** 供应商私有字段（如 Jenkins jobName） */
  extra?: Record<string, unknown>
}

/** 项目元信息（诊断 / 问答取名字、默认分支、web 链接等） */
export interface CiProjectMeta {
  id: string | number
  name: string
  pathWithNamespace?: string
  defaultBranch?: string
  webUrl?: string
  description?: string
}

/** 清洗后的单个 job / stage 日志 */
export interface CiJobLog {
  stage: string
  name: string
  status: string
  trace: string
}

/** 构建状态（供应商无关）。Phase 0 暂未用到，先占位以对齐文档接口形态 */
export interface CiBuildStatus {
  status: DeployStatus
  progress: number
  finishedAt?: string
  durationSec?: number
  webUrl?: string
}

/**
 * CI/CD 供应商抽象接口（Phase 0 最小子集）。
 * 业务层（诊断）只认这个接口，不认识具体是 GitLab 还是 Jenkins。
 */
export interface CiProvider {
  readonly kind: CiProviderKind
  // —— 仓库（诊断 / 代码问答要读代码）——
  getProject(ctx: CiAuth, projectId: string): Promise<CiProjectMeta>
  listRepoTree(ctx: CiAuth, projectId: string, ref: string): Promise<string[]>
  getRawFile(ctx: CiAuth, projectId: string, path: string, ref: string): Promise<string | null>
  // —— 流水线日志（诊断锚点）——
  getBuildLogs(ctx: CiAuth, projectId: string, ref: CiBuildRef): Promise<CiJobLog[]>
}
