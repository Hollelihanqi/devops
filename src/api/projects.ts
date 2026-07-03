import { http, request } from './http'
import type {
  GroupNode,
  ProjectItem,
  BranchItem,
  ProjectEnvironment,
  Paginated,
  ProjectChatResult,
  ConversationSummary,
  ConversationDetail,
} from './types'

export interface ProjectsQuery {
  groupId?: number
  keyword?: string
  page?: number
  pageSize?: number
  onlyFavorite?: boolean
  /** true 时绕过后端 .gitlab-ci.yml 检测缓存，强制重新检测 */
  fresh?: boolean
}

export const projectsApi = {
  groupTree: () => request<GroupNode[]>(http.get('/groups/tree')),

  list: (params: ProjectsQuery) =>
    request<Paginated<ProjectItem>>(http.get('/projects', { params })),

  branches: (projectId: number, keyword?: string) =>
    request<BranchItem[]>(http.get(`/projects/${projectId}/branches`, { params: { keyword } })),

  environments: (projectId: number) =>
    request<ProjectEnvironment[]>(http.get(`/projects/${projectId}/environments`)),

  /** 读取某分支现有 .gitlab-ci.yml 原文（供编辑器加载） */
  getCiConfig: (projectId: number, ref?: string) =>
    request<{ exists: boolean; content: string; ref: string }>(
      http.get(`/projects/${projectId}/ci-config`, { params: { ref } }),
    ),

  /** AI 生成 / 优化 .gitlab-ci.yml（拉仓库+调模型，放宽超时） */
  generateCiConfig: (
    projectId: number,
    body: { ref?: string; requirement?: string; model?: string; base?: string },
  ) =>
    request<{ content: string }>(
      http.post(`/projects/${projectId}/ci-config/generate`, body, { timeout: 120_000 }),
    ),

  /** GitLab CI 语法校验 */
  lintCiConfig: (projectId: number, content: string) =>
    request<{ valid: boolean; errors: string[]; warnings: string[] }>(
      http.post(`/projects/${projectId}/ci-config/lint`, { content }),
    ),

  /** 提交 .gitlab-ci.yml：直接提交到分支，或新建分支并发起 MR */
  commitCiConfig: (
    projectId: number,
    body: {
      content: string
      mode: 'commit' | 'merge_request'
      targetBranch: string
      newBranch?: string
      commitMessage?: string
      mrTitle?: string
      mrDescription?: string
    },
  ) =>
    request<{ committedBranch?: string; mergeRequestUrl?: string; fileAction: 'create' | 'update' }>(
      http.post(`/projects/${projectId}/ci-config`, body),
    ),

  favorite: (projectId: number, on: boolean) =>
    on
      ? request<void>(http.post(`/projects/${projectId}/favorite`))
      : request<void>(http.delete(`/projects/${projectId}/favorite`)),

  /**
   * 针对该项目仓库代码的 AI 问答（Agent 工具循环，自己读够为止）。
   * 传 conversationId 续聊（不传则新建会话）；历史以服务端为准，前端只发当前问题。
   * 工具循环可能多轮读文件，耗时较长，超时放宽到 5 分钟。
   */
  chat: (
    projectId: number,
    params: { conversationId?: number; question: string; model?: string; ref?: string },
  ) => request<ProjectChatResult>(http.post(`/projects/${projectId}/chat`, params, { timeout: 300_000 })),

  /** 某项目下我的会话列表 */
  conversations: (projectId: number) =>
    request<ConversationSummary[]>(http.get(`/projects/${projectId}/conversations`)),

  /** 会话详情（含完整消息，用于续聊还原） */
  conversation: (conversationId: number) =>
    request<ConversationDetail>(http.get(`/conversations/${conversationId}`)),

  /** 重命名会话 */
  renameConversation: (conversationId: number, title: string) =>
    request<void>(http.patch(`/conversations/${conversationId}`, { title })),

  /** 删除会话 */
  deleteConversation: (conversationId: number) =>
    request<void>(http.delete(`/conversations/${conversationId}`)),
}
