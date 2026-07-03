import { useState, type ReactNode } from 'react'
import { Grid } from 'antd'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  AppstoreOutlined,
  HistoryOutlined,
  SettingOutlined,
  BulbOutlined,
} from '@ant-design/icons'
import { useAuthStore } from '@/stores/auth'

export interface LayoutMenuItem {
  key: string
  icon: ReactNode
  label: string
}

/**
 * 布局相关的状态与交互：菜单项、折叠态、移动端断点、当前激活菜单、用户与退出登录。
 * 对标 Vue 工程的 src/layout/useLayout.ts，把原本散在 AppLayout 里的逻辑收敛到一处。
 */
export function useLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const screens = Grid.useBreakpoint()
  const isMobile = !screens.md
  const [collapsed, setCollapsed] = useState(false)
  const { user, logout } = useAuthStore()

  const menuItems: LayoutMenuItem[] = [
    { key: '/projects', icon: <AppstoreOutlined />, label: '项目部署' },
    { key: '/history', icon: <HistoryOutlined />, label: '部署历史' },
    { key: '/prompts', icon: <BulbOutlined />, label: '提示词' },
    ...(user?.isAdmin
      ? [{ key: '/admin', icon: <SettingOutlined />, label: '系统管理' }]
      : []),
  ]

  // 详情页等无对应菜单的路由，回退到同模块的菜单项
  const selectedKey =
    menuItems.find((m) => location.pathname.startsWith(m.key))?.key ?? '/projects'

  // 移动端强制收起侧栏（collapsedWidth=0）
  const siderCollapsed = isMobile ? true : collapsed

  return {
    menuItems,
    collapsed,
    setCollapsed,
    isMobile,
    siderCollapsed,
    selectedKey,
    user,
    logout,
    navigate,
  }
}
