import { useEffect, useState } from 'react'
import { Modal, Form, Select, Input, Alert, Tag, Space, Spin, App } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { projectsApi } from '@/api/projects'
import { deploymentsApi } from '@/api/deployments'
import type { ProjectItem } from '@/api/types'

interface Props {
  project: ProjectItem
  open: boolean
  onClose: () => void
  onSuccess: (deploymentId: number) => void
}

/** 部署面板：选环境为主，分支自动带出（见需求文档 §FR-3、§6.5） */
export default function DeployModal({ project, open, onClose, onSuccess }: Props) {
  const { message, modal } = App.useApp()
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)
  const [env, setEnv] = useState<string>()

  const { data: envs, isLoading: envLoading } = useQuery({
    queryKey: ['environments', project.gitlabProjectId],
    queryFn: () => projectsApi.environments(project.gitlabProjectId),
    enabled: open,
  })

  const { data: branches } = useQuery({
    queryKey: ['branches', project.gitlabProjectId],
    queryFn: () => projectsApi.branches(project.gitlabProjectId),
    enabled: open,
  })

  const currentEnv = envs?.find((e) => e.envCode === env)

  // 选环境后默认带出该环境绑定分支，用户仍可在下拉里手动切换为其他分支。
  // 依赖用稳定基础值 `env`（envCode 字符串），避免 react-query 后台刷新产生新引用导致误触发。
  useEffect(() => {
    if (!env) return
    const boundEnv = envs?.find((e) => e.envCode === env)
    if (boundEnv) form.setFieldValue('ref', boundEnv.ref)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [env])

  const isProd = currentEnv?.envCode === 'prod' || currentEnv?.name?.includes('生产')

  const submit = async () => {
    const values = await form.validateFields()
    const doDeploy = async () => {
      setSubmitting(true)
      try {
        const res = await deploymentsApi.create({
          projectId: project.gitlabProjectId,
          env: values.env,
          ref: values.ref,
          note: values.note,
        })
        message.success('已触发部署')
        onSuccess(res.deploymentId)
      } finally {
        setSubmitting(false)
      }
    }
    // 生产环境强制二次确认
    if (isProd) {
      modal.confirm({
        title: '确认部署到生产环境？',
        content: `项目：${project.name}\n分支：${values.ref}\n环境：${currentEnv?.name}`,
        okText: '确认部署',
        cancelText: '取消',
        okButtonProps: { danger: true },
        onOk: doDeploy,
      })
    } else {
      await doDeploy()
    }
  }

  return (
    <Modal
      title={`部署 · ${project.name}`}
      open={open}
      onCancel={onClose}
      onOk={submit}
      okText="开始部署"
      cancelText="取消"
      confirmLoading={submitting}
      destroyOnClose
    >
      <Spin spinning={envLoading}>
        <Form form={form} layout="vertical" className="mt-4">
          <Form.Item
            name="env"
            label="部署环境"
            rules={[{ required: true, message: '请选择环境' }]}
          >
            <Select
              placeholder="选择部署环境"
              onChange={setEnv}
              options={envs?.map((e) => ({
                value: e.envCode,
                label: (
                  <Space>
                    {e.name}
                    <Tag>{e.ref}</Tag>
                    {!e.deployable && <Tag color="red">无权限</Tag>}
                  </Space>
                ),
                disabled: !e.deployable,
              }))}
            />
          </Form.Item>

          <Form.Item
            name="ref"
            label="部署分支"
            rules={[{ required: true, message: '请选择分支' }]}
            extra={<span className="text-gray-400 text-xs">默认带出环境绑定分支，可手动切换</span>}
          >
            <Select
              showSearch
              placeholder="选择分支"
              options={branches?.map((b) => ({ value: b.name, label: b.name }))}
            />
          </Form.Item>

          {isProd && (
            <Alert
              type="warning"
              showIcon
              message="生产环境部署，提交前将二次确认"
              className="mb-3"
            />
          )}

          <Form.Item name="note" label="部署备注（可选）">
            <Input.TextArea rows={2} placeholder="如：版本说明 / 变更内容" maxLength={200} />
          </Form.Item>
        </Form>
      </Spin>
    </Modal>
  )
}
