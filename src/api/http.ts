import axios, { AxiosError } from 'axios'
import { message } from 'antd'
import type { ApiResult } from './types'

/** 统一 axios 实例：baseURL=/api，开发期由 vite 代理到 BFF */
export const http = axios.create({
  baseURL: '/api',
  timeout: 30_000,
})

http.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

http.interceptors.response.use(
  (resp) => {
    const body = resp.data as ApiResult<unknown>
    // 兼容后端统一包络；非 0 视为业务错误
    if (body && typeof body === 'object' && 'code' in body && body.code !== 0) {
      message.error(body.message || '请求失败')
      return Promise.reject(new Error(body.message))
    }
    return resp
  },
  (error: AxiosError<ApiResult<unknown>>) => {
    const status = error.response?.status
    if (status === 401) {
      localStorage.removeItem('token')
      // 跳转应用内登录页（填 GitLab Token）
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login'
      }
      return Promise.reject(error)
    }
    if (status === 403) {
      message.error('无权限执行该操作')
    } else {
      message.error(error.response?.data?.message || error.message || '网络错误')
    }
    return Promise.reject(error)
  },
)

/** 解包 data */
export async function request<T>(promise: Promise<{ data: ApiResult<T> }>): Promise<T> {
  const resp = await promise
  return resp.data.data
}
