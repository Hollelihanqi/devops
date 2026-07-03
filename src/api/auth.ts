import { http, request } from './http'
import type { CurrentUser } from './types'

export const authApi = {
  /** 用 GitLab Personal Access Token 登录 */
  login: (token: string) =>
    request<{ token: string; user: CurrentUser }>(http.post('/auth/login', { token })),
  /** 获取当前登录用户 */
  me: () => request<CurrentUser>(http.get('/auth/me')),
  logout: () => request<void>(http.post('/auth/logout')),
}
