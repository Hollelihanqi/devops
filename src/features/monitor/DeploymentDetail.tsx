import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Card, Descriptions, Tag, Button, Steps, Spin, Space, Select, Alert, App } from 'antd'
import {
  ArrowLeftOutlined,
  StopOutlined,
  RedoOutlined,
  RobotOutlined,
  BulbOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { deploymentsApi } from '@/api/deployments'
import { useModelChoice } from '@/components/useModelChoice'
import { useAuthStore } from '@/stores/auth'
import { PageContainer, PageBody } from '@/layout/PageContainer'
import type { DeployDiagnosis, DeployStatus, ProjectItem } from '@/api/types'
import ProjectChatDrawer from '@/features/projects/ProjectChatDrawer'

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
const stepStatus = (s: DeployStatus) =>
  s === 'success' ? 'finish' : s === 'failed' || s === 'canceled' ? 'error' : 'process'

/** 部署监控：实时状态 + 日志流（轮询；后端就绪后可切换 SSE streamUrl）+ AI 失败诊断 */
export default function DeploymentDetail() {
  const { id } = useParams()
  const deploymentId = Number(id)
  const navigate = useNavigate()
  const { message, modal } = App.useApp()
  const [log, setLog] = useState('')
  const offsetRef = useRef(0)
  const logBoxRef = useRef<HTMLPreElement>(null)

  // AI 诊断相关状态
  const { models, model, setModel } = useModelChoice('diagnose')
  const [diagnosing, setDiagnosing] = useState(false)
  const [diagnosis, setDiagnosis] = useState<DeployDiagnosis | null>(null)
  // 「带入代码问答」：非 null 时打开抽屉并预填问题
  const [chatInput, setChatInput] = useState<string | null>(null)

  // 重新部署后跳到新的部署详情（同组件实例），需清掉上一条的日志与诊断
  useEffect(() => {
    setLog('')
    offsetRef.current = 0
    setDiagnosis(null)
    setChatInput(null)
  }, [deploymentId])

  const { data, refetch } = useQuery({
    queryKey: ['deployment', deploymentId],
    queryFn: () => deploymentsApi.detail(deploymentId),
    refetchInterval: (q) => {
      const s = q.state.data?.status
      return s === 'running' || s === 'pending' ? 2500 : false
    },
  })

  const isFailed = data?.status === 'failed'

  // 失败部署：载入已缓存的诊断（有则直接展示，不重复烧 token）
  const { data: cachedDiagnosis } = useQuery({
    queryKey: ['diagnosis', deploymentId],
    queryFn: () => deploymentsApi.getDiagnosis(deploymentId),
    enabled: isFailed,
  })
  useEffect(() => {
    if (cachedDiagnosis !== undefined) setDiagnosis(cachedDiagnosis)
  }, [cachedDiagnosis])

  const running = data?.status === 'running' || data?.status === 'pending'
  const currentUser = useAuthStore((s) => s.user)
  // 仅部署发起人（或管理员）可取消
  const canCancel =
    running && (currentUser?.id === data?.triggeredByUserId || !!currentUser?.isAdmin)

  // 增量拉取日志
  useEffect(() => {
    if (!data) return
    let active = true
    const pull = async () => {
      try {
        const res = await deploymentsApi.logs(deploymentId, offsetRef.current)
        if (!active) return
        if (res.content) {
          setLog((prev) => prev + res.content)
          offsetRef.current = res.nextOffset
          requestAnimationFrame(() => {
            logBoxRef.current?.scrollTo(0, logBoxRef.current.scrollHeight)
          })
        }
      } catch {
        /* 静默，下一轮重试 */
      }
    }
    pull()
    const timer = running ? setInterval(pull, 2500) : undefined
    return () => {
      active = false
      if (timer) clearInterval(timer)
    }
  }, [deploymentId, running, data])

  const cancel = async () => {
    await deploymentsApi.cancel(deploymentId)
    message.success('已发送取消请求')
    refetch()
  }

  // 触发 / 重新诊断
  const runDiagnose = async () => {
    if (diagnosing) return
    setDiagnosing(true)
    try {
      const res = await deploymentsApi.diagnose(deploymentId, model)
      setDiagnosis(res)
    } catch {
      // http 拦截器已弹错误提示
    } finally {
      setDiagnosing(false)
    }
  }

  // 把某个涉及文件带入「代码问答」继续追问
  const askAboutFile = (file: string) => {
    const root = diagnosis?.rootCause ? `（诊断根因：${diagnosis.rootCause}）` : ''
    setChatInput(`结合文件 \`${file}\`，这次部署失败该如何修复？${root}`)
  }

  // 用本条记录相同的项目/环境/分支再触发一次部署（与历史列表「重新部署」一致）
  const redeploy = () => {
    if (!data) return
    modal.confirm({
      title: '重新部署？',
      content: `项目：${data.projectName}\n环境：${data.envCode}\n分支：${data.ref}`,
      okText: '重新部署',
      cancelText: '取消',
      onOk: async () => {
        const res = await deploymentsApi.create({
          projectId: data.gitlabProjectId,
          env: data.envCode,
          ref: data.ref,
        })
        message.success('已触发部署')
        navigate(`/deployments/${res.deploymentId}`)
      },
    })
  }

  if (!data) return <Spin className="mt-20 block mx-auto" />

  // 为代码问答抽屉构造最小项目对象（仅需 id/name/分支）
  const chatProject: ProjectItem = {
    id: data.gitlabProjectId,
    gitlabProjectId: data.gitlabProjectId,
    name: data.projectName,
    pathWithNamespace: '',
    webUrl: data.projectWebUrl,
    groupName: '',
    defaultBranch: data.ref,
    favorite: false,
    hasCiConfig: true,
  }

  return (
    <PageContainer>
      <PageBody>
        <Space direction="vertical" size={16} className="w-full">
          <div className="flex-between flex-wrap gap-2">
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>
          返回
        </Button>
        <Space>
          {!running && (
            <Button type="primary" icon={<RedoOutlined />} onClick={redeploy}>
              重新部署
            </Button>
          )}
          {canCancel && (
            <Button danger icon={<StopOutlined />} onClick={cancel}>
              取消部署
            </Button>
          )}
        </Space>
      </div>

      <Card>
        <Descriptions
          column={{ xs: 1, sm: 2, lg: 3 }}
          title={
            <Space>
              {data.projectName}
              <Tag color={statusColor[data.status]}>{statusText[data.status]}</Tag>
            </Space>
          }
        >
          <Descriptions.Item label="环境">{data.envCode}</Descriptions.Item>
          <Descriptions.Item label="分支">{data.ref}</Descriptions.Item>
          <Descriptions.Item label="触发人">{data.triggeredByName}</Descriptions.Item>
          <Descriptions.Item label="开始时间">
            {data.startedAt ? dayjs(data.startedAt).format('YYYY-MM-DD HH:mm:ss') : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="耗时">
            {data.durationSec ? `${data.durationSec}s` : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="Pipeline">#{data.gitlabPipelineId ?? '-'}</Descriptions.Item>
        </Descriptions>

        <Steps
          className="mt-4"
          status={stepStatus(data.status)}
          current={data.status === 'pending' ? 0 : data.status === 'success' ? 2 : 1}
          items={[{ title: '构建 build' }, { title: '部署 deploy' }, { title: '完成' }]}
        />
        {data.failReason && (
          <div className="mt-3 text-error">失败原因：{data.failReason}</div>
        )}
      </Card>

      {/* AI 失败诊断：仅失败部署展示 */}
      {isFailed && (
        <Card
          title={
            <Space>
              <RobotOutlined style={{ color: '#1677ff' }} />
              AI 部署诊断
            </Space>
          }
          extra={
            <Space>
              <Select
                size="small"
                value={model}
                onChange={setModel}
                disabled={diagnosing}
                style={{ minWidth: 180 }}
                options={models.map((m) => ({ value: m.id, label: m.label }))}
                placeholder="选择模型"
              />
              <Button
                type="primary"
                icon={<BulbOutlined />}
                loading={diagnosing}
                onClick={runDiagnose}
              >
                {diagnosis ? '重新诊断' : 'AI 诊断'}
              </Button>
            </Space>
          }
        >
          {diagnosing ? (
            <div className="py-6 text-center text-gray-400">
              <Spin />
              <div className="mt-2">AI 正在阅读失败日志、按需读取仓库代码并分析…</div>
            </div>
          ) : diagnosis ? (
            <DiagnosisView diagnosis={diagnosis} onAskFile={askAboutFile} />
          ) : (
            <div className="text-gray-400">
              点击右上角「AI 诊断」，让 AI 结合失败日志与仓库代码定位根因、给出修复建议。
            </div>
          )}
        </Card>
      )}

      <Card title="部署日志" styles={{ body: { padding: 0 } }}>
        <pre
          ref={logBoxRef}
          className="m-0 p-4 overflow-auto text-xs leading-5 font-mono"
          style={{
            maxHeight: '50vh',
            background: '#1e1e1e',
            color: '#d4d4d4',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {log || '等待日志输出…'}
        </pre>
      </Card>

      {chatInput !== null && (
        <ProjectChatDrawer
          project={chatProject}
          open={chatInput !== null}
          onClose={() => setChatInput(null)}
          initialInput={chatInput}
          initialRef={data.ref}
        />
      )}
        </Space>
      </PageBody>
    </PageContainer>
  )
}

/** 诊断结果展示：根因高亮 + 详细分析 + 修复建议 + 涉及文件（可带入问答） */
function DiagnosisView({
  diagnosis,
  onAskFile,
}: {
  diagnosis: DeployDiagnosis
  onAskFile: (file: string) => void
}) {
  return (
    <Space direction="vertical" size={14} className="w-full">
      <Alert type="error" showIcon message="根因" description={diagnosis.rootCause} />

      {diagnosis.analysis && (
        <div>
          <div className="font-600 mb-1">详细分析</div>
          <div className="text-sm text-gray-700" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {diagnosis.analysis}
          </div>
        </div>
      )}

      {diagnosis.suggestion && (
        <div>
          <div className="font-600 mb-1">修复建议</div>
          <div className="text-sm text-gray-700" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {diagnosis.suggestion}
          </div>
        </div>
      )}

      {!!diagnosis.files?.length && (
        <div>
          <div className="font-600 mb-1">涉及文件（点击带入代码问答）</div>
          <div className="flex flex-wrap gap-1">
            {diagnosis.files.map((f) => (
              <Tag
                key={f}
                color="blue"
                className="cursor-pointer m-0"
                onClick={() => onAskFile(f)}
              >
                {f}
              </Tag>
            ))}
          </div>
        </div>
      )}

      <div className="text-xs text-gray-400">
        诊断模型：{diagnosis.model ?? '默认'} · 生成于{' '}
        {dayjs(diagnosis.createdAt).format('YYYY-MM-DD HH:mm:ss')}
      </div>
    </Space>
  )
}
