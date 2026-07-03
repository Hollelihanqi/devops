import { useState } from 'react'
import { Modal, Input, Alert, Button, Tag, App, Popconfirm, Select } from 'antd'
import { CheckCircleOutlined, KeyOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { promptsApi } from '@/api/prompts'
import { useModelChoice } from '@/components/useModelChoice'
import type { PromptDraft } from '@/api/types'

/** AI 网关设置弹窗：API Key 配置入口（Key 只写不读，后端加密存储） */
export function AiConfigModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { message } = App.useApp()
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const { data: config, refetch } = useQuery({
    queryKey: ['ai-config'],
    queryFn: promptsApi.aiConfig,
    enabled: open,
  })

  const save = async () => {
    if (!apiKey.trim()) {
      message.warning('请输入 API Key')
      return
    }
    setSaving(true)
    try {
      const r = await promptsApi.setAiKey(apiKey.trim())
      message.success(`连接成功（${r.model}，${r.latencyMs}ms），Key 已加密保存`)
      setApiKey('')
      refetch()
    } finally {
      setSaving(false)
    }
  }

  const clear = async () => {
    await promptsApi.clearAiKey()
    message.success('已删除保存的 API Key')
    refetch()
  }

  return (
    <Modal title="AI 设置" open={open} onCancel={onClose} footer={null} width={560} destroyOnClose>
      <div className="flex flex-col gap-3">
        <Alert
          type="info"
          showIcon
          message="API Key 找管理员获取（gw-sk-...）。保存前会实际调一次网关验证，通过后加密存储在服务端，页面不再回显明文。"
        />
        <div className="text-xs text-gray-400">
          网关：{config?.gateway ?? '...'} · 模型：{config?.model ?? '...'}
        </div>
        {config?.configured && (
          <div className="flex items-center gap-2">
            <Tag icon={<CheckCircleOutlined />} color="success">
              已配置 {config.maskedKey}
            </Tag>
            <Popconfirm title="删除已保存的 API Key？" onConfirm={clear}>
              <Button size="small" danger type="text">
                删除
              </Button>
            </Popconfirm>
          </div>
        )}
        <Input.Password
          prefix={<KeyOutlined />}
          placeholder={config?.configured ? '输入新 Key 可覆盖当前配置' : 'gw-sk-xxxxxxxx'}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          onPressEnter={save}
        />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>关闭</Button>
          <Button type="primary" loading={saving} onClick={save}>
            验证并保存
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/** AI 提炼弹窗：粘贴对话 → deepseek 提炼成提示词草稿 */
export function AiRefineModal({
  open,
  aiConfigured,
  onClose,
  onDraft,
  onNeedConfig,
}: {
  open: boolean
  aiConfigured: boolean
  onClose: () => void
  /** 提炼成功，把草稿交给编辑弹窗确认 */
  onDraft: (draft: PromptDraft) => void
  /** 未配置 Key 时引导去设置 */
  onNeedConfig: () => void
}) {
  const { message } = App.useApp()
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const { models, model, setModel } = useModelChoice('refine')

  const run = async () => {
    if (!text.trim()) {
      message.warning('请先粘贴对话内容')
      return
    }
    setLoading(true)
    try {
      const draft = await promptsApi.refine(text, model)
      setText('')
      onDraft(draft)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      title="AI 提炼提示词"
      open={open}
      onCancel={onClose}
      width={680}
      destroyOnClose
      footer={
        <div className="flex items-center gap-2">
          <Select
            size="middle"
            value={model}
            onChange={setModel}
            style={{ minWidth: 200 }}
            options={models.map((m) => ({ value: m.id, label: m.label }))}
            placeholder="选择模型"
          />
          <div className="flex-1" />
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={loading} onClick={run}>
            开始提炼
          </Button>
        </div>
      }
    >
      {!aiConfigured && (
        <Alert
          type="warning"
          showIcon
          className="mb-3"
          message={
            <span>
              尚未配置 AI 网关 API Key，
              <a onClick={onNeedConfig}>去配置</a>
            </span>
          }
        />
      )}
      <Input.TextArea
        placeholder="把你和 AI 的一段对话（或一段描述）粘贴到这里，AI 会提炼出一条可复用的提示词草稿，你确认后再入库"
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoSize={{ minRows: 10, maxRows: 20 }}
        maxLength={50_000}
        showCount
      />
    </Modal>
  )
}
