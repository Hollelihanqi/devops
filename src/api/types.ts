// 平台 API 数据类型（对应需求文档 §9 数据模型 / §10 接口契约）

/** 统一响应包络 */
export interface ApiResult<T> {
  code: number
  message: string
  data: T
}

/** 当前登录用户 */
export interface CurrentUser {
  id: number
  gitlabUserId: number
  username: string
  name: string
  avatarUrl: string
  isAdmin: boolean
}

/** 分组树节点 */
export interface GroupNode {
  id: number
  gitlabGroupId: number
  name: string
  fullPath: string
  children?: GroupNode[]
}

/** 部署状态 */
export type DeployStatus = 'pending' | 'running' | 'success' | 'failed' | 'canceled'

/** 项目列表项 */
export interface ProjectItem {
  id: number
  gitlabProjectId: number
  name: string
  pathWithNamespace: string
  webUrl?: string
  groupName: string
  defaultBranch: string
  favorite: boolean
  /** 仓库默认分支是否存在 .gitlab-ci.yml（无则不可部署） */
  hasCiConfig: boolean
  /** 识别出的项目类型标签（Vue/React/小程序/Java/Go）；识别不出则缺省，不显示 */
  kind?: string
  lastDeploy?: {
    env: string
    status: DeployStatus
    at: string
  }
}

/** 分支 */
export interface BranchItem {
  name: string
  default: boolean
  protected: boolean
}

/** 项目可部署环境（环境与分支绑定，见 §6.5） */
export interface ProjectEnvironment {
  envCode: string
  name: string
  ref: string // 该环境绑定的分支，如 测试→develop
  deployable: boolean // 当前用户是否有权部署
}

/** 部署记录 */
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
  /** AI 失败诊断结果缓存（仅失败部署） */
  diagnosis?: DeployDiagnosis
  /** 实时进度 0-100（部署中由后端按 pipeline job 状态推导，终态恒为 100） */
  progress?: number
}

/** AI 部署失败诊断结果（见开发文档 §3.4） */
export interface DeployDiagnosis {
  /** 根因（一句话） */
  rootCause: string
  /** 详细分析 */
  analysis: string
  /** 修复建议（可含代码片段） */
  suggestion: string
  /** 涉及文件（点击可带入代码问答） */
  files: string[]
  /** 本次诊断使用的模型 */
  model?: string
  createdAt: number
}

/** 触发部署入参 */
export interface CreateDeploymentPayload {
  projectId: number
  env: string
  ref?: string // 省略则用环境绑定分支
  variables?: Record<string, string>
  note?: string
}

/** 管理页：概览统计 */
export interface AdminStats {
  userCount: number
  deployments: {
    total: number
    success: number
    failed: number
    running: number
    today: number
  }
}

/** 管理页：用户列表项 */
export interface AdminUser {
  id: number
  gitlabUserId: number
  username: string
  name: string
  avatarUrl: string
  isAdmin: boolean
  /** 来自 ADMIN_USERNAMES 环境变量的固定管理员，不可在界面取消 */
  adminFromEnv: boolean
  /** 账号被禁用后无法登录和调用任何接口 */
  disabled: boolean
  /** 当前是否持有有效 GitLab 授权 */
  authorized: boolean
}

/** 项目环境配置（管理页可编辑的完整形态，对应后端 ProjectEnvConfig） */
export interface ProjectEnvConfigItem {
  envCode: string
  name: string
  ref: string
  strategy: 'manual_job' | 'create_pipeline'
  minAccessLevel: number
}

/** 环境配置明细：覆盖配置 or 分支约定推断 */
export interface EnvConfigsDetail {
  source: 'override' | 'convention'
  configs: ProjectEnvConfigItem[]
}

export interface Paginated<T> {
  list: T[]
  total: number
  page: number
  pageSize: number
}

/** AI 提示词（提示词库，按用户私有，见 docs/06） */
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
  /** 共享给的目标用户 id 列表（仅自己创建的提示词返回，用于共享管理回填） */
  sharedTo?: number[]
  /** 共享来源者姓名：有值表示这是「别人共享给我的」，前端据此置为只读 */
  ownerName?: string
  /** 作者（创建者）姓名：所有提示词都附带，卡片展示「谁开发的」 */
  authorName?: string
}

/** 可共享目标用户（提示词共享选人用） */
export interface ShareUser {
  id: number
  name: string
  username: string
  avatarUrl: string
}

/** 新建/编辑提示词入参 */
export interface PromptInput {
  title: string
  content: string
  category?: string
  tags?: string[]
  note?: string
}

/** AI 提炼返回的草稿 */
export interface PromptDraft {
  title: string
  content: string
  category: string
  tags: string[]
  note?: string
}

/** AI 网关配置状态（Key 永不明文回传，只回脱敏串） */
export interface AiConfig {
  configured: boolean
  maskedKey?: string
  model: string
  gateway: string
}

/** 可自选的大模型（id 是网关真实模型名，label 是展示名） */
export interface AiModelOption {
  id: string
  label: string
}

/** 项目代码问答：一轮对话消息 */
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/** 项目代码问答返回 */
export interface ProjectChatResult {
  /** 本次问答所属会话 id（新会话由后端创建并返回） */
  conversationId: number
  /** 会话标题（首个问题自动生成） */
  title: string
  answer: string
  /** 本次回答实际读到的仓库文件路径 */
  usedFiles: string[]
  /** 本次回答所基于的分支 */
  ref: string
}

/** 一条落盘的会话消息 */
export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
  usedFiles?: string[]
  ts: number
}

/** 会话列表项（不含消息体） */
export interface ConversationSummary {
  id: number
  userId: number
  gitlabProjectId: number
  projectName: string
  title: string
  ref: string
  model?: string
  createdAt: number
  updatedAt: number
}

/** 会话详情（含完整消息） */
export interface ConversationDetail extends ConversationSummary {
  messages: ConversationMessage[]
}
