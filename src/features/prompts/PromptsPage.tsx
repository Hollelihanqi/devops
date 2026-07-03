import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Input,
  Button,
  Select,
  Segmented,
  Tag,
  Empty,
  Spin,
  Popconfirm,
  Tooltip,
  Typography,
  App,
} from 'antd'
import {
  PlusOutlined,
  CopyOutlined,
  EditOutlined,
  DeleteOutlined,
  StarFilled,
  StarOutlined,
  RobotOutlined,
  SettingOutlined,
  ReloadOutlined,
  ShareAltOutlined,
  TeamOutlined,
  EyeOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'
import { promptsApi, PROMPT_CATEGORIES } from '@/api/prompts'
import { useAuthStore } from '@/stores/auth'
import type { Prompt, PromptDraft } from '@/api/types'
import PromptEditModal from './PromptEditModal'
import ShareModal from './ShareModal'
import ShareAllModal from './ShareAllModal'
import PromptViewModal from './PromptViewModal'
import { AiConfigModal, AiRefineModal } from './AiModals'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

const { Search } = Input

type SortKey = 'lastUsed' | 'useCount' | 'createdAt'

const sorters: Record<SortKey, (a: Prompt, b: Prompt) => number> = {
  lastUsed: (a, b) => (b.lastUsedAt ?? b.createdAt) - (a.lastUsedAt ?? a.createdAt),
  useCount: (a, b) => b.useCount - a.useCount,
  createdAt: (a, b) => b.createdAt - a.createdAt,
}

/** 别人共享给我的提示词（接收方只读，不能编辑/删除/再共享） */
const isShared = (p: Prompt) => !!p.ownerName

/** 剪贴板写入：clipboard API 不可用（http 内网域名）时回退 execCommand */
async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  try {
    if (!document.execCommand('copy')) throw new Error('execCommand copy 失败')
  } finally {
    document.body.removeChild(ta)
  }
}

// ---- 本地缓存：进入页面先渲染缓存，再后台拉取最新 ----
const cacheKeyOf = (userId?: number) => `prompts-cache:${userId ?? 'anon'}`
function readCache(key: string): Prompt[] | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as Prompt[]) : null
  } catch {
    return null
  }
}
function writeCache(key: string, data: Prompt[]) {
  try {
    localStorage.setItem(key, JSON.stringify(data))
  } catch {
    /* 配额溢出等忽略，不影响主流程 */
  }
}

export default function PromptsPage() {
  const { message, notification } = App.useApp()
  const currentUser = useAuthStore((s) => s.user)
  const cacheKey = cacheKeyOf(currentUser?.id)

  const [keyword, setKeyword] = useState('')
  const [category, setCategory] = useState<string>()
  const [filterTags, setFilterTags] = useState<string[]>([])
  const [sortBy, setSortBy] = useState<SortKey>('lastUsed')

  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<Prompt | null>(null)
  const [draft, setDraft] = useState<PromptDraft | null>(null)
  const [aiConfigOpen, setAiConfigOpen] = useState(false)
  const [refineOpen, setRefineOpen] = useState(false)
  const [shareTarget, setShareTarget] = useState<Prompt | null>(null)
  const [shareAllOpen, setShareAllOpen] = useState(false)
  const [viewing, setViewing] = useState<Prompt | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  // 提示词列表：缓存优先渲染，后台静默刷新（不显示 loading），刷新到再通知
  const [prompts, setPrompts] = useState<Prompt[] | null>(() => readCache(cacheKey))
  const [initialLoading, setInitialLoading] = useState(false) // 无缓存的首次加载才显示
  const [refreshing, setRefreshing] = useState(false) // 右上角手动刷新才显示
  const mountedKeyRef = useRef('')

  const { data: tagOptions, refetch: refetchTags } = useQuery({
    queryKey: ['prompt-tags'],
    queryFn: promptsApi.tags,
  })
  const { data: aiConfig, refetch: refetchAiConfig } = useQuery({
    queryKey: ['ai-config'],
    queryFn: promptsApi.aiConfig,
  })

  /**
   * 拉取列表：
   * - 'mount'  进入页面：有缓存则不显示 loading，拿到数据后弹通知；无缓存才显示居中 loading
   * - 'manual' 点右上角刷新：显示遮罩 loading，不弹通知（loading 本身即反馈）
   * - 'silent' 增删改后回刷：不显示 loading、不弹通知
   */
  const fetchList = useCallback(
    async (mode: 'mount' | 'manual' | 'silent') => {
      const hadCache = readCache(cacheKey) != null
      if (mode === 'manual') setRefreshing(true)
      if (mode === 'mount' && !hadCache) setInitialLoading(true)
      try {
        const data = await promptsApi.list()
        setPrompts(data)
        writeCache(cacheKey, data)
        if (mode === 'mount' && hadCache) {
          notification.success({
            message: '数据已更新',
            description: '提示词列表已同步为最新',
            placement: 'topRight',
          })
        }
      } catch {
        // 错误已由 http 拦截器统一提示；保留缓存渲染，不清空
      } finally {
        if (mode === 'manual') setRefreshing(false)
        setInitialLoading(false)
      }
    },
    [cacheKey, notification],
  )

  // 进入页面（或切换用户）：缓存优先 + 后台刷新
  useEffect(() => {
    if (mountedKeyRef.current === cacheKey) return
    mountedKeyRef.current = cacheKey
    setPrompts(readCache(cacheKey))
    fetchList('mount')
  }, [cacheKey, fetchList])

  const reload = () => {
    refetchTags()
    fetchList('silent')
  }

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return (prompts ?? [])
      .filter((p) => !category || p.category === category)
      .filter((p) => !filterTags.length || filterTags.every((t) => p.tags.includes(t)))
      .filter(
        (p) =>
          !kw ||
          p.title.toLowerCase().includes(kw) ||
          p.content.toLowerCase().includes(kw) ||
          p.tags.some((t) => t.toLowerCase().includes(kw)),
      )
      .sort((a, b) => Number(b.favorite) - Number(a.favorite) || sorters[sortBy](a, b))
  }, [prompts, keyword, category, filterTags, sortBy])

  const copyPrompt = async (p: Prompt) => {
    try {
      await writeClipboard(p.content)
    } catch {
      message.error('复制失败，请手动选择文本复制')
      return
    }
    message.success('已复制到剪贴板')
    // 计数是副产品：仅对自己的提示词上报（共享来的归属他人，不计数）
    if (!isShared(p)) {
      promptsApi
        .use(p.id)
        .then(() => fetchList('silent'))
        .catch(() => {})
    }
  }

  const toggleFavorite = async (p: Prompt) => {
    await promptsApi.favorite(p.id, !p.favorite)
    reload()
  }

  const removePrompt = async (p: Prompt) => {
    await promptsApi.remove(p.id)
    message.success('已删除')
    reload()
  }

  const openCreate = () => {
    setEditing(null)
    setDraft(null)
    setEditorOpen(true)
  }
  const openEdit = (p: Prompt) => {
    setEditing(p)
    setDraft(null)
    setEditorOpen(true)
  }
  /** AI 提炼成功：关提炼弹窗，把草稿放进编辑弹窗确认 */
  const onDraft = (d: PromptDraft) => {
    setRefineOpen(false)
    setEditing(null)
    setDraft(d)
    setEditorOpen(true)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-wrap items-center gap-3 mb-4 shrink-0">
        <Search
          size="large"
          placeholder="搜索标题 / 内容 / 标签"
          allowClear
          className="flex-1 min-w-[200px]"
          onSearch={setKeyword}
          onChange={(e) => !e.target.value && setKeyword('')}
        />
        <Select
          size="large"
          placeholder="分类"
          allowClear
          className="w-32"
          value={category}
          onChange={setCategory}
          options={PROMPT_CATEGORIES.map((c) => ({ label: c, value: c }))}
        />
        <Select
          size="large"
          mode="multiple"
          placeholder="标签"
          allowClear
          className="min-w-[140px] max-w-[280px]"
          value={filterTags}
          onChange={setFilterTags}
          options={(tagOptions ?? []).map((t) => ({ label: t, value: t }))}
          maxTagCount="responsive"
        />
        <Segmented
          size="large"
          value={sortBy}
          onChange={(v) => setSortBy(v as SortKey)}
          options={[
            { label: '最近使用', value: 'lastUsed' },
            { label: '最常使用', value: 'useCount' },
            { label: '最新创建', value: 'createdAt' },
          ]}
        />
        <Tooltip title="刷新列表">
          <Button
            size="large"
            icon={<ReloadOutlined />}
            loading={refreshing}
            onClick={() => fetchList('manual')}
          />
        </Tooltip>
        <Tooltip title="把我的全部提示词一键分享给指定用户">
          <Button
            size="large"
            icon={<ShareAltOutlined />}
            onClick={() => setShareAllOpen(true)}
          >
            一键分享
          </Button>
        </Tooltip>
        <Tooltip title="把一段 AI 对话提炼成提示词">
          <Button size="large" icon={<RobotOutlined />} onClick={() => setRefineOpen(true)}>
            AI 提炼
          </Button>
        </Tooltip>
        <Tooltip title="AI 网关 / API Key 设置">
          <Button size="large" icon={<SettingOutlined />} onClick={() => setAiConfigOpen(true)} />
        </Tooltip>
        <Button size="large" type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新建提示词
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pr-1 relative">
        {initialLoading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <Spin size="large" />
          </div>
        ) : filtered.length === 0 ? (
          <Empty
            className="mt-20"
            description={
              prompts?.length ? '没有匹配的提示词' : '还没有提示词，点击右上角「新建提示词」开始收集'
            }
          />
        ) : (
          <div className="prompt-grid">
            {filtered.map((p) => {
              const shared = isShared(p)
              const expanded = expandedId === p.id
              return (
                <article
                  key={p.id}
                  className={`prompt-card${expanded ? ' prompt-card--expanded' : ''}`}
                >
                  <div className="prompt-card__inner">
                    {/* 头部：收藏 + 标题 + 共享标记 */}
                    <div className="prompt-card__head">
                      <div className="prompt-card__title-row">
                        {!shared && (
                          <span
                            className="prompt-card__star"
                            onClick={() => toggleFavorite(p)}
                            title={p.favorite ? '取消收藏' : '收藏置顶'}
                          >
                            {p.favorite ? <StarFilled /> : <StarOutlined />}
                          </span>
                        )}
                        <span
                          className="prompt-card__title"
                          onClick={() => setExpandedId(expanded ? null : p.id)}
                          title={p.title}
                        >
                          {p.title}
                        </span>
                      </div>
                      {shared ? (
                        <Tag color="purple" bordered={false} icon={<TeamOutlined />}>
                          共享
                        </Tag>
                      ) : (
                        !!p.sharedTo?.length && (
                          <Tooltip title={`已共享给 ${p.sharedTo.length} 人`}>
                            <Tag color="purple" bordered={false} icon={<TeamOutlined />}>
                              {p.sharedTo.length}
                            </Tag>
                          </Tooltip>
                        )
                      )}
                    </div>

                    {/* 分类 + 标签 */}
                    <div className="prompt-card__tags">
                      <Tag color="blue">{p.category}</Tag>
                      {p.tags.map((t) => (
                        <Tag key={t} bordered={false}>
                          {t}
                        </Tag>
                      ))}
                    </div>

                    {p.note && <div className="prompt-card__note">{p.note}</div>}

                    {/* 正文（点击标题展开 / 收起全文） */}
                    <Typography.Paragraph
                      className="prompt-card__content"
                      style={{ whiteSpace: 'pre-wrap' }}
                      ellipsis={expanded ? false : { rows: 5 }}
                    >
                      {p.content}
                    </Typography.Paragraph>

                    {/* 底部：统计 + 操作 */}
                    <div className="prompt-card__foot">
                      <span
                        className="prompt-card__stats"
                        title={`作者 ${p.authorName ?? p.ownerName ?? ''}`}
                      >
                        <UserOutlined />
                        {p.authorName ?? p.ownerName ?? '—'} · 已用 {p.useCount} 次
                        {p.lastUsedAt ? ` · ${dayjs(p.lastUsedAt).fromNow()}` : ''}
                      </span>
                      <div className="prompt-card__actions">
                        {shared && (
                          <Button
                            type="text"
                            size="small"
                            icon={<EyeOutlined />}
                            onClick={() => setViewing(p)}
                          >
                            查看
                          </Button>
                        )}
                        <Button
                          type="primary"
                          ghost
                          size="small"
                          icon={<CopyOutlined />}
                          onClick={() => copyPrompt(p)}
                        >
                          复制
                        </Button>
                        {!shared && (
                          <>
                            <Tooltip
                              title={
                                p.sharedTo?.length ? `已共享给 ${p.sharedTo.length} 人` : '共享给他人'
                              }
                            >
                              <Button
                                type="text"
                                size="small"
                                icon={<ShareAltOutlined />}
                                style={p.sharedTo?.length ? { color: '#722ed1' } : undefined}
                                onClick={() => setShareTarget(p)}
                              />
                            </Tooltip>
                            <Button
                              type="text"
                              size="small"
                              icon={<EditOutlined />}
                              onClick={() => openEdit(p)}
                            />
                            <Popconfirm
                              title={`删除「${p.title}」？`}
                              okText="删除"
                              cancelText="取消"
                              onConfirm={() => removePrompt(p)}
                            >
                              <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                            </Popconfirm>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}

        {refreshing && !initialLoading && (
          <div className="prompt-refresh-mask">
            <Spin size="large" />
          </div>
        )}
      </div>

      <PromptEditModal
        open={editorOpen}
        editing={editing}
        draft={draft}
        tagOptions={tagOptions ?? []}
        onClose={() => setEditorOpen(false)}
        onSuccess={() => {
          setEditorOpen(false)
          reload()
        }}
      />
      <ShareModal
        open={!!shareTarget}
        prompt={shareTarget}
        onClose={() => setShareTarget(null)}
        onSuccess={() => {
          setShareTarget(null)
          reload()
        }}
      />
      <ShareAllModal
        open={shareAllOpen}
        promptCount={(prompts ?? []).filter((p) => !isShared(p)).length}
        onClose={() => setShareAllOpen(false)}
        onSuccess={() => {
          setShareAllOpen(false)
          reload()
        }}
      />
      <PromptViewModal
        open={!!viewing}
        prompt={viewing}
        onCopy={copyPrompt}
        onClose={() => setViewing(null)}
      />
      <AiConfigModal
        open={aiConfigOpen}
        onClose={() => {
          setAiConfigOpen(false)
          refetchAiConfig()
        }}
      />
      <AiRefineModal
        open={refineOpen}
        aiConfigured={!!aiConfig?.configured}
        onClose={() => setRefineOpen(false)}
        onDraft={onDraft}
        onNeedConfig={() => {
          setRefineOpen(false)
          setAiConfigOpen(true)
        }}
      />
    </div>
  )
}
