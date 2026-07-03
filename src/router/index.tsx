import { lazy, Suspense } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { Spin } from 'antd'
import AppLayout from '@/layout'
import { useAuthStore } from '@/stores/auth'

const LoginPage = lazy(() => import('@/features/auth/LoginPage'))
const ProjectsPage = lazy(() => import('@/features/projects/ProjectsPage'))
const HistoryPage = lazy(() => import('@/features/history/HistoryPage'))
const PromptsPage = lazy(() => import('@/features/prompts/PromptsPage'))
const DeploymentDetail = lazy(() => import('@/features/monitor/DeploymentDetail'))
const AdminPage = lazy(() => import('@/features/admin/AdminPage'))

const withSuspense = (node: React.ReactNode) => (
  <Suspense
    fallback={
      <div className="h-full w-full flex items-center justify-center">
        <Spin size="large" />
      </div>
    }
  >
    {node}
  </Suspense>
)

/** 登录守卫：未登录跳 /login */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuthStore()
  if (loading) return <Spin className="mt-20 block mx-auto" />
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

/** 管理员守卫：非管理员回项目页（后端 AdminGuard 仍会二次拦截） */
function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore()
  if (!user?.isAdmin) return <Navigate to="/projects" replace />
  return <>{children}</>
}

export const router = createBrowserRouter([
  { path: '/login', element: withSuspense(<LoginPage />) },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="/projects" replace /> },
      { path: 'projects', element: withSuspense(<ProjectsPage />) },
      { path: 'history', element: withSuspense(<HistoryPage />) },
      { path: 'prompts', element: withSuspense(<PromptsPage />) },
      { path: 'deployments/:id', element: withSuspense(<DeploymentDetail />) },
      {
        path: 'admin',
        element: <RequireAdmin>{withSuspense(<AdminPage />)}</RequireAdmin>,
      },
    ],
  },
])
