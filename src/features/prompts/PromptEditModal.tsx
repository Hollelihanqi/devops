import { useEffect, useState } from 'react'
import { Modal, Form, Input, Select, App } from 'antd'
import { promptsApi, PROMPT_CATEGORIES } from '@/api/prompts'
import type { Prompt, PromptDraft, PromptInput } from '@/api/types'

/**
 * 新建/编辑提示词弹窗。
 * editing 有值为编辑；draft 有值（AI 提炼结果）为带预填的新建。
 */
export default function PromptEditModal({
  open,
  editing,
  draft,
  tagOptions,
  onClose,
  onSuccess,
}: {
  open: boolean
  editing?: Prompt | null
  draft?: PromptDraft | null
  tagOptions: string[]
  onClose: () => void
  onSuccess: () => void
}) {
  const { message } = App.useApp()
  const [form] = Form.useForm<PromptInput>()
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    const init = editing ?? draft
    if (init) {
      form.setFieldsValue({
        title: init.title,
        content: init.content,
        category: init.category,
        tags: init.tags,
        note: init.note,
      })
    } else {
      form.resetFields()
    }
  }, [open, editing, draft, form])

  const submit = async () => {
    const values = await form.validateFields()
    setSubmitting(true)
    try {
      if (editing) {
        await promptsApi.update(editing.id, values)
        message.success('已保存')
      } else {
        await promptsApi.create(values)
        message.success('已添加到提示词库')
      }
      onSuccess()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title={editing ? '编辑提示词' : draft ? '确认 AI 提炼结果' : '新建提示词'}
      open={open}
      onCancel={onClose}
      onOk={submit}
      confirmLoading={submitting}
      okText="保存"
      width={640}
      destroyOnClose
    >
      <Form form={form} layout="vertical" initialValues={{ category: '其他', tags: [] }}>
        <Form.Item
          name="title"
          label="标题"
          rules={[{ required: true, message: '请输入标题' }, { max: 100, message: '标题不能超过 100 字' }]}
        >
          <Input placeholder="一句话说明这条提示词是干什么的" maxLength={100} showCount />
        </Form.Item>
        <div className="flex gap-3">
          <Form.Item name="category" label="分类" className="w-40 shrink-0">
            <Select options={PROMPT_CATEGORIES.map((c) => ({ label: c, value: c }))} />
          </Form.Item>
          <Form.Item name="tags" label="标签" className="flex-1 min-w-0">
            <Select
              mode="tags"
              placeholder="输入后回车，可选择已有标签"
              options={tagOptions.map((t) => ({ label: t, value: t }))}
              maxCount={10}
              tokenSeparators={[',', '，']}
            />
          </Form.Item>
        </div>
        <Form.Item
          name="content"
          label="提示词内容"
          rules={[{ required: true, message: '请输入提示词内容' }]}
        >
          <Input.TextArea
            placeholder="粘贴或编写提示词正文"
            autoSize={{ minRows: 8, maxRows: 18 }}
            style={{ fontFamily: 'monospace', fontSize: 13 }}
          />
        </Form.Item>
        <Form.Item name="note" label="备注（选填）">
          <Input placeholder="适用场景、注意事项等" maxLength={200} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
