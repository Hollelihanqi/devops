import { http, request } from './http'
import type { Deployment, CreateDeploymentPayload, DeployDiagnosis, DeployStatus, Paginated } from './types'

export interface DeploymentsQuery {
  projectId?: number
  env?: string
  status?: DeployStatus
  from?: string
  to?: string
  triggeredBy?: string
  page?: number
  pageSize?: number
}

export const deploymentsApi = {
  create: (payload: CreateDeploymentPayload) =>
    request<{ deploymentId: number; pipelineId?: number; jobId?: number }>(
      http.post('/deployments', payload),
    ),

  detail: (id: number) => request<Deployment>(http.get(`/deployments/${id}`)),

  logs: (id: number, offset = 0) =>
    request<{ content: string; nextOffset: number; finished: boolean }>(
      http.get(`/deployments/${id}/logs`, { params: { offset } }),
    ),

  cancel: (id: number) => request<void>(http.post(`/deployments/${id}/cancel`)),

  /** AI 失败诊断：触发 / 重新诊断（工具循环读日志+代码，超时放宽到 5 分钟） */
  diagnose: (id: number, model?: string) =>
    request<DeployDiagnosis>(
      http.post(`/deployments/${id}/diagnose`, { model }, { timeout: 300_000 }),
    ),

  /** 取已缓存的诊断（无则 null） */
  getDiagnosis: (id: number) =>
    request<DeployDiagnosis | null>(http.get(`/deployments/${id}/diagnose`)),

  list: (params: DeploymentsQuery) =>
    request<Paginated<Deployment>>(http.get('/deployments', { params })),

  /** 实时日志/状态 SSE 地址（由组件用 EventSource 订阅） */
  streamUrl: (id: number) => `/api/deployments/${id}/stream`,
}
