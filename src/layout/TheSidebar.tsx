import { Layout, theme } from 'antd'
import { RocketOutlined } from '@ant-design/icons'
import TheMenu from './TheMenu'
import type { LayoutMenuItem } from './useLayout'

const { Sider } = Layout

interface TheSidebarProps {
  items: LayoutMenuItem[]
  selectedKey: string
  collapsed: boolean
  isMobile: boolean
  onSelect: (key: string) => void
}

/**
 * 左侧栏（对标 Vue 的 TheSidebar.vue）：品牌区 + 菜单。
 * 沿用 antd Sider，使现有针对 .ant-layout-sider 的玻璃拟态 CSS 继续生效。
 */
export default function TheSidebar({
  items,
  selectedKey,
  collapsed,
  isMobile,
  onSelect,
}: TheSidebarProps) {
  const { token } = theme.useToken()
  const siderCollapsed = isMobile ? true : collapsed

  return (
    <Sider
      theme="light"
      collapsible
      collapsed={siderCollapsed}
      collapsedWidth={isMobile ? 0 : 64}
      trigger={null}
      breakpoint="lg"
      style={{ borderRight: `1px solid ${token.colorBorderSecondary}` }}
    >
      <div
        className="flex-center gap-2 h-14 font-600 overflow-hidden"
        style={{ color: token.colorPrimary }}
      >
        <RocketOutlined className="text-xl" />
        {!siderCollapsed && <span className="whitespace-nowrap">一键部署</span>}
      </div>
      <TheMenu items={items} selectedKey={selectedKey} onSelect={onSelect} />
    </Sider>
  )
}
