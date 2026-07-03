import { useState } from 'react'
import { Modal, Select, Avatar, Spin, App } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { promptsApi } from '@/api/prompts'

interface Props {
  open: boolean
  /** 我当前拥有的提示词数量（用于文案提示，0 时禁用） */
  promptCount: number
  onClose: () => void
  onSuccess: () => void
}

/** 一键分享：把「我的全部提示词」一次性共享给选定的用户（追加并集，不影响各自已有共享） */
export default function ShareAllModal({ open, promptCount, onClose, onSuccess }: Props) {
  const { message } = App.useApp()
  const [userIds, setUserIds] = useState<number[]>([])
  const [saving, setSaving] = useState(false)

  const { data: users, isLoading } = useQuery({
    queryKey: ['prompt-share-users'],
    queryFn: promptsApi.shareUsers,
    enabled: open,
  })

  const submit = async () => {
    if (!userIds.length) {
      message.warning('请先选择要分享给的用户')
      return
    }
    setSaving(true)
    try {
      const res = await promptsApi.shareAllTo(userIds)
      message.success(`已把 ${res.promptCount} 条提示词分享给 ${res.userCount} 位用户`)
      setUserIds([])
      onSuccess()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      title="一键分享全部提示词"
      okText="分享"
      cancelText="取消"
      okButtonProps={{ disabled: !promptCount }}
      confirmLoading={saving}
      onOk={submit}
      onCancel={onClose}
      destroyOnClose
    >
      <div className="text-xs text-gray-400 mb-2">
        {promptCount
          ? `把你当前的全部 ${promptCount} 条提示词一次性共享给选定用户（追加共享，不会取消已有的共享）。被共享的用户可查看和复制，但不能编辑或删除。`
          : '你还没有提示词可分享。'}
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
          placeholder="选择要分享给的用户"
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
