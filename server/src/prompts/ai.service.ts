import { BadGatewayException, BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import axios, { AxiosError, AxiosInstance } from 'axios'
import * as https from 'https'
import * as fs from 'fs'
import type { PromptDraft } from '../common/types'
import { StoreService } from '../core/store.service'
import { decryptSecret } from './crypto.util'

/** 一轮对话消息（与 Anthropic messages 协议一致） */
export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

/** 工具定义（Anthropic tools 协议） */
export interface AgentTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

/** 工具循环里的消息：content 可为纯文本，或 Anthropic 内容块数组（thinking/text/tool_use/tool_result） */
export interface AgentMessage {
  role: 'user' | 'assistant'
  content: string | unknown[]
}

/** 工具循环结果 */
export interface AgentResult {
  /** 最终回答文本 */
  text: string
  /** 本轮模型实际发起过的工具调用（按发生顺序） */
  toolCalls: { name: string; input: Record<string, unknown> }[]
  /** 实际迭代轮数 */
  iterations: number
}

export const PROMPT_CATEGORIES = ['编码', '代码审查', '文档写作', '调试排错', '部署运维', '日常办公', '其他'] as const

/** 一个可选模型：id 是网关 Anthropic 协议下的真实模型名，label 是页面展示名 */
export interface AiModelOption {
  id: string
  label: string
}

/**
 * 用户可自选的模型白名单。
 * 注意：这些 id 全部走网关的 Anthropic 协议（/anthropic/v1/messages）。
 * 资料里带 O 前缀的（Oglm/OQwen）是 OpenAI 协议专用名，这里统一用其 Anthropic 协议等价名，
 * 因此后端无需改 endpoint，仅切换 model 字段即可。
 */
export const AI_MODELS: AiModelOption[] = [
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro（综合强）' },
  { id: 'claude-haiku-4-5', label: 'DeepSeek V4 Flash（haiku 别名 · 快）' },
  { id: 'glm-5.2', label: '智谱 GLM-5.2' },
  { id: 'kimi-k2.6', label: 'Kimi K2.6' },
  { id: 'qwen3.7-max', label: '通义千问 3.7 Max' },
]

/** 单个工具结果回灌给模型时的字符上限（防止一个超大文件撑爆上下文） */
const TOOL_RESULT_MAX_CHARS = 60_000

/** 提炼提示词的系统指令：要求模型只输出 JSON */
const REFINE_SYSTEM = `你是提示词工程专家。用户会粘贴一段他与 AI 的对话记录或一段描述，你的任务是从中提炼出一条可反复使用的高质量提示词。

要求：
1. 提示词应当通用化：把对话里的具体项目名、文件名等专有内容替换为通顺的泛化表述；
2. 保留让 AI 输出变好的关键约束（角色设定、输出格式、步骤要求等）；
3. 只输出一个 JSON 对象，不要任何其他文字、不要代码块标记，结构如下：
{"title":"不超过30字的标题","content":"提炼后的完整提示词正文","category":"从[${PROMPT_CATEGORIES.join('、')}]中选一个","tags":["2到4个简短标签"],"note":"一句话说明适用场景"}`

/**
 * 内网 MaaS 网关客户端（Anthropic 协议）。
 * 网关地址/模型由环境变量覆盖：AI_GATEWAY_URL / AI_MODEL / AI_CA_FILE。
 * 网关为自签名证书：配置 AI_CA_FILE 时校验该 CA，否则跳过 TLS 校验（内网可接受）。
 */
@Injectable()
export class AiService {
  constructor(
    private readonly config: ConfigService,
    private readonly store: StoreService,
  ) {}

  private readonly logger = new Logger(AiService.name)
  private client?: AxiosInstance

  /** Key 加密密钥：优先 AI_KEY_SECRET，回退 JWT_SECRET（与 PromptsService 一致） */
  private encSecret(): string {
    const secret = this.config.get<string>('AI_KEY_SECRET') || this.config.get<string>('JWT_SECRET')
    if (!secret) throw new BadRequestException('服务端未配置 AI_KEY_SECRET / JWT_SECRET，无法解密 API Key')
    return secret
  }

  /** 取该用户已加密存储的网关 Key 并解密；未配置或解不开都抛出可读错误 */
  resolveKey(userId: number): string {
    const enc = this.store.getAiKey(userId)
    if (!enc) throw new BadRequestException('尚未配置 AI 网关 API Key，请先在「AI 设置」中配置')
    try {
      return decryptSecret(enc, this.encSecret())
    } catch {
      throw new BadRequestException('已存的 API Key 无法解密（服务端密钥可能已轮换），请重新配置')
    }
  }

  private readonly modelIds = new Set(AI_MODELS.map((m) => m.id))

  /** 可选模型列表（给前端渲染下拉） */
  get models(): AiModelOption[] {
    return AI_MODELS
  }

  /** 默认模型：优先 AI_MODEL（须在白名单内），否则取白名单第一个 */
  get model(): string {
    const env = this.config.get<string>('AI_MODEL')
    return env && this.modelIds.has(env) ? env : AI_MODELS[0].id
  }

  /** 把前端传来的模型名收敛到白名单内，非法或缺省都回退默认模型，防止越权调用任意模型 */
  resolveModel(model?: string): string {
    return model && this.modelIds.has(model) ? model : this.model
  }

  /**
   * 输出 token 上限。Anthropic 协议要求 max_tokens 必填、无法真正"不限"，
   * 这里取一个很大的默认值（不截断答案），需要更大可用 AI_MAX_TOKENS 覆盖。
   */
  get maxOutputTokens(): number {
    const v = Number(this.config.get<string>('AI_MAX_TOKENS'))
    return Number.isFinite(v) && v > 0 ? v : 16_384
  }

  get gatewayUrl(): string {
    return (this.config.get<string>('AI_GATEWAY_URL') || 'https://10.0.147.128:8080').replace(/\/$/, '')
  }

  private http(): AxiosInstance {
    if (this.client) return this.client
    const caFile = this.config.get<string>('AI_CA_FILE')
    const httpsAgent = caFile
      ? new https.Agent({ ca: fs.readFileSync(caFile) })
      : new https.Agent({ rejectUnauthorized: false })
    this.client = axios.create({
      baseURL: this.gatewayUrl,
      timeout: 60_000,
      httpsAgent,
    })
    return this.client
  }

  /** 调网关 /anthropic/v1/messages，返回模型输出文本 */
  private async chat(
    apiKey: string,
    opts: { system?: string; user: string; maxTokens?: number; model?: string },
  ): Promise<string> {
    try {
      const resp = await this.http().post(
        '/anthropic/v1/messages',
        {
          model: this.resolveModel(opts.model),
          max_tokens: opts.maxTokens ?? 2048,
          ...(opts.system ? { system: opts.system } : {}),
          messages: [{ role: 'user', content: opts.user }],
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
        },
      )
      const blocks = resp.data?.content
      const text = Array.isArray(blocks)
        ? blocks.map((b: { type?: string; text?: string }) => b?.text ?? '').join('')
        : ''
      if (!text) throw new BadGatewayException('AI 网关返回了空内容')
      return text
    } catch (e) {
      throw this.toFriendlyError(e)
    }
  }

  /** 多轮对话：传完整 messages（含历史），返回模型输出文本 */
  async chatConversation(
    apiKey: string,
    opts: { system?: string; messages: ChatTurn[]; maxTokens?: number; model?: string },
  ): Promise<string> {
    const messages = opts.messages
      .filter((m) => m && typeof m.content === 'string' && m.content.trim())
      .map((m) => ({ role: m.role, content: m.content }))
    if (!messages.length) throw new BadRequestException('对话内容不能为空')
    try {
      const resp = await this.http().post(
        '/anthropic/v1/messages',
        {
          model: this.resolveModel(opts.model),
          max_tokens: opts.maxTokens ?? this.maxOutputTokens,
          ...(opts.system ? { system: opts.system } : {}),
          messages,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
        },
      )
      const blocks = resp.data?.content
      const text = Array.isArray(blocks)
        ? blocks.map((b: { type?: string; text?: string }) => b?.text ?? '').join('')
        : ''
      if (!text) throw new BadGatewayException('AI 网关返回了空内容')
      return text
    } catch (e) {
      throw this.toFriendlyError(e)
    }
  }

  /**
   * 工具循环对话（Anthropic tools 协议）：把工具清单交给模型，模型按需发起 tool_use，
   * 由调用方 onTool 实际执行（读文件 / 列目录 / 全文检索），结果回灌后模型继续，直到给出最终答案。
   * 通过「最大迭代轮数」兜底，而非「文件数量」封顶——这才是真正的「读够为止 / 全文阅读」。
   */
  async chatAgent(
    apiKey: string,
    opts: {
      system?: string
      messages: AgentMessage[]
      tools: AgentTool[]
      model?: string
      maxTokens?: number
      maxIterations?: number
      onTool: (name: string, input: Record<string, unknown>) => Promise<string>
    },
  ): Promise<AgentResult> {
    const model = this.resolveModel(opts.model)
    const maxIterations = opts.maxIterations ?? 24
    const messages: AgentMessage[] = [...opts.messages]
    const toolCalls: { name: string; input: Record<string, unknown> }[] = []

    for (let i = 0; i < maxIterations; i++) {
      const data = await this.postMessages(apiKey, {
        model,
        max_tokens: opts.maxTokens ?? this.maxOutputTokens,
        ...(opts.system ? { system: opts.system } : {}),
        tools: opts.tools,
        messages,
      })
      const blocks = Array.isArray(data?.content) ? (data.content as any[]) : []
      // 原样回灌助手内容块（含 thinking / tool_use），保证签名与多模型兼容
      messages.push({ role: 'assistant', content: blocks })

      if (data?.stop_reason !== 'tool_use') {
        const text = blocks
          .filter((b) => b?.type === 'text')
          .map((b) => b.text ?? '')
          .join('')
        return { text: text.trim(), toolCalls, iterations: i + 1 }
      }

      // 执行本轮所有 tool_use，结果按 tool_use_id 回灌
      const toolUses = blocks.filter((b) => b?.type === 'tool_use')
      const results: unknown[] = []
      for (const tu of toolUses) {
        const name = String(tu.name)
        const input = (tu.input ?? {}) as Record<string, unknown>
        toolCalls.push({ name, input })
        let out: string
        try {
          out = await opts.onTool(name, input)
        } catch (e) {
          out = `错误：${(e as Error).message}`
        }
        results.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: out.slice(0, TOOL_RESULT_MAX_CHARS),
        })
      }
      messages.push({ role: 'user', content: results })
    }

    // 迭代用尽仍未收敛：去掉工具，逼模型基于已读内容直接作答，避免空手而归
    messages.push({
      role: 'user',
      content: '已达到本次可读取的轮数上限。请基于上面已经读到的内容，立即给出尽可能完整的最终回答，不要再请求读取文件。',
    })
    const data = await this.postMessages(apiKey, {
      model,
      max_tokens: opts.maxTokens ?? this.maxOutputTokens,
      ...(opts.system ? { system: opts.system } : {}),
      messages,
    })
    const blocks = Array.isArray(data?.content) ? (data.content as any[]) : []
    const text = blocks
      .filter((b) => b?.type === 'text')
      .map((b) => b.text ?? '')
      .join('')
    return { text: text.trim(), toolCalls, iterations: maxIterations }
  }

  /** 统一的 /anthropic/v1/messages POST，返回原始响应体（供工具循环复用） */
  private async postMessages(apiKey: string, payload: Record<string, unknown>): Promise<any> {
    try {
      const resp = await this.http().post('/anthropic/v1/messages', payload, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
      })
      return resp.data
    } catch (e) {
      throw this.toFriendlyError(e)
    }
  }

  private toFriendlyError(e: unknown): Error {
    if (e instanceof BadGatewayException) return e
    const err = e as AxiosError<{ error?: { message?: string }; message?: string }>
    const status = err.response?.status
    const detail = err.response?.data?.error?.message || err.response?.data?.message || err.message
    this.logger.warn(`AI 网关调用失败 status=${status ?? '-'} ${detail}`)
    if (status === 401 || status === 403) {
      return new UnauthorizedException('AI 网关拒绝了该 API Key，请检查 Key 是否正确或已过期')
    }
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED') {
      return new BadGatewayException(`无法连接 AI 网关（${this.gatewayUrl}），请确认内网可达`)
    }
    return new BadGatewayException(`AI 网关调用失败：${detail}`)
  }

  /** 保存 Key 前的连通性验证：发一个最小请求 */
  async testKey(apiKey: string, model?: string): Promise<{ model: string; latencyMs: number }> {
    const start = Date.now()
    const used = this.resolveModel(model)
    await this.chat(apiKey, { user: '回复"ok"两个字母即可', maxTokens: 16, model: used })
    return { model: used, latencyMs: Date.now() - start }
  }

  /** 把一段对话/描述提炼成提示词草稿 */
  async refine(apiKey: string, conversation: string, model?: string): Promise<PromptDraft> {
    const text = await this.chat(apiKey, { system: REFINE_SYSTEM, user: conversation, maxTokens: 4096, model })
    const draft = this.parseDraft(text)
    if (!draft) {
      this.logger.warn(`AI 提炼结果无法解析为 JSON：${text.slice(0, 200)}`)
      throw new BadGatewayException('AI 返回的内容无法解析，请重试或换一段对话')
    }
    return draft
  }

  /** 从模型输出中提取 JSON（容忍代码块包裹、前后多余文字） */
  private parseDraft(text: string): PromptDraft | null {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      const raw = JSON.parse(text.slice(start, end + 1)) as Partial<PromptDraft>
      if (!raw.title || !raw.content) return null
      const category = PROMPT_CATEGORIES.includes(raw.category as (typeof PROMPT_CATEGORIES)[number])
        ? (raw.category as string)
        : '其他'
      return {
        title: String(raw.title).slice(0, 100),
        content: String(raw.content),
        category,
        tags: Array.isArray(raw.tags) ? raw.tags.map(String).slice(0, 4) : [],
        note: raw.note ? String(raw.note) : undefined,
      }
    } catch {
      return null
    }
  }
}
