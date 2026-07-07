export type DeployStatus = 'pending' | 'running' | 'success' | 'failed' | 'canceled'

export interface SessionUser {
  id: number
  gitlabUserId: number
  username: string
  name: string
  avatarUrl: string
  isAdmin: boolean
  /** 管理员在系统管理页禁用的账号，登录与所有接口拒绝 */
  disabled?: boolean
}

export interface StoredToken {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
}

export interface Deployment {
  id: number
  gitlabProjectId: number
  projectName: string
  projectWebUrl?: string
  ref: string
  envCode: string
  status: DeployStatus
  gitlabPipelineId?: number
  gitlabJobId?: number
  triggeredByUserId: number
  triggeredByName: string
  note?: string
  startedAt: string
  finishedAt?: string
  durationSec?: number
  failReason?: string
  /** AI 失败诊断结果缓存（仅失败部署，落盘，避免重复烧 token），见开发文档 §3 */
  diagnosis?: DeployDiagnosis
  /** 实时进度 0-100，由 pipeline job 状态推导；仅响应时附加，不落盘 */
  progress?: number
  /** 是否已发过飞书终态通知（首次进入终态置位并落盘，避免并发/重启后重复发送） */
  notified?: boolean
}

/** AI 部署失败诊断结果（落盘缓存到 Deployment.diagnosis），见开发文档 §3.4 */
export interface DeployDiagnosis {
  /** 根因（一句话） */
  rootCause: string
  /** 详细分析 */
  analysis: string
  /** 修复建议（可含代码片段） */
  suggestion: string
  /** 涉及文件（点击可跳代码问答） */
  files: string[]
  /** 本次诊断使用的模型 */
  model?: string
  createdAt: number
}

/** 项目-环境-分支映射（覆盖默认推断），见需求文档 §6.5 */
export interface ProjectEnvConfig {
  envCode: string
  name: string
  ref: string
  strategy: 'manual_job' | 'create_pipeline'
  minAccessLevel: number
}

/** AI 提示词（提示词库，按用户私有），见需求文档 docs/06 */
export interface Prompt {
  id: number
  userId: number
  title: string
  content: string
  category: string
  tags: string[]
  note?: string
  favorite: boolean
  useCount: number
  lastUsedAt: number | null
  createdAt: number
  updatedAt: number
  /** 共享给的目标用户 id 列表（仅 owner 视角返回，供共享管理弹窗回填） */
  sharedTo?: number[]
  /** 共享来源者姓名：仅当该条是「别人共享给我」时附加，前端据此置为只读 */
  ownerName?: string
  /** 作者（创建者）姓名：所有提示词都附带，卡片展示「谁开发的」 */
  authorName?: string
}

/** 项目代码问答：一条消息（落盘） */
export interface ChatMessageStored {
  role: 'user' | 'assistant'
  content: string
  /** 助手回答时实际读到的仓库文件（仅 assistant） */
  usedFiles?: string[]
  ts: number
}

/**
 * 项目代码问答会话（按 用户+项目 私有，落盘）。
 * 一个会话固定绑定一个项目；分支/模型随最后一次提问更新，便于续聊时复原选择。
 */
export interface Conversation {
  id: number
  userId: number
  gitlabProjectId: number
  projectName: string
  title: string
  ref: string
  model?: string
  messages: ChatMessageStored[]
  createdAt: number
  updatedAt: number
}

/**
 * 项目长期记忆（按 用户+项目 私有，落盘）。
 * 每轮问答后由模型增量沉淀仓库要点，新会话自动注入 system，越聊越懂这个项目。
 */
export interface ProjectMemory {
  userId: number
  gitlabProjectId: number
  /** 自然语言要点摘要（技术栈/入口/部署/关键模块等） */
  summary: string
  updatedAt: number
}

/** AI 提炼返回的提示词草稿 */
export interface PromptDraft {
  title: string
  content: string
  category: string
  tags: string[]
  note?: string
}
