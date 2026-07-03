import { http, request } from './http'
import type { AdminStats, AdminUser, EnvConfigsDetail, ProjectEnvConfigItem } from './types'

/** 系统管理接口（仅管理员，后端 AdminGuard 拦截） */
export const adminApi = {
  stats: () => request<AdminStats>(http.get('/admin/stats')),

  users: () => request<AdminUser[]>(http.get('/admin/users')),

  setUserAdmin: (userId: number, on: boolean) =>
    request<void>(http.put(`/admin/users/${userId}/admin`, { on })),

  setUserDisabled: (userId: number, on: boolean) =>
    request<void>(http.put(`/admin/users/${userId}/disabled`, { on })),

  envConfigs: (projectId: number) =>
    request<EnvConfigsDetail>(http.get(`/admin/projects/${projectId}/env-configs`)),

  saveEnvConfigs: (projectId: number, configs: ProjectEnvConfigItem[]) =>
    request<void>(http.put(`/admin/projects/${projectId}/env-configs`, { configs })),

  resetEnvConfigs: (projectId: number) =>
    request<void>(http.delete(`/admin/projects/${projectId}/env-configs`)),
}
