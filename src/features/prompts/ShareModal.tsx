import { useEffect, useState } from 'react'
import { Modal, Select, Avatar, Spin, App } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { promptsApi } from '@/api/prompts'
import type { Prompt } from '@/api/types'

interface Props {
  open: boolean
  prompt: Prompt | null
  onClose: () => void
  onSuccess: () => void
}

/** 提示词共享：把自己创建的提示词共享给若干用户（接收方只读） */
export default function ShareModal({ open, prompt, onClose, onSuccess }: Props) {
  const { message } = App.useApp()
  const [userIds, setUserIds] = useState<number[]>([])
  const [saving, setSaving] = useState(false)

  const { data: users, isLoading } = useQuery({
    queryKey: ['prompt-share-users'],
    queryFn: promptsApi.shareUsers,
    enabled: open,
  })

  // 每次打开用该提示词当前的共享名单回填
  useEffect(() => {
    if (open) setUserIds(prompt?.sharedTo ?? [])
  }, [open, prompt])

  const submit = async () => {
    if (!prompt) return
    setSaving(true)
    try {
      await promptsApi.share(prompt.id, userIds)
      message.success(userIds.length ? `已共享给 ${userIds.length} 位用户` : '已取消全部共享')
      onSuccess()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      title={prompt ? `共享「${prompt.title}」` : '共享提示词'}
      okText="保存"
      cancelText="取消"
      confirmLoading={saving}
      onOk={submit}
      onCancel={onClose}
      destroyOnClose
    >
      <div className="text-xs text-gray-400 mb-2">
        被共享的用户可以查看和复制此提示词，但不能编辑或删除。留空保存即取消全部共享。
      </div>
      {isLoading ? (
        <div className="py-6 flex justify-center">
          <Spin />
        </div>
      ) : (
        <Select
          mode="multiple"
          allowClear
          className="w-full"
          placeholder="选择要共享给的用户"
          value={userIds}
          onChange={setUserIds}
          optionFilterProp="label"
          options={(users ?? []).map((u) => ({
            value: u.id,
            label: `${u.name}（${u.username}）`,
          }))}
          optionRender={(opt) => {
            const u = users?.find((x) => x.id === opt.value)
            return (
              <div className="flex items-center gap-2">
                <Avatar src={u?.avatarUrl} size="small">
                  {u?.name?.[0]}
                </Avatar>
                <span>{u?.name}</span>
                <span className="text-xs text-gray-400">{u?.username}</span>
              </div>
            )
          }}
        />
      )}
    </Modal>
  )
}
