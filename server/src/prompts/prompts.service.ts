import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { StoreService } from '../core/store.service'
import { AiService, PROMPT_CATEGORIES } from './ai.service'
import { decryptSecret, encryptSecret, maskKey } from './crypto.util'
import type { Prompt, PromptDraft, SessionUser } from '../common/types'

export interface PromptInput {
  title: string
  content: string
  category?: string
  tags?: string[]
  note?: string
}

@Injectable()
export class PromptsService {
  constructor(
    private readonly store: StoreService,
    private readonly ai: AiService,
    private readonly config: ConfigService,
  ) {}

  /** Key 加密密钥：优先 AI_KEY_SECRET，回退 JWT_SECRET */
  private encSecret(): string {
    const secret = this.config.get<string>('AI_KEY_SECRET') || this.config.get<string>('JWT_SECRET')
    if (!secret) throw new BadRequestException('服务端未配置 AI_KEY_SECRET / JWT_SECRET，无法加密存储 API Key')
    return secret
  }

  // ---- CRUD ----

  /** 列表 = 自己的提示词（带 sharedTo）+ 别人共享给我的（带 ownerName、只读）；均附 authorName */
  list(user: SessionUser): Prompt[] {
    const own = this.store.listPrompts(user.id).map((p) => ({ ...p, authorName: user.name }))
    const sharedIn = this.store.listSharedInPrompts(user.id).map((p) => {
      const author = this.store.getUser(p.userId)?.name ?? '其他用户'
      return {
        ...p,
        sharedTo: undefined, // 共享来的不暴露其分享名单
        ownerName: author,
        authorName: author,
      }
    })
    return [...own, ...sharedIn]
  }

  /** 可共享的目标用户：除自己外、未被禁用的全部用户 */
  shareUsers(user: SessionUser) {
    return this.store
      .listUsers()
      .filter((u) => u.id !== user.id && !u.disabled)
      .map((u) => ({ id: u.id, name: u.name, username: u.username, avatarUrl: u.avatarUrl }))
  }

  /** 共享管理：以 userIds 全量覆盖该提示词的共享名单（仅 owner 可操作） */
  share(user: SessionUser, id: number, userIds: number[]): Prompt {
    this.owned(user, id)
    const valid = new Set(this.store.listUsers().map((u) => u.id))
    const targets = [...new Set((userIds ?? []).map(Number))].filter(
      (uid) => Number.isInteger(uid) && uid !== user.id && valid.has(uid),
    )
    return this.store.updatePrompt(id, { sharedTo: targets, updatedAt: Date.now() })!
  }

  /**
   * 一键分享：把当前用户的「全部提示词」追加共享给指定用户。
   * 采用并集（union）合并，不影响各提示词已有的共享名单。
   */
  shareAllTo(user: SessionUser, userIds: number[]): { promptCount: number; userCount: number } {
    const valid = new Set(this.store.listUsers().filter((u) => !u.disabled).map((u) => u.id))
    const targets = [...new Set((userIds ?? []).map(Number))].filter(
      (uid) => Number.isInteger(uid) && uid !== user.id && valid.has(uid),
    )
    if (!targets.length) throw new BadRequestException('请选择要分享给的用户')
    const own = this.store.listPrompts(user.id)
    const now = Date.now()
    for (const p of own) {
      const merged = [...new Set([...(p.sharedTo ?? []), ...targets])]
      this.store.updatePrompt(p.id, { sharedTo: merged, updatedAt: now })
    }
    return { promptCount: own.length, userCount: targets.length }
  }

  create(user: SessionUser, input: PromptInput): Prompt {
    const data = this.validate(input)
    const now = Date.now()
    return this.store.createPrompt({
      userId: user.id,
      ...data,
      favorite: false,
      useCount: 0,
      lastUsedAt: null,
      createdAt: now,
      updatedAt: now,
    })
  }

  update(user: SessionUser, id: number, input: PromptInput): Prompt {
    this.owned(user, id)
    const data = this.validate(input)
    return this.store.updatePrompt(id, { ...data, updatedAt: Date.now() })!
  }

  remove(user: SessionUser, id: number) {
    this.owned(user, id)
    this.store.deletePrompt(id)
  }

  /** 复制成功后上报：累计次数 + 刷新最近使用时间 */
  markUsed(user: SessionUser, id: number): Prompt {
    const p = this.owned(user, id)
    return this.store.updatePrompt(id, { useCount: p.useCount + 1, lastUsedAt: Date.now() })!
  }

  setFavorite(user: SessionUser, id: number, on: boolean): Prompt {
    this.owned(user, id)
    return this.store.updatePrompt(id, { favorite: on })!
  }

  /** 当前用户全部标签（去重，按出现次数降序），用于输入联想 */
  tags(user: SessionUser): string[] {
    const count = new Map<string, number>()
    for (const p of this.store.listPrompts(user.id))
      for (const t of p.tags) count.set(t, (count.get(t) ?? 0) + 1)
    return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t)
  }

  // ---- AI 网关 Key 管理 ----

  getAiConfig(user: SessionUser) {
    const enc = this.store.getAiKey(user.id)
    let masked: string | undefined
    if (enc) {
      try {
        masked = maskKey(decryptSecret(enc, this.encSecret()))
      } catch {
        // 加密 secret 已轮换导致解不开：视为未配置，引导重新填
        masked = undefined
      }
    }
    return {
      configured: !!masked,
      maskedKey: masked,
      model: this.ai.model,
      gateway: this.ai.gatewayUrl,
    }
  }

  /** 保存前先用该 Key 实际调一次网关，通过才落盘 */
  async setAiKey(user: SessionUser, apiKey: string) {
    const key = (apiKey ?? '').trim()
    if (!key) throw new BadRequestException('API Key 不能为空')
    const result = await this.ai.testKey(key)
    this.store.setAiKey(user.id, encryptSecret(key, this.encSecret()))
    return { ...result, maskedKey: maskKey(key) }
  }

  clearAiKey(user: SessionUser) {
    this.store.clearAiKey(user.id)
  }

  /** 可选模型列表 */
  aiModels() {
    return this.ai.models
  }

  /** AI 提炼：粘贴对话 → 提示词草稿 */
  async refine(user: SessionUser, conversation: string, model?: string): Promise<PromptDraft> {
    const text = (conversation ?? '').trim()
    if (!text) throw new BadRequestException('请先粘贴要提炼的对话内容')
    if (text.length > 50_000) throw new BadRequestException('内容过长，请控制在 5 万字以内')
    return this.ai.refine(this.ai.resolveKey(user.id), text, model)
  }

  // ---- 私有 ----

  /** 校验归属：不是自己的数据按 404/403 处理 */
  private owned(user: SessionUser, id: number): Prompt {
    const p = this.store.getPrompt(id)
    if (!p) throw new NotFoundException('提示词不存在')
    if (p.userId !== user.id) throw new ForbiddenException('无权操作他人的提示词')
    return p
  }

  private validate(input: PromptInput) {
    const title = (input.title ?? '').trim()
    const content = (input.content ?? '').trim()
    if (!title) throw new BadRequestException('标题不能为空')
    if (title.length > 100) throw new BadRequestException('标题不能超过 100 字')
    if (!content) throw new BadRequestException('提示词内容不能为空')
    if (content.length > 20_000) throw new BadRequestException('内容不能超过 2 万字')
    const category = PROMPT_CATEGORIES.includes(input.category as (typeof PROMPT_CATEGORIES)[number])
      ? input.category!
      : '其他'
    const tags = [...new Set((input.tags ?? []).map((t) => String(t).trim()).filter(Boolean))].slice(0, 10)
    const note = (input.note ?? '').trim() || undefined
    return { title, content, category, tags, note }
  }
}
