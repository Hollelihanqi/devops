import { Layout } from 'antd'
import { Outlet } from 'react-router-dom'

const { Content } = Layout

/**
 * 主内容区（对标 Vue 的 Main.vue）。
 * 占满 Header 以下剩余高度（flex-1 min-h-0），自身 overflow-hidden——滚动交给页面内部
 * （PageContainer / 表格表体），从而保证「整页 100vh、内容区滚动、表头固定」。
 */
export default function Main() {
  return (
    <Content className="app-page-content flex-1 min-h-0 overflow-hidden p-3 sm:p-4 md:p-6">
      <Outlet />
    </Content>
  )
}
