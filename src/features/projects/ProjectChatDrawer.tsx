import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Drawer,
  Input,
  Button,
  Avatar,
  Spin,
  Empty,
  Alert,
  Tag,
  Tooltip,
  Select,
  App,
  Modal,
  Popconfirm,
} from 'antd'
import {
  RobotOutlined,
  UserOutlined,
  SendOutlined,
  PlusOutlined,
  BranchesOutlined,
  DeleteOutlined,
  EditOutlined,
  BulbOutlined,
} from '@ant-design/icons'
import { projectsApi } from '@/api/projects'
import { promptsApi } from '@/api/prompts'
import { useModelChoice } from '@/components/useModelChoice'
import type { ChatMessage, ConversationSummary, ProjectItem } from '@/api/types'
import { AiConfigModal } from '@/features/prompts/AiModals'

interface ChatTurn extends ChatMessage {
  /** 助手回答时实际读到的仓库文件 */
  usedFiles?: string[]
}

/** 默认提示词：进入空白对话时展示，点一下即直接提问 */
const PRESET_QUESTIONS = [
  '这个项目用的是什么技术栈？',
  '帮我梳理整体目录结构和各模块职责',
  '项目的入口文件和启动流程是怎样的？',
  '登录鉴权逻辑在哪些文件里，是怎么实现的？',
  '项目对外暴露了哪些接口（API），分别做什么？',
  '如何在本地把这个项目跑起来？',
]

/** 项目仓库代码问答抽屉：针对当前项目仓库代码的 AI 问答（Agent 工具循环 + 会话历史 + 长期记忆） */
export default function ProjectChatDrawer({
  project,
  open,
  onClose,
  initialInput,
  initialRef,
}: {
  project: ProjectItem
  open: boolean
  onClose: () => void
  /** 打开时预填到输入框的问题（如从失败诊断「带入代码问答」） */
  initialInput?: string
  /** 打开时默认选中的分支（默认仓库默认分支） */
  initialRef?: string
}) {
  const { message } = App.useApp()
  const qc = useQueryClient()
  const [convId, setConvId] = useState<number | null>(null)
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [configOpen, setConfigOpen] = useState(false)
  const [renaming, setRenaming] = useState<ConversationSummary | null>(null)
  const [renameText, setRenameText] = useState('')
  const { models, model, setModel } = useModelChoice('project-chat')
  // 问答所基于的分支：默认仓库默认分支，用户可切换到任意分支
  const [ref, setRef] = useState(project.defaultBranch)
  const listRef = useRef<HTMLDivElement>(null)

  const { data: aiConfig } = useQuery({
    queryKey: ['ai-config'],
    queryFn: promptsApi.aiConfig,
    enabled: open,
  })

  const { data: branches } = useQuery({
    queryKey: ['project-branches', project.gitlabProjectId],
    queryFn: () => projectsApi.branches(project.gitlabProjectId),
    enabled: open,
  })

  const convKey = ['project-conversations', project.gitlabProjectId]
  const { data: conversations } = useQuery({
    queryKey: convKey,
    queryFn: () => projectsApi.conversations(project.gitlabProjectId),
    enabled: open,
  })

  // 重新打开抽屉时复位到「新对话」状态；带入的问题/分支预填到输入框
  useEffect(() => {
    if (open) {
      setConvId(null)
      setTurns([])
      setRef(initialRef || project.defaultBranch)
      setInput(initialInput ?? '')
    }
  }, [open, project.defaultBranch, initialInput, initialRef])

  // 新消息到达后滚到底部
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns, loading])

  /** 切到全新对话 */
  const startNew = () => {
    if (loading) return
    setConvId(null)
    setTurns([])
    setRef(project.defaultBranch)
  }

  /** 载入某条历史会话续聊 */
  const openConversation = async (id: number) => {
    if (loading || id === convId) return
    try {
      const detail = await projectsApi.conversation(id)
      setConvId(detail.id)
      setTurns(detail.messages.map((m) => ({ role: m.role, content: m.content, usedFiles: m.usedFiles })))
      setRef(detail.ref || project.defaultBranch)
      if (detail.model) setModel(detail.model)
    } catch {
      // http 拦截器已提示
    }
  }

  /** 发送指定文本（输入框发送与默认提示词点击共用） */
  const submitQuestion = async (raw: string) => {
    const text = raw.trim()
    if (!text || loading) return
    if (!aiConfig?.configured) {
      message.warning('尚未配置 AI 网关 API Key，请先在「AI 设置」中配置')
      setConfigOpen(true)
      return
    }
    setTurns((prev) => [...prev, { role: 'user', content: text }])
    setInput('')
    setLoading(true)
    try {
      const res = await projectsApi.chat(project.gitlabProjectId, {
        conversationId: convId ?? undefined,
        question: text,
        model,
        ref,
      })
      setConvId(res.conversationId)
      setTurns((prev) => [...prev, { role: 'assistant', content: res.answer, usedFiles: res.usedFiles }])
      // 刷新左侧会话列表（新会话出现 / 已有会话顺序与时间更新）
      qc.invalidateQueries({ queryKey: convKey })
    } catch {
      // http 拦截器已弹错误提示；失败时回滚刚发出的用户消息，便于重发
      setTurns((prev) => prev.slice(0, -1))
      setInput(text)
    } finally {
      setLoading(false)
    }
  }

  const send = () => submitQuestion(input)

  /** 删除会话 */
  const removeConversation = async (id: number) => {
    try {
      await projectsApi.deleteConversation(id)
      message.success('已删除会话')
      if (id === convId) startNew()
      qc.invalidateQueries({ queryKey: convKey })
    } catch {
      // 已提示
    }
  }

  /** 提交重命名 */
  const submitRename = async () => {
    if (!renaming) return
    const title = renameText.trim()
    if (!title) return
    try {
      await projectsApi.renameConversation(renaming.id, title)
      setRenaming(null)
      qc.invalidateQueries({ queryKey: convKey })
    } catch {
      // 已提示
    }
  }

  // 分支下拉项：以接口返回为准，并保证当前选中分支始终在列（接口未回来时也能用）
  const branchOptions = (() => {
    const names = branches?.map((b) => b.name) ?? []
    if (ref && !names.includes(ref)) names.unshift(ref)
    return names.map((n) => ({ value: n, label: n }))
  })()

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter 发送，Shift+Enter 换行
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <Drawer
      title={
        <div className="flex items-center gap-2 min-w-0">
          <RobotOutlined style={{ color: '#1677ff' }} />
          <span className="truncate">代码问答 · {project.name}</span>
          <Tooltip title="开启了项目长期记忆：每轮问答会自动沉淀仓库要点，新对话自动带上，越聊越懂这个项目">
            <Tag icon={<BulbOutlined />} color="gold" className="m-0" style={{ fontSize: 11 }}>
              记忆
            </Tag>
          </Tooltip>
        </div>
      }
      open={open}
      onClose={onClose}
      width="min(1100px, 96vw)"
      destroyOnClose
      styles={{ body: { display: 'flex', flexDirection: 'row', padding: 0 } }}
    >
      {/* 左侧：会话历史 */}
      <div className="w-[240px] shrink-0 border-r border-gray-100 flex flex-col bg-gray-50/40">
        <div className="p-3">
          <Button type="primary" block icon={<PlusOutlined />} disabled={loading} onClick={startNew}>
            新对话
          </Button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
          {conversations?.length ? (
            <div className="flex flex-col gap-1">
              {conversations.map((c) => (
                <div
                  key={c.id}
                  onClick={() => openConversation(c.id)}
                  className={`group cursor-pointer rounded-md px-2 py-2 text-sm transition-colors ${
                    c.id === convId ? 'bg-blue-50 text-blue-600' : 'hover:bg-gray-100 text-gray-700'
                  }`}
                >
                  <div className="flex items-center gap-1">
                    <span className="truncate flex-1">{c.title}</span>
                    <EditOutlined
                      className="opacity-0 group-hover:opacity-60 hover:!opacity-100 text-xs"
                      onClick={(e) => {
                        e.stopPropagation()
                        setRenaming(c)
                        setRenameText(c.title)
                      }}
                    />
                    <Popconfirm
                      title="删除这个会话？"
                      okText="删除"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => removeConversation(c.id)}
                    >
                      <DeleteOutlined
                        className="opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:!text-red-500 text-xs"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </Popconfirm>
                  </div>
                  <div className="text-[11px] text-gray-400 mt-0.5 flex items-center gap-1">
                    <BranchesOutlined />
                    <span className="truncate">{c.ref}</span>
                    <span className="ml-auto">{new Date(c.updatedAt).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-xs text-gray-400 mt-8">还没有历史会话</div>
          )}
        </div>
      </div>

      {/* 右侧：对话区 */}
      <div className="flex-1 min-w-0 flex flex-col">
        {!aiConfig?.configured && (
          <Alert
            type="warning"
            showIcon
            banner
            message={
              <span>
                尚未配置 AI 网关 API Key，<a onClick={() => setConfigOpen(true)}>去配置</a>
              </span>
            }
          />
        )}

        <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
          {turns.length === 0 && !loading ? (
            <div className="mt-12 flex flex-col items-center">
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <span className="text-gray-400">问我关于「{project.name}」仓库代码的任何问题</span>
                }
              />
              <div className="mt-5 w-full max-w-[560px]">
                <div className="text-xs text-gray-400 mb-2 text-center">点击下面的问题快速开始：</div>
                <div className="flex flex-wrap gap-2 justify-center">
                  {PRESET_QUESTIONS.map((q) => (
                    <Button key={q} size="small" disabled={loading} onClick={() => submitQuestion(q)}>
                      {q}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {turns.map((t, i) => (
                <ChatBubble key={i} turn={t} />
              ))}
              {loading && (
                <div className="flex gap-2 items-start">
                  <Avatar size="small" icon={<RobotOutlined />} style={{ background: '#1677ff' }} />
                  <div className="bg-gray-50 rounded-lg px-3 py-2 text-gray-400 text-sm">
                    <Spin size="small" /> <span className="ml-2">正在浏览仓库、读取代码并思考…</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-gray-100 p-3 shrink-0">
          <Input.TextArea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="输入问题，Enter 发送 / Shift+Enter 换行"
            autoSize={{ minRows: 5, maxRows: 12 }}
            maxLength={8000}
            disabled={loading}
          />
          <div className="flex items-center gap-2 mt-2">
            <Tooltip title="选择要问答的分支">
              <Select
                size="middle"
                value={ref}
                onChange={setRef}
                disabled={loading}
                showSearch
                optionFilterProp="value"
                style={{ minWidth: 160 }}
                suffixIcon={<BranchesOutlined />}
                options={branchOptions}
                placeholder="选择分支"
              />
            </Tooltip>
            <Select
              size="middle"
              value={model}
              onChange={setModel}
              disabled={loading}
              style={{ minWidth: 180 }}
              options={models.map((m) => ({ value: m.id, label: m.label }))}
              placeholder="选择模型"
            />
            <div className="flex-1" />
            <Button type="primary" icon={<SendOutlined />} loading={loading} onClick={send}>
              发送
            </Button>
          </div>
        </div>
      </div>

      <AiConfigModal open={configOpen} onClose={() => setConfigOpen(false)} />
      <Modal
        title="重命名会话"
        open={!!renaming}
        onOk={submitRename}
        onCancel={() => setRenaming(null)}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Input
          value={renameText}
          onChange={(e) => setRenameText(e.target.value)}
          onPressEnter={submitRename}
          maxLength={60}
          placeholder="会话标题"
        />
      </Modal>
    </Drawer>
  )
}

/** 单条消息气泡 */
function ChatBubble({ turn }: { turn: ChatTurn }) {
  const isUser = turn.role === 'user'
  return (
    <div className={`flex gap-2 items-start ${isUser ? 'flex-row-reverse' : ''}`}>
      <Avatar
        size="small"
        icon={isUser ? <UserOutlined /> : <RobotOutlined />}
        style={{ background: isUser ? '#52c41a' : '#1677ff', flexShrink: 0 }}
      />
      <div className={`min-w-0 max-w-[85%] ${isUser ? 'text-right' : ''}`}>
        <div
          className="rounded-lg px-3 py-2 text-sm text-left inline-block"
          style={{
            background: isUser ? '#e6f4ff' : '#f5f5f5',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {turn.content}
        </div>
        {!isUser && !!turn.usedFiles?.length && (
          <div className="mt-1 flex flex-wrap gap-1">
            <span className="text-xs text-gray-400">读过的文件：</span>
            {turn.usedFiles.map((f) => (
              <Tag key={f} className="m-0 text-xs" style={{ fontSize: 11 }}>
                {f}
              </Tag>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
