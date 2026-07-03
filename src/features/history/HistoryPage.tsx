import { useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Card, Table, Tag, Select, DatePicker, Space, Grid, List, Button, Progress, Spin, App } from 'antd'
import { EyeOutlined, RedoOutlined, StopOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'
import { deploymentsApi } from '@/api/deployments'
import { useAuthStore } from '@/stores/auth'
import { PageContainer } from '@/layout/PageContainer'
import type { Deployment, DeployStatus } from '@/api/types'

const { RangePicker } = DatePicker
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

/**
 * 部署进度：部署中/等待中用后端实时推导的 d.progress（按 pipeline job 状态），
 * 终态恒为 100%。后端拿不到 progress 时回退到按状态近似。
 */
type ProgressInfo = {
  percent: number
  status: 'success' | 'exception' | 'active' | 'normal'
  strokeColor?: string
}
const progressOf = (d: Deployment): ProgressInfo => {
  switch (d.status) {
    case 'success':
      return { percent: 100, status: 'success' }
    case 'failed':
      return { percent: 100, status: 'exception' }
    case 'canceled':
      return { percent: 100, status: 'normal', strokeColor: '#bfbfbf' }
    case 'running':
      return { percent: d.progress ?? 60, status: 'active' }
    default:
      return { percent: d.progress ?? 0, status: d.progress ? 'active' : 'normal' } // pending
  }
}

export default function HistoryPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { message, modal } = App.useApp()
  const screens = useBreakpoint()
  const isMobile = !screens.md
  const currentUser = useAuthStore((s) => s.user)
  // 仅部署发起人（或管理员）可取消进行中的部署
  const canCancel = (d: Deployment) =>
    (d.status === 'pending' || d.status === 'running') &&
    (currentUser?.id === d.triggeredByUserId || !!currentUser?.isAdmin)
  const projectId = params.get('projectId') ? Number(params.get('projectId')) : undefined
  const [status, setStatus] = useState<DeployStatus>()

  const { data, isLoading, isFetching, isPlaceholderData, refetch } = useQuery({
    queryKey: ['deployments', projectId, status],
    queryFn: () => deploymentsApi.list({ projectId, status, pageSize: 50 }),
    // 切换筛选时保留上一份数据，避免整表被 loading 顶掉（菜单导航/轮询本就走缓存不闪）
    placeholderData: keepPreviousData,
    // 有进行中的部署时轮询，让进度条实时走动；全部终态则停止
    refetchInterval: (q) =>
      q.state.data?.list?.some((d) => d.status === 'running' || d.status === 'pending')
        ? 3000
        : false,
  })

  // 仅"切换筛选导致换数据"时给表格轻微 loading；后台轮询不闪
  const switching = isFetching && isPlaceholderData

  // 用该条记录相同的项目/环境/分支再触发一次部署
  const redeploy = (d: Deployment) => {
    modal.confirm({
      title: '重新部署？',
      content: `项目：${d.projectName}\n环境：${d.envCode}\n分支：${d.ref}`,
      okText: '重新部署',
      cancelText: '取消',
      onOk: async () => {
        const res = await deploymentsApi.create({
          projectId: d.gitlabProjectId,
          env: d.envCode,
          ref: d.ref,
        })
        message.success('已触发部署')
        navigate(`/deployments/${res.deploymentId}`)
      },
    })
  }

  // 取消进行中的部署
  const cancel = (d: Deployment) => {
    modal.confirm({
      title: '取消部署？',
      content: `项目：${d.projectName}\nPipeline：#${d.gitlabPipelineId}`,
      okText: '取消部署',
      okButtonProps: { danger: true },
      cancelText: '返回',
      onOk: async () => {
        await deploymentsApi.cancel(d.id)
        message.success('已取消部署')
        refetch()
      },
    })
  }

  const columns: ColumnsType<Deployment> = [
    {
      title: '项目',
      dataIndex: 'projectName',
      ellipsis: true,
      render: (name: string, d) =>
        d.projectWebUrl ? (
          <a
            href={d.projectWebUrl}
            target="_blank"
            rel="noreferrer"
            title={`在 GitLab 打开：${name}`}
            onClick={(e) => e.stopPropagation()}
          >
            {name}
          </a>
        ) : (
          name
        ),
    },
    {
      title: 'Pipeline',
      dataIndex: 'gitlabPipelineId',
      width: 110,
      render: (v?: number) => (v ? `#${v}` : '-'),
    },
    { title: '环境', dataIndex: 'envCode', width: 100 },
    { title: '分支', dataIndex: 'ref', width: 140, ellipsis: true },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (s: DeployStatus) => <Tag color={statusColor[s]}>{statusText[s]}</Tag>,
    },
    {
      title: '进度',
      dataIndex: 'status',
      key: 'progress',
      width: 140,
      render: (_: DeployStatus, d) => {
        const p = progressOf(d)
        return (
          <Progress percent={p.percent} status={p.status} strokeColor={p.strokeColor} size="small" />
        )
      },
    },
    { title: '触发人', dataIndex: 'triggeredByName', width: 120 },
    {
      title: '开始时间',
      dataIndex: 'startedAt',
      width: 180,
      render: (v?: string) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-'),
    },
    {
      title: '完成时间',
      dataIndex: 'finishedAt',
      width: 180,
      render: (v?: string) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-'),
    },
    {
      title: '耗时',
      dataIndex: 'durationSec',
      width: 90,
      render: (v?: number) => (v ? `${v}s` : '-'),
    },
    {
      title: '操作',
      key: 'action',
      width: 240,
      fixed: 'right',
      render: (_, d) => (
        <Space size={4} onClick={(e) => e.stopPropagation()}>
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => navigate(`/deployments/${d.id}`)}
          >
            查看
          </Button>
          <Button
            type="link"
            size="small"
            icon={<RedoOutlined />}
            onClick={() => redeploy(d)}
          >
            重新部署
          </Button>
          {canCancel(d) && (
            <Button
              type="link"
              size="small"
              danger
              icon={<StopOutlined />}
              onClick={() => cancel(d)}
            >
              取消
            </Button>
          )}
        </Space>
      ),
    },
  ]

  const filters = (
    <Space wrap className="mb-4">
      <Select
        placeholder="状态筛选"
        allowClear
        style={{ width: 140 }}
        value={status}
        onChange={setStatus}
        options={Object.entries(statusText).map(([value, label]) => ({ value, label }))}
      />
      <RangePicker />
    </Space>
  )

  // 首次加载（还没有任何数据）时显示居中 loading；后续轮询/刷新走表格自带的 loading 遮罩
  const firstLoading = isLoading && !data

  return (
    <PageContainer>
      <Card title="部署历史" className="fill-card min-h-0 flex-1">
        <div className="mb-4 shrink-0">{filters}</div>
        {firstLoading ? (
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <Spin size="large" />
          </div>
        ) : isMobile ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <List
              loading={switching}
              dataSource={data?.list}
              renderItem={(d) => {
                const p = progressOf(d)
                return (
                  <List.Item onClick={() => navigate(`/deployments/${d.id}`)}>
                    <div className="w-full">
                      <List.Item.Meta
                        title={
                          <Space>
                            {d.projectWebUrl ? (
                              <a
                                href={d.projectWebUrl}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {d.projectName}
                              </a>
                            ) : (
                              d.projectName
                            )}
                            <Tag color={statusColor[d.status]}>{statusText[d.status]}</Tag>
                          </Space>
                        }
                        description={`${d.envCode} · ${d.ref} · ${d.triggeredByName} · 开始 ${dayjs(d.startedAt).format('YYYY-MM-DD HH:mm:ss')}${d.finishedAt ? ` · 完成 ${dayjs(d.finishedAt).format('YYYY-MM-DD HH:mm:ss')}` : ''}`}
                      />
                      <Progress
                        className="mt-1"
                        percent={p.percent}
                        status={p.status}
                        strokeColor={p.strokeColor}
                        size="small"
                      />
                    </div>
                  </List.Item>
                )
              }}
            />
          </div>
        ) : (
          <div className="fill-table">
            <Table
              rowKey="id"
              loading={switching}
              columns={columns}
              dataSource={data?.list}
              // x 横向滚动；y 仅用于触发表头/表体分离，实际高度由 .fill-table CSS 接管（表头固定、表体滚动）
              scroll={{ x: 'max-content', y: 9999 }}
              onRow={(d) => ({ onClick: () => navigate(`/deployments/${d.id}`) })}
              rowClassName="cursor-pointer"
              pagination={{ pageSize: 20, showSizeChanger: false }}
            />
          </div>
        )}
      </Card>
    </PageContainer>
  )
}
