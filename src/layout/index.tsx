import { Layout } from 'antd'
import TheSidebar from './TheSidebar'
import TheHeader from './TheHeader'
import Main from './Main'
import { useLayout } from './useLayout'

/**
 * 应用外壳（对标 Vue 的 Layout.vue）。
 * 结构：外层 Layout（h-screen overflow-hidden，横向）= 左 TheSidebar + 右内层 Layout（纵向）
 *       = TheHeader + Main(Outlet)。
 * 高度链锚定 100vh，外层不滚；滚动发生在内容区/表体（见 .app-page-content、.fill-table）。
 */
export default function AppLayout() {
  const {
    menuItems,
    collapsed,
    setCollapsed,
    isMobile,
    selectedKey,
    user,
    logout,
    navigate,
  } = useLayout()

  return (
    <Layout className="app-shell h-screen w-screen overflow-hidden">
      <TheSidebar
        items={menuItems}
        selectedKey={selectedKey}
        collapsed={collapsed}
        isMobile={isMobile}
        onSelect={(key) => navigate(key)}
      />
      <Layout className="min-w-0">
        <TheHeader
          user={user}
          collapsed={collapsed}
          isMobile={isMobile}
          onToggle={() => setCollapsed((v) => !v)}
          onLogout={logout}
        />
        <Main />
      </Layout>
    </Layout>
  )
}
