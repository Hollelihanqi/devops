import { useEffect } from 'react'
import { RouterProvider } from 'react-router-dom'
import { ConfigProvider, App as AntApp, theme } from 'antd'
import { StyleProvider } from '@ant-design/cssinjs'
import zhCN from 'antd/locale/zh_CN'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import { router } from '@/router'
import { useAuthStore } from '@/stores/auth'
import AmbientCloudBackground from '@/components/AmbientCloudBackground'

dayjs.locale('zh-cn')

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
})

// 设计 token 源：antd 与 UnoCSS 共用同一组色值（见需求文档 §5.3）
const themeConfig = {
  algorithm: theme.defaultAlgorithm,
  token: {
    colorPrimary: '#1677ff',
    borderRadius: 8,
    colorBgLayout: '#f5f6f8',
  },
}

export default function App() {
  const fetchUser = useAuthStore((s) => s.fetchUser)

  useEffect(() => {
    fetchUser()
  }, [fetchUser])

  return (
    <StyleProvider hashPriority="high">
      <ConfigProvider locale={zhCN} theme={themeConfig}>
        <AntApp>
          <AmbientCloudBackground />
          <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
          </QueryClientProvider>
        </AntApp>
      </ConfigProvider>
    </StyleProvider>
  )
}
