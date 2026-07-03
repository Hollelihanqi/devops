import { useState } from 'react'
import { Card, Input, Button, Typography, App, theme } from 'antd'
import { RocketOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'

const { Link, Paragraph, Text } = Typography

export default function LoginPage() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const { loginWithToken } = useAuthStore()
  const { token: t } = theme.useToken()
  const [value, setValue] = useState('')
  const [loading, setLoading] = useState(false)

  const gitlabUrl = import.meta.env.VITE_GITLAB_URL || 'http://10.0.6.203:8088'
  const tokenPage = `${gitlabUrl}/-/user_settings/personal_access_tokens`

  const submit = async () => {
    if (!value.trim()) return message.warning('请粘贴你的 GitLab Token')
    setLoading(true)
    try {
      await loginWithToken(value.trim())
      message.success('登录成功')
      navigate('/projects', { replace: true })
    } catch {
      /* 错误提示已由拦截器统一处理 */
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-screen h-[100dvh] flex-center p-4">
      <Card
        style={{ width: 'min(420px, calc(100vw - 32px))' }}
        styles={{ body: { padding: 32, minWidth: 0, overflowWrap: 'anywhere' } }}
      >
        <div className="flex-center flex-col gap-2 mb-6">
          <RocketOutlined style={{ fontSize: 36, color: t.colorPrimary }} />
          <div className="text-lg font-600">一键部署系统</div>
          <Text type="secondary" className="text-xs">
            使用你的 GitLab Personal Access Token 登录
          </Text>
        </div>

        <Input.Password
          size="large"
          placeholder="粘贴 GitLab Token（glpat-...）"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onPressEnter={submit}
          autoFocus
        />
        <Button type="primary" size="large" block loading={loading} onClick={submit} className="mt-4">
          登录
        </Button>

        <Paragraph type="secondary" className="text-xs mt-5 mb-0">
          如何获取：打开{' '}
          <Link href={tokenPage} target="_blank">
            GitLab → 个人设置 → Access Tokens
          </Link>
          ，创建一个勾选 <Text code>api</Text> 范围的 token，复制粘贴到上方即可。系统只用它代你调用 GitLab，
          你只能看到/部署自己有权限的项目。
        </Paragraph>
      </Card>
    </div>
  )
}
