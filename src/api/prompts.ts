import { http, request } from './http'
import type { AiConfig, AiModelOption, Prompt, PromptDraft, PromptInput, ShareUser } from './types'

/** 提示词分类（与后端 PROMPT_CATEGORIES 保持一致） */
export const PROMPT_CATEGORIES = ['编码', '代码审查', '文档写作', '调试排错', '部署运维', '日常办公', '其他'] as const

export const promptsApi = {
  list: () => request<Prompt[]>(http.get('/prompts')),

  create: (data: PromptInput) => request<Prompt>(http.post('/prompts', data)),

  update: (id: number, data: PromptInput) => request<Prompt>(http.put(`/prompts/${id}`, data)),

  remove: (id: number) => request<void>(http.delete(`/prompts/${id}`)),

  /** 复制成功后上报使用 */
  use: (id: number) => request<Prompt>(http.post(`/prompts/${id}/use`)),

  favorite: (id: number, on: boolean) => request<Prompt>(http.put(`/prompts/${id}/favorite`, { on })),

  tags: () => request<string[]>(http.get('/prompts/tags')),

  // ---- 共享 ----
  /** 可共享的目标用户（除自己外的全部启用账号） */
  shareUsers: () => request<ShareUser[]>(http.get('/prompts/share-users')),

  /** 全量覆盖某提示词的共享名单 */
  share: (id: number, userIds: number[]) =>
    request<Prompt>(http.put(`/prompts/${id}/share`, { userIds })),

  /** 一键分享：把当前用户的全部提示词分享给指定用户 */
  shareAllTo: (userIds: number[]) =>
    request<{ promptCount: number; userCount: number }>(
      http.post('/prompts/share-all', { userIds }),
    ),

  // ---- AI 网关 ----
  aiConfig: () => request<AiConfig>(http.get('/prompts/ai/config')),

  /** 可自选的大模型列表（提示词提炼 / 项目问答共用同一份） */
  aiModels: () => request<AiModelOption[]>(http.get('/prompts/ai/models')),

  /** 保存 Key（后端会先实测连通性，通过才加密落盘） */
  setAiKey: (apiKey: string) =>
    request<{ model: string; latencyMs: number; maskedKey: string }>(
      http.put('/prompts/ai/config', { apiKey }, { timeout: 90_000 }),
    ),

  clearAiKey: () => request<void>(http.delete('/prompts/ai/config')),

  /** 粘贴对话 → AI 提炼成提示词草稿（模型生成较慢，放宽超时） */
  refine: (conversation: string, model?: string) =>
    request<PromptDraft>(http.post('/prompts/ai/refine', { conversation, model }, { timeout: 120_000 })),
}
