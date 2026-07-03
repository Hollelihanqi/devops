import { Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { GitlabService } from '../core/gitlab.service'
import { StoreService } from '../core/store.service'
import type { SessionUser } from '../common/types'

@Injectable()
export class AuthService {
  constructor(
    private readonly gitlab: GitlabService,
    private readonly store: StoreService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * 用户用自己的 GitLab Personal Access Token 登录：
   * 用该 token 调 GET /user 验证有效性 → 建会话（权限天然继承该用户在 GitLab 的范围）。
   */
  async loginWithToken(gitlabToken: string): Promise<{ token: string; user: SessionUser }> {
    if (!gitlabToken?.trim()) throw new UnauthorizedException('请填写 GitLab Token')

    let gl: any
    try {
      gl = await this.gitlab.getUser(gitlabToken.trim())
    } catch {
      throw new UnauthorizedException('GitLab Token 无效或权限不足（需勾选 api 范围）')
    }

    const user = this.store.upsertUser({
      id: gl.id,
      gitlabUserId: gl.id,
      username: gl.username,
      name: gl.name,
      avatarUrl: gl.avatar_url,
    })
    this.store.setToken(user.id, { accessToken: gitlabToken.trim() })

    const token = this.jwt.sign({
      sub: user.id,
      gitlabUserId: user.gitlabUserId,
      username: user.username,
      name: user.name,
      isAdmin: user.isAdmin,
    })
    return { token, user }
  }

  logout(user: SessionUser) {
    this.store.clearToken(user.id)
  }
}
