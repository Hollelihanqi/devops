import { useState, useEffect, useRef } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import {
  Input,
  Card,
  Row,
  Col,
  Tree,
  Tag,
  Button,
  Empty,
  Spin,
  Segmented,
  Drawer,
  Grid,
  Tooltip,
  Alert,
  App,
  Select,
  Avatar,
  theme,
} from 'antd'
import {
  StarFilled,
  StarOutlined,
  RocketOutlined,
  HistoryOutlined,
  ApartmentOutlined,
  FileAddOutlined,
  ReloadOutlined,
  RobotOutlined,
  SendOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { projectsApi } from '@/api/projects'
import { useModelChoice } from '@/components/useModelChoice'
import { useAuthStore } from '@/stores/auth'
import type { GroupNode, ProjectItem, DeployStatus, Paginated } from '@/api/types'
import DeployModal from '@/features/deploy/DeployModal'
import ProjectChatDrawer from '@/features/projects/ProjectChatDrawer'

const { Search } = Input
const { useBreakpoint } = Grid

const statusColor: Record<DeployStatus, string> = {
  pending: 'default',
  running: 'processing',
  success: 'success',
  failed: 'error',
  canceled: 'warning',
}
const statusText: Record<DeployStatus, string> = {
  pending: '等待中',
  running: '部署中',
  success: '成功',
  failed: '失败',
  canceled: '已取消',
}

/** 项目类型标签配色（识别不出时后端不返回 kind，卡片不显示） */
const kindColor: Record<string, string> = {
  Vue: 'green',
  React: 'blue',
  小程序: 'cyan',
  Java: 'orange',
  Go: 'geekblue',
  Python: 'gold',
  'Node.js': 'lime',
}

/** 默认 CI 模板：与部署中心触发模型匹配（创建流水线后自动 play 入口 manual job） */
const DEFAULT_CI_TEMPLATE = `# 由部署中心生成的 GitLab CI/CD 模板
# 部署中心触发流程：创建流水线 → 自动执行入口 manual job（stage=build 或名称 build_*/deploy*）
stages:
  - build
  - deploy

build:
  stage: build
  when: manual
  script:
    - echo "TODO: 构建命令，例如 pnpm install && pnpm build"

deploy:
  stage: deploy
  script:
    - echo "TODO: 部署命令，例如 rsync / scp / docker"
`

/** CI 配置抽屉：选基准分支 → AI 生成/编辑 yml → 校验 → 选提交方式（直接提交 / 新建分支+MR）确认 */
function CiConfigDrawer({
  project,
  open,
  onClose,
  onSuccess,
}: {
  project: ProjectItem
  open: boolean
  onClose: () => void
  onSuccess: () => void
}) {
  const { message } = App.useApp()
  const { models, model, setModel } = useModelChoice('ci-config')
  // targetBranch：要让 yml 最终生效的分支（也是读现有 yml / AI 基准 / MR 目标）
  const [targetBranch, setTargetBranch] = useState(project.defaultBranch)
  const [content, setContent] = useState('')
  const [loadingContent, setLoadingContent] = useState(false)
  // 左侧 AI 对话历史（仅前端展示）；每轮把右侧当前草稿作为 base 回传后端，实现「在这版上接着改」
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([])
  const [input, setInput] = useState('')
  const [generating, setGenerating] = useState(false)
  const [lintResult, setLintResult] = useState<{ valid: boolean; errors: string[]; warnings: string[] } | null>(null)
  const [linting, setLinting] = useState(false)
  const [mode, setMode] = useState<'commit' | 'merge_request'>('commit')
  const [newBranch, setNewBranch] = useState('ci/update-gitlab-ci')
  const [commitMessage, setCommitMessage] = useState('chore: 配置 .gitlab-ci.yml（部署中心）')
  const [submitting, setSubmitting] = useState(false)

  const { data: branches } = useQuery({
    queryKey: ['branches', project.gitlabProjectId],
    queryFn: () => projectsApi.branches(project.gitlabProjectId),
  })
  const branchMeta = branches?.find((b) => b.name === targetBranch)
  const isProtected = !!branchMeta?.protected
  // 用户手动切过提交方式后，不再被「受保护分支自动切 MR」覆盖（解决切不回去）
  const modeTouched = useRef(false)

  // 切换基准分支：加载该分支现有 yml（无则用模板）；受保护分支自动建议「新建分支+MR」
  useEffect(() => {
    let alive = true
    setLoadingContent(true)
    setLintResult(null)
    setMessages([])
    projectsApi
      .getCiConfig(project.gitlabProjectId, targetBranch)
      .then((r) => {
        if (!alive) return
        setContent(r.exists ? r.content : DEFAULT_CI_TEMPLATE)
      })
      .catch(() => alive && setContent(DEFAULT_CI_TEMPLATE))
      .finally(() => alive && setLoadingContent(false))
    return () => {
      alive = false
    }
  }, [project.gitlabProjectId, targetBranch])

  // 受保护分支「建议」切到 MR 模式，但仅在用户没手动改过时生效（可自由撤回）
  useEffect(() => {
    if (!modeTouched.current) setMode(isProtected ? 'merge_request' : 'commit')
  }, [isProtected])

  // 发送一轮：可空（空=让 AI 按项目自动生成/再优化一遍）。把右侧草稿作 base 传后端 → 多轮精修。
  const send = async () => {
    if (generating) return
    const req = input.trim()
    const hadDraft = content.trim().length > 0
    setMessages((prev) => [...prev, { role: 'user', content: req || '（按项目自动生成 / 优化）' }])
    setInput('')
    setGenerating(true)
    setLintResult(null)
    try {
      const r = await projectsApi.generateCiConfig(project.gitlabProjectId, {
        ref: targetBranch,
        requirement: req || undefined,
        model,
        base: content.trim() || undefined,
      })
      setContent(r.content)
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: hadDraft
            ? '已在当前配置基础上更新，请查看右侧 YAML 并按需继续提要求。'
            : '已生成配置，请查看右侧 YAML；可继续输入要求让我接着优化。',
        },
      ])
    } catch {
      // http 拦截器已弹错误；回滚刚发的用户气泡并恢复输入，便于重试
      setMessages((prev) => prev.slice(0, -1))
      setInput(req)
    } finally {
      setGenerating(false)
    }
  }

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const lint = async () => {
    if (!content.trim()) {
      message.warning('CI 配置内容不能为空')
      return
    }
    setLinting(true)
    try {
      const r = await projectsApi.lintCiConfig(project.gitlabProjectId, content)
      setLintResult(r)
      if (r.valid) message.success('语法校验通过')
      else message.error('语法校验未通过，请查看下方错误')
    } finally {
      setLinting(false)
    }
  }

  const submit = async () => {
    if (!content.trim()) {
      message.warning('CI 配置内容不能为空')
      return
    }
    if (mode === 'merge_request' && !newBranch.trim()) {
      message.warning('请填写新分支名')
      return
    }
    setSubmitting(true)
    try {
      const r = await projectsApi.commitCiConfig(project.gitlabProjectId, {
        content,
        mode,
        targetBranch,
        newBranch: mode === 'merge_request' ? newBranch.trim() : undefined,
        commitMessage: commitMessage.trim() || undefined,
        mrTitle: commitMessage.trim() || undefined,
      })
      if (r.mergeRequestUrl) {
        message.success('已创建合并请求')
        window.open(r.mergeRequestUrl, '_blank', 'noopener,noreferrer')
      } else {
        message.success(`已提交到分支 ${r.committedBranch}`)
      }
      onSuccess()
    } finally {
      setSubmitting(false)
    }
  }

  const branchOptions = (branches ?? []).map((b) => ({
    value: b.name,
    label: `${b.name}${b.default ? ' · 默认' : ''}${b.protected ? ' · 受保护' : ''}`,
  }))

  return (
    <Drawer
      title={`CI 配置 · ${project.name}`}
      open={open}
      onClose={onClose}
      width="min(1180px, 96vw)"
      destroyOnClose
      styles={{ body: { display: 'flex', flexDirection: 'column' } }}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>取消</Button>
          <Button onClick={lint} loading={linting}>
            校验语法
          </Button>
          <Button type="primary" loading={submitting} onClick={submit}>
            {mode === 'merge_request' ? '提交并创建 MR' : '提交到仓库'}
          </Button>
        </div>
      }
    >
      {/* 顶部：基准分支 + 模型（生成结果的提交目标 / AI 上下文基准） */}
      <div className="flex flex-wrap items-center gap-2 mb-3 shrink-0">
        <span className="text-xs text-gray-500">基准分支</span>
        <Select
          size="small"
          style={{ minWidth: 180 }}
          showSearch
          value={targetBranch}
          options={branchOptions}
          onChange={setTargetBranch}
        />
        <span className="text-xs text-gray-500 ml-2">模型</span>
        <Select
          size="small"
          style={{ minWidth: 150 }}
          value={model}
          onChange={setModel}
          options={models.map((m) => ({ value: m.id, label: m.label }))}
        />
      </div>

      {/* 主体：左 AI 对话配置 / 右 YAML 结果 */}
      <div className="flex-1 min-h-0 flex gap-3">
        {/* 左：AI 多轮对话 */}
        <div className="flex flex-col min-h-0" style={{ flex: '0 0 42%' }}>
          <div className="text-xs text-gray-500 mb-2 shrink-0 flex items-center gap-1">
            <RobotOutlined style={{ color: '#1677ff' }} /> AI 对话配置（可逐步精修）
          </div>

          {/* 已有对话：上方滚动气泡区；尚未开始：让输入框撑满，不浪费空间 */}
          {messages.length > 0 && (
            <div
              className="flex-1 min-h-0 overflow-y-auto rounded-lg p-3 mb-2"
              style={{ background: 'rgba(0,0,0,0.02)', scrollbarGutter: 'stable' }}
            >
              <div className="flex flex-col gap-3">
                {messages.map((m, i) => (
                  <CiChatBubble key={i} role={m.role} content={m.content} />
                ))}
                {generating && (
                  <div className="flex gap-2 items-start">
                    <Avatar size="small" icon={<RobotOutlined />} style={{ background: '#1677ff' }} />
                    <div className="bg-white rounded-lg px-3 py-2 text-gray-400 text-sm">
                      <Spin size="small" /> <span className="ml-2">AI 配置中…</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {messages.length === 0 ? (
            // 未开始：输入框占据整列高度，更聚焦也更美观
            <div className="flex-1 min-h-0 flex flex-col">
              <Input.TextArea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onInputKeyDown}
                disabled={generating}
                className="flex-1"
                style={{ height: '100%', resize: 'none' }}
                placeholder={
                  '例：Vue 项目，node22 pnpm11，部署到 10.0.1.5 的 /opt/app，端口 8080，develop 为测试环境\n\n' +
                  '可留空直接开始；生成后可继续说「加一个 test 阶段」逐步精修（Enter 发送 / Shift+Enter 换行）'
                }
              />
              <Button
                className="mt-2 shrink-0"
                block
                type="primary"
                icon={<SendOutlined />}
                loading={generating}
                onClick={send}
              >
                开始配置
              </Button>
            </div>
          ) : (
            <div className="shrink-0">
              <Input.TextArea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onInputKeyDown}
                autoSize={{ minRows: 3, maxRows: 8 }}
                disabled={generating}
                placeholder="继续说「加一个 test 阶段」逐步精修（Enter 发送 / Shift+Enter 换行）"
              />
              <Button
                className="mt-2"
                block
                type="primary"
                icon={<SendOutlined />}
                loading={generating}
                onClick={send}
              >
                继续优化
              </Button>
            </div>
          )}
        </div>

        {/* 右：YAML 结果（可手动编辑） */}
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          <div className="text-xs text-gray-500 mb-2 shrink-0">.gitlab-ci.yml（AI 结果，可手动编辑）</div>
          <div className="flex-1 min-h-0 relative">
            {(loadingContent || generating) && (
              <div
                className="absolute inset-0 z-10 flex items-center justify-center"
                style={{ background: 'rgba(255,255,255,0.6)' }}
              >
                <Spin tip={generating ? 'AI 生成中…' : '加载中…'} />
              </div>
            )}
            <Input.TextArea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              style={{ height: '100%', resize: 'none', fontFamily: 'monospace', fontSize: 12 }}
            />
          </div>
        </div>
      </div>

      {/* 校验结果 */}
      {lintResult && (
        <Alert
          className="mt-3 shrink-0"
          type={lintResult.valid ? 'success' : 'error'}
          showIcon
          message={lintResult.valid ? '语法校验通过' : '语法校验未通过'}
          description={
            !lintResult.valid && lintResult.errors?.length ? (
              <ul className="m-0 pl-4">
                {lintResult.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            ) : undefined
          }
        />
      )}

      {/* ③ 提交方式 */}
      <div className="mt-3 shrink-0">
        <Segmented
          size="small"
          value={mode}
          onChange={(v) => {
            modeTouched.current = true
            setMode(v as 'commit' | 'merge_request')
          }}
          options={[
            { label: '直接提交到分支', value: 'commit' },
            { label: '新建分支 + MR', value: 'merge_request' },
          ]}
        />
        {isProtected && mode === 'commit' && (
          <Alert
            className="mt-2"
            type="warning"
            showIcon
            message={`「${targetBranch}」是受保护分支，开发者通常无直接推送权限，建议改用「新建分支 + MR」`}
          />
        )}
        {mode === 'merge_request' && (
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs text-gray-500 whitespace-nowrap">新分支名</span>
            <Input
              size="small"
              value={newBranch}
              onChange={(e) => setNewBranch(e.target.value)}
              placeholder="ci/update-gitlab-ci"
            />
            <span className="text-xs text-gray-400 whitespace-nowrap">→ 合并到 {targetBranch}</span>
          </div>
        )}
        <Input
          size="small"
          className="mt-2"
          addonBefore={mode === 'merge_request' ? 'MR / Commit 标题' : 'Commit 信息'}
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
        />
      </div>
    </Drawer>
  )
}

/** CI 配置对话气泡（左侧 AI 对话区） */
function CiChatBubble({ role, content }: { role: 'user' | 'assistant'; content: string }) {
  const isUser = role === 'user'
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
            background: isUser ? '#e6f4ff' : '#fff',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {content}
        </div>
      </div>
    </div>
  )
}

// ---- 本地缓存：进入页面/刷新/重新登录先渲染缓存，再后台拉取最新（不等接口） ----
function readJsonCache<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : undefined
  } catch {
    return undefined
  }
}
function writeJsonCache(key: string, data: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(data))
  } catch {
    /* 配额溢出等忽略，不影响主流程 */
  }
}

function groupToTreeData(nodes: GroupNode[]): any[] {
  return nodes.map((n) => ({
    title: n.name,
    key: String(n.gitlabGroupId),
    children: n.children ? groupToTreeData(n.children) : undefined,
  }))
}

/** 收集所有分组节点 key（含根「全部项目」），用于默认全部展开 */
function collectKeys(nodes: GroupNode[]): string[] {
  return nodes.flatMap((n) => [String(n.gitlabGroupId), ...collectKeys(n.children ?? [])])
}

export default function ProjectsPage() {
  const navigate = useNavigate()
  const screens = useBreakpoint()
  // 仅当确实命中移动断点才用移动布局；首帧 screens 为空对象时按桌面渲染，
  // 避免 useBreakpoint 解析前后由「移动→桌面」造成的整页布局抖动
  const isMobile = screens.lg === false
  const [groupId, setGroupId] = useState<number | undefined>()
  const [keyword, setKeyword] = useState('')
  const [onlyFavorite, setOnlyFavorite] = useState(false)
  const [treeOpen, setTreeOpen] = useState(false)
  const [deployTarget, setDeployTarget] = useState<ProjectItem | null>(null)
  const [ciTarget, setCiTarget] = useState<ProjectItem | null>(null)
  const [chatTarget, setChatTarget] = useState<ProjectItem | null>(null)
  const { token: themeToken } = theme.useToken()
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>(['all'])
  const userId = useAuthStore((s) => s.user?.id)
  const groupsCacheKey = `groups-cache:${userId ?? 'anon'}`
  // 项目列表缓存按「分组 + 收藏筛选」分桶；带关键词的搜索结果不入缓存
  const projectsCacheKey = `projects-cache:${userId ?? 'anon'}:${groupId ?? 'all'}:${onlyFavorite ? 'fav' : 'all'}`

  const { data: groups } = useQuery({
    queryKey: ['groups'],
    queryFn: projectsApi.groupTree,
    initialData: () => readJsonCache<GroupNode[]>(groupsCacheKey),
    initialDataUpdatedAt: 0, // 标记缓存为「陈旧」，挂载后台仍会拉一次最新
  })
  // 拉到最新分组后回写缓存
  useEffect(() => {
    if (groups) writeJsonCache(groupsCacheKey, groups)
  }, [groups, groupsCacheKey])

  // 分组数据异步到达后，默认全部展开（用户仍可手动折叠）
  useEffect(() => {
    if (groups?.length) setExpandedKeys(['all', ...collectKeys(groups)])
  }, [groups])
  // 点击刷新按钮时置 true：下一次请求绕过后端 CI 检测缓存，用完即复位
  const freshRef = useRef(false)
  // 仅"手动点刷新"才显示 loading 遮罩；切换菜单回来时的后台刷新静默走缓存，不闪 loading
  const [manualRefreshing, setManualRefreshing] = useState(false)
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['projects', groupId, keyword, onlyFavorite],
    queryFn: () => {
      const fresh = freshRef.current
      freshRef.current = false
      return projectsApi.list({ groupId, keyword, onlyFavorite, pageSize: 60, fresh })
    },
    // 无关键词时用缓存先渲染（标陈旧→后台仍刷新）；关键词搜索每次实时拉取
    initialData: () =>
      keyword ? undefined : readJsonCache<Paginated<ProjectItem>>(projectsCacheKey),
    initialDataUpdatedAt: 0,
    // 切换分组 / 搜索 / 收藏筛选导致 queryKey 变化时，保留上一次结果直到新数据到达，
    // 不再出现「列表清空→Spin→重渲染」的闪动；新数据返回后无缝替换
    placeholderData: keepPreviousData,
  })
  // 拉到最新列表后回写缓存（仅缓存无关键词的默认视图）
  useEffect(() => {
    if (!keyword && data) writeJsonCache(projectsCacheKey, data)
  }, [data, keyword, projectsCacheKey])

  const toggleFavorite = async (p: ProjectItem) => {
    await projectsApi.favorite(p.id, !p.favorite)
    refetch()
  }

  const tree = (
    <Tree
      treeData={[{ title: '全部项目', key: 'all', children: groupToTreeData(groups ?? []) }]}
      expandedKeys={expandedKeys}
      onExpand={setExpandedKeys}
      selectedKeys={groupId ? [String(groupId)] : ['all']}
      onSelect={(keys) => {
        const k = keys[0] as string
        setGroupId(k === 'all' || !k ? undefined : Number(k))
        setTreeOpen(false)
      }}
    />
  )

  return (
    <Row gutter={16} wrap={false} className="projects-workspace h-full min-h-0">
      {!isMobile && (
        <Col flex="240px" className="h-full">
          <Card
            size="small"
            title="项目分组"
            className="project-group-card h-full"
            styles={{ body: { padding: 8, overflow: 'auto', height: 'calc(100% - 39px)' } }}
          >
            {tree}
          </Card>
        </Col>
      )}

      <Col flex="auto" className="project-list-panel min-w-0 h-full">
        <div className="flex flex-col h-full">
          <div className="flex flex-wrap items-center gap-3 mb-4 shrink-0">
            {isMobile && (
              <Button
                size="large"
                icon={<ApartmentOutlined />}
                onClick={() => setTreeOpen(true)}
              >
                分组
              </Button>
            )}
            <Search
              size="large"
              placeholder="搜索项目名称 / 路径"
              allowClear
              className="flex-1 min-w-[180px]"
              onSearch={setKeyword}
              onChange={(e) => !e.target.value && setKeyword('')}
            />
            <Segmented
              size="large"
              value={onlyFavorite ? 'fav' : 'all'}
              onChange={(v) => setOnlyFavorite(v === 'fav')}
              options={[
                { label: '全部', value: 'all' },
                { label: '收藏', value: 'fav' },
              ]}
            />
            <Tooltip title="刷新项目列表（重新检测 CI 配置）">
              <Button
                size="large"
                icon={<ReloadOutlined />}
                loading={manualRefreshing}
                onClick={() => {
                  freshRef.current = true
                  setManualRefreshing(true)
                  refetch().finally(() => setManualRefreshing(false))
                }}
              />
            </Tooltip>
          </div>

          <div className="flex-1 min-h-0 relative">
            {/* 刷新时的 loading 盖在可视区域正中央，不随内容滚动（仅手动刷新触发） */}
            {manualRefreshing && (
              <div
                className="absolute inset-0 z-10 flex items-center justify-center"
                style={{ background: 'rgba(255, 255, 255, 0.6)' }}
              >
                <Spin size="large" />
              </div>
            )}
            <div
              className="h-full overflow-y-auto overflow-x-hidden pr-1"
              style={{ scrollbarGutter: 'stable' }}
            >
            {isLoading ? (
              <div className="h-full flex items-center justify-center">
                <Spin size="large" />
              </div>
            ) : data && data.list.length === 0 ? (
              <Empty description="暂无项目" className="mt-20" />
            ) : (
                <Row gutter={[16, 16]} className="project-card-grid">
                  {data?.list.map((p) => (
                    <Col key={p.id} xs={24} sm={12} xl={8} xxl={6}>
                      <Card
                        hoverable
                        size="small"
                        className="project-card"
                        styles={{ body: { padding: 16 } }}
                        onClick={() =>
                          p.webUrl && window.open(p.webUrl, '_blank', 'noopener,noreferrer')
                        }
                        actions={[
                          <Tooltip
                            title={p.hasCiConfig ? '部署' : '未配置 CI/CD（.gitlab-ci.yml），无法部署'}
                            key="deploy"
                          >
                            <span
                              onClick={(e) => {
                                e.stopPropagation()
                                if (p.hasCiConfig) setDeployTarget(p)
                              }}
                              style={
                                p.hasCiConfig
                                  ? { color: themeToken.colorPrimary, fontWeight: 600 }
                                  : { color: '#bfbfbf', cursor: 'not-allowed' }
                              }
                            >
                              <RocketOutlined /> 部署
                            </span>
                          </Tooltip>,
                          <span
                            key="history"
                            onClick={(e) => {
                              e.stopPropagation()
                              navigate(`/history?projectId=${p.gitlabProjectId}`)
                            }}
                          >
                            <HistoryOutlined /> 历史
                          </span>,
                          <Tooltip title="针对该项目仓库代码提问" key="chat">
                            <span
                              onClick={(e) => {
                                e.stopPropagation()
                                setChatTarget(p)
                              }}
                            >
                              <RobotOutlined /> 问答
                            </span>
                          </Tooltip>,
                          <Tooltip
                            title={p.hasCiConfig ? 'AI 编辑 / 优化 .gitlab-ci.yml' : '为该项目创建 .gitlab-ci.yml'}
                            key="ci"
                          >
                            <span
                              onClick={(e) => {
                                e.stopPropagation()
                                setCiTarget(p)
                              }}
                            >
                              <FileAddOutlined /> CI 配置
                            </span>
                          </Tooltip>,
                        ]}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div
                              className="font-600 truncate"
                              title={p.webUrl ? `在 GitLab 打开：${p.name}` : p.name}
                            >
                              {p.name}
                            </div>
                            <div className="text-xs text-gray-400 truncate" title={p.pathWithNamespace}>
                              {p.pathWithNamespace}
                            </div>
                          </div>
                          <span
                            className="cursor-pointer text-amber-400"
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleFavorite(p)
                            }}
                          >
                            {p.favorite ? <StarFilled /> : <StarOutlined />}
                          </span>
                        </div>
                        <div className="project-card-tags mt-3 flex items-center gap-2">
                          {p.kind && (
                            <Tag color={kindColor[p.kind] ?? 'default'} bordered={false}>
                              {p.kind}
                            </Tag>
                          )}
                          <Tag>{p.defaultBranch}</Tag>
                          {p.lastDeploy && (
                            <Tag color={statusColor[p.lastDeploy.status]}>
                              {p.lastDeploy.env} · {statusText[p.lastDeploy.status]}
                            </Tag>
                          )}
                        </div>
                      </Card>
                    </Col>
                  ))}
                </Row>
            )}
            </div>
          </div>
        </div>
      </Col>

      <Drawer
        title="项目分组"
        placement="left"
        open={treeOpen}
        onClose={() => setTreeOpen(false)}
        width={260}
      >
        {tree}
      </Drawer>

      {ciTarget && (
        <CiConfigDrawer
          project={ciTarget}
          open={!!ciTarget}
          onClose={() => setCiTarget(null)}
          onSuccess={() => {
            setCiTarget(null)
            refetch()
          }}
        />
      )}

      {deployTarget && (
        <DeployModal
          project={deployTarget}
          open={!!deployTarget}
          onClose={() => setDeployTarget(null)}
          onSuccess={(deploymentId) => {
            setDeployTarget(null)
            navigate(`/deployments/${deploymentId}`)
          }}
        />
      )}

      {chatTarget && (
        <ProjectChatDrawer
          project={chatTarget}
          open={!!chatTarget}
          onClose={() => setChatTarget(null)}
        />
      )}
    </Row>
  )
}
