import { Layout, Avatar, Dropdown, Button, theme } from 'antd'
import {
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons'
import type { CurrentUser } from '@/api/types'

const { Header } = Layout

interface TheHeaderProps {
  user?: CurrentUser | null
  collapsed: boolean
  isMobile: boolean
  onToggle: () => void
  onLogout: () => void
}

/**
 * 顶栏（对标 Vue 的 TheHeader.vue）：折叠切换 + 右侧用户菜单（退出登录）。
 * 沿用 antd Header，使现有针对 .ant-layout-header 的玻璃拟态 CSS 继续生效。
 */
export default function TheHeader({ user, collapsed, isMobile, onToggle, onLogout }: TheHeaderProps) {
  const { token } = theme.useToken()

  return (
    <Header
      className="flex-between px-4"
      style={{
        background: token.colorBgContainer,
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
      }}
    >
      <Button
        type="text"
        icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
        onClick={onToggle}
        style={{ visibility: isMobile ? 'hidden' : 'visible' }}
      />
      <div className="flex-1" />
      <Dropdown
        menu={{
          items: [
            { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: onLogout },
          ],
        }}
      >
        <div className="flex items-center gap-2 cursor-pointer px-2">
          <Avatar src={user?.avatarUrl} size="small">
            {user?.name?.[0]}
          </Avatar>
          <span className="hidden sm:inline">{user?.name}</span>
        </div>
      </Dropdown>
    </Header>
  )
}
