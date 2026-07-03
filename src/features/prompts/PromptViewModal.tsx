import { Modal, Tag, Button, Typography } from 'antd'
import { CopyOutlined, TeamOutlined } from '@ant-design/icons'
import type { Prompt } from '@/api/types'

interface Props {
  open: boolean
  prompt: Prompt | null
  onCopy: (p: Prompt) => void
  onClose: () => void
}

/** 提示词只读详情：查看完整内容（用于别人共享给我的提示词，不提供任何编辑入口） */
export default function PromptViewModal({ open, prompt, onCopy, onClose }: Props) {
  return (
    <Modal
      open={open}
      title={prompt?.title}
      width={680}
      onCancel={onClose}
      footer={[
        <Button key="close" onClick={onClose}>
          关闭
        </Button>,
        <Button
          key="copy"
          type="primary"
          icon={<CopyOutlined />}
          onClick={() => prompt && onCopy(prompt)}
        >
          复制内容
        </Button>,
      ]}
    >
      {prompt && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1">
            <Tag color="blue">{prompt.category}</Tag>
            {prompt.tags.map((t) => (
              <Tag key={t} bordered={false}>
                {t}
              </Tag>
            ))}
            {prompt.ownerName && (
              <Tag color="purple" bordered={false} icon={<TeamOutlined />}>
                来自 {prompt.ownerName} 共享
              </Tag>
            )}
          </div>

          {prompt.note && (
            <Typography.Text type="secondary" className="text-xs">
              {prompt.note}
            </Typography.Text>
          )}

          <pre
            style={{
              margin: 0,
              maxHeight: '56vh',
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontFamily:
                '"JetBrains Mono", "Cascadia Code", ui-monospace, Menlo, Consolas, monospace',
              fontSize: 13,
              lineHeight: 1.6,
              color: 'rgba(0, 0, 0, 0.78)',
              background: 'rgba(0, 0, 0, 0.03)',
              borderRadius: 10,
              padding: '14px 16px',
            }}
          >
            {prompt.content}
          </pre>
        </div>
      )}
    </Modal>
  )
}
