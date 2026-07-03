import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Alert,
  App,
  Avatar,
  Button,
  Card,
  Col,
  Empty,
  Input,
  Popconfirm,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
} from 'antd'
import {
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  TeamOutlined,
  RocketOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
} from '@ant-design/icons'
import { adminApi } from '@/api/admin'
import { projectsApi } from '@/api/projects'
import { useAuthStore } from '@/stores/auth'
import { PageContainer, PageBody } from '@/layout/PageContainer'
import type { AdminUser, ProjectEnvConfigItem } from '@/api/types'

/** GitLab access_level 常用档位 */
const ACCESS_OPTIONS = [
  { value: 30, label: '30 · Developer' },
  { value: 40, label: '40 · Maintainer' },
  { value: 50, label: '50 · Owner' },
]

const STRATEGY_OPTIONS = [
  { value: 'manual_job', label: '手动 Job（manual_job）' },
  { value: 'create_pipeline', label: '直接跑流水线（create_pipeline）' },
]

/** 概览：部署/用户统计 */
function OverviewTab() {
  const { data, isLoading } = useQuery({ queryKey: ['admin-stats'], queryFn: adminApi.stats })
  const items = [
    { title: '总部署次数', value: data?.deployments.total, icon: <RocketOutlined />, color: undefined },
    { title: '今日部署', value: data?.deployments.today, icon: <SyncOutlined />, color: undefined },
    { title: '成功', value: data?.deployments.success, icon: <CheckCircleOutlined />, color: '#52c41a' },
    { title: '失败', value: data?.deployments.failed, icon: <CloseCircleOutlined />, color: '#ff4d4f' },
    { title: '进行中', value: data?.deployments.running, icon: <SyncOutlined />, color: '#1677ff' },
    { title: '平台用户', value: data?.userCount, icon: <TeamOutlined />, color: undefined },
  ]
  return (
    <Row gutter={[16, 16]}>
      {items.map((it) => (
        <Col key={it.title} xs={12} sm={8} xl={4}>
          <Card size="small" loading={isLoading}>
            <Statistic
              title={it.title}
              value={it.value ?? 0}
              prefix={it.icon}
              valueStyle={it.color ? { color: it.color } : undefined}
            />
          </Card>
        </Col>
      ))}
    </Row>
  )
}

/** 环境配置：选项目 → 编辑「环境-分支-权限」映射，保存为覆盖配置 */
function EnvConfigTab() {
  const { message } = App.useApp()
  const [keyword, setKeyword] = useState('')
  const [projectId, setProjectId] = useState<number>()
  const [configs, setConfigs] = useState<ProjectEnvConfigItem[]>([])
  const [saving, setSaving] = useState(false)

  const { data: projects, isLoading: projectsLoading } = useQuery({
    queryKey: ['admin-projects', keyword],
    queryFn: () => projectsApi.list({ keyword, pageSize: 60 }),
  })

  const { data: detail, isLoading, refetch } = useQuery({
    queryKey: ['admin-env-configs', projectId],
    queryFn: () => adminApi.envConfigs(projectId!),
    enabled: !!projectId,
  })

  const { data: branches } = useQuery({
    queryKey: ['admin-branches', projectId],
    queryFn: () => projectsApi.branches(projectId!),
    enabled: !!projectId,
  })

  // 服务端数据到达后同步到本地可编辑副本
  useEffect(() => {
    setConfigs(detail?.configs ? detail.configs.map((c) => ({ ...c })) : [])
  }, [detail])

  const branchOptions = useMemo(
    () => branches?.map((b) => ({ value: b.name, label: b.name })) ?? [],
    [branches],
  )

  const patch = (i: number, p: Partial<ProjectEnvConfigItem>) =>
    setConfigs((list) => list.map((c, idx) => (idx === i ? { ...c, ...p } : c)))

  const save = async () => {
    setSaving(true)
    try {
      await adminApi.saveEnvConfigs(projectId!, configs)
      message.success('环境配置已保存（覆盖默认约定）')
      refetch()
    } finally {
      setSaving(false)
    }
  }

  const reset = async () => {
    await adminApi.resetEnvConfigs(projectId!)
    message.success('已恢复默认分支约定')
    refetch()
  }

  return (
    <div className="flex flex-col gap-4">
      <Space wrap>
        <Select
          showSearch
          allowClear
          placeholder="搜索并选择项目"
          className="min-w-[320px]"
          loading={projectsLoading}
          filterOption={false}
          onSearch={setKeyword}
          onChange={(v) => setProjectId(v)}
          options={projects?.list.map((p) => ({
            value: p.gitlabProjectId,
            label: p.pathWithNamespace,
          }))}
        />
        {detail && (
          <Tag color={detail.source === 'override' ? 'blue' : 'default'}>
            {detail.source === 'override' ? '覆盖配置' : '默认约定（develop→测试 / master→生产）'}
          </Tag>
        )}
      </Space>

      {!projectId ? (
        <Empty description="先选择一个项目" className="mt-10" />
      ) : (
        <>
          <Alert
            type="info"
            showIcon
            message="保存后该项目的「环境-分支-最低权限」以此处配置为准；恢复默认则重新按分支名约定推断。"
          />
          <Table<ProjectEnvConfigItem>
            rowKey={(_, i) => String(i)}
            size="small"
            loading={isLoading}
            dataSource={configs}
            pagination={false}
            columns={[
              {
                title: '环境编码',
                width: 140,
                render: (_, r, i) => (
                  <Input
                    value={r.envCode}
                    placeholder="如 test / prod"
                    onChange={(e) => patch(i, { envCode: e.target.value })}
                  />
                ),
              },
              {
                title: '环境名称',
                width: 140,
                render: (_, r, i) => (
                  <Input
                    value={r.name}
                    placeholder="如 测试 / 生产"
                    onChange={(e) => patch(i, { name: e.target.value })}
                  />
                ),
              },
              {
                title: '绑定分支',
                width: 200,
                render: (_, r, i) => (
                  <Select
                    showSearch
                    className="w-full"
                    value={r.ref || undefined}
                    placeholder="选择分支"
                    options={branchOptions}
                    onChange={(v) => patch(i, { ref: v })}
                  />
                ),
              },
              {
                title: '触发策略',
                width: 220,
                render: (_, r, i) => (
                  <Select
                    className="w-full"
                    value={r.strategy}
                    options={STRATEGY_OPTIONS}
                    onChange={(v) => patch(i, { strategy: v })}
                  />
                ),
              },
              {
                title: '最低部署权限',
                width: 170,
                render: (_, r, i) => (
                  <Select
                    className="w-full"
                    value={r.minAccessLevel}
                    options={ACCESS_OPTIONS}
                    onChange={(v) => patch(i, { minAccessLevel: v })}
                  />
                ),
              },
              {
                title: '操作',
                width: 70,
                render: (_, __, i) => (
                  <Button
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => setConfigs((list) => list.filter((_, idx) => idx !== i))}
                  />
                ),
              },
            ]}
          />
          <Space>
            <Button
              icon={<PlusOutlined />}
              onClick={() =>
                setConfigs((list) => [
                  ...list,
                  { envCode: '', name: '', ref: '', strategy: 'manual_job', minAccessLevel: 30 },
                ])
              }
            >
              新增环境
            </Button>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>
              保存配置
            </Button>
            {detail?.source === 'override' && (
              <Popconfirm title="删除覆盖配置，恢复按分支约定推断？" onConfirm={reset}>
                <Button icon={<ReloadOutlined />} danger>
                  恢复默认约定
                </Button>
              </Popconfirm>
            )}
          </Space>
        </>
      )}
    </div>
  )
}

/** 用户列表与权限配置（登录过本平台的用户） */
function UsersTab() {
  const { message } = App.useApp()
  const currentUser = useAuthStore((s) => s.user)
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['admin-users'],
    queryFn: adminApi.users,
  })

  const toggleAdmin = async (u: AdminUser) => {
    await adminApi.setUserAdmin(u.id, !u.isAdmin)
    message.success(u.isAdmin ? `已取消 ${u.name} 的管理员权限` : `已将 ${u.name} 设为管理员`)
    refetch()
  }

  const toggleDisabled = async (u: AdminUser) => {
    await adminApi.setUserDisabled(u.id, !u.disabled)
    message.success(u.disabled ? `已启用 ${u.name}` : `已禁用 ${u.name}，该账号将无法登录`)
    refetch()
  }

  return (
    <div className="flex flex-col gap-3">
      <Alert
        type="info"
        showIcon
        message="环境变量 ADMIN_USERNAMES 指定的用户为固定管理员（带「固定」标记），只能在服务端配置中移除；其余用户的管理员权限和禁用状态可在此直接配置，即时生效。"
      />
      <Table<AdminUser>
        rowKey="id"
        size="small"
        loading={isLoading}
        dataSource={data}
        pagination={false}
        columns={[
          {
            title: '用户',
            render: (_, u) => (
              <Space>
                <Avatar src={u.avatarUrl} size="small">
                  {u.name?.[0]}
                </Avatar>
                {u.name}
                {u.id === currentUser?.id && <Tag color="blue">我</Tag>}
              </Space>
            ),
          },
          { title: 'GitLab 用户名', dataIndex: 'username' },
          {
            title: '角色',
            dataIndex: 'isAdmin',
            width: 150,
            render: (v: boolean, u) =>
              v ? (
                <Space size={4}>
                  <Tag color="gold">管理员</Tag>
                  {u.adminFromEnv && <Tag>固定</Tag>}
                </Space>
              ) : (
                <Tag>普通用户</Tag>
              ),
          },
          {
            title: '状态',
            dataIndex: 'disabled',
            width: 100,
            render: (v: boolean) => (v ? <Tag color="red">已禁用</Tag> : <Tag color="green">正常</Tag>),
          },
          {
            title: 'GitLab 授权',
            dataIndex: 'authorized',
            width: 110,
            render: (v: boolean) =>
              v ? <Tag color="green">有效</Tag> : <Tag color="red">已失效</Tag>,
          },
          {
            title: '操作',
            width: 220,
            render: (_, u) => {
              const isSelf = u.id === currentUser?.id
              return (
                <Space size={4}>
                  <Popconfirm
                    title={u.isAdmin ? `取消 ${u.name} 的管理员权限？` : `将 ${u.name} 设为管理员？`}
                    onConfirm={() => toggleAdmin(u)}
                    disabled={isSelf || (u.isAdmin && u.adminFromEnv)}
                  >
                    <Button
                      type="link"
                      size="small"
                      disabled={isSelf || (u.isAdmin && u.adminFromEnv)}
                    >
                      {u.isAdmin ? '取消管理员' : '设为管理员'}
                    </Button>
                  </Popconfirm>
                  <Popconfirm
                    title={
                      u.disabled ? `启用 ${u.name}？` : `禁用 ${u.name}？该账号将立即无法访问平台`
                    }
                    onConfirm={() => toggleDisabled(u)}
                    disabled={isSelf}
                  >
                    <Button type="link" size="small" danger={!u.disabled} disabled={isSelf}>
                      {u.disabled ? '启用' : '禁用'}
                    </Button>
                  </Popconfirm>
                </Space>
              )
            },
          },
        ]}
      />
    </div>
  )
}

export default function AdminPage() {
  return (
    <PageContainer>
      <PageBody>
        <Card size="small" styles={{ body: { padding: 16 } }}>
          <Tabs
            items={[
              { key: 'overview', label: '概览', children: <OverviewTab /> },
              { key: 'env', label: '环境配置', children: <EnvConfigTab /> },
              { key: 'users', label: '用户', children: <UsersTab /> },
            ]}
          />
        </Card>
      </PageBody>
    </PageContainer>
  )
}
