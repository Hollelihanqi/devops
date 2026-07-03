import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { StoreService } from '../core/store.service'
import type { SessionUser } from '../common/types'

/** 系统管理：概览统计 + 用户列表（环境配置走 ProjectsService） */
@Injectable()
export class AdminService {
  constructor(private readonly store: StoreService) {}

  stats() {
    const deployments = this.store.listDeployments({})
    const today = new Date().toISOString().slice(0, 10)
    const count = (s: string) => deployments.filter((d) => d.status === s).length
    return {
      userCount: this.store.listUsers().length,
      deployments: {
        total: deployments.length,
        success: count('success'),
        failed: count('failed'),
        running: count('running') + count('pending'),
        today: deployments.filter((d) => d.startedAt?.slice(0, 10) === today).length,
      },
    }
  }

  users() {
    return this.store.listUsers().map((u) => ({
      id: u.id,
      gitlabUserId: u.gitlabUserId,
      username: u.username,
      name: u.name,
      avatarUrl: u.avatarUrl,
      isAdmin: u.isAdmin,
      /** 来自 ADMIN_USERNAMES 环境变量的固定管理员，不可在界面取消 */
      adminFromEnv: this.store.isEnvAdmin(u.username),
      disabled: !!u.disabled,
      authorized: this.store.hasToken(u.id),
    }))
  }

  /** 设置/取消管理员 */
  setAdmin(actor: SessionUser, targetId: number, on: boolean) {
    const target = this.store.getUser(targetId)
    if (!target) throw new NotFoundException('用户不存在')
    if (!on && actor.id === targetId) throw new BadRequestException('不能取消自己的管理员权限')
    if (!on && this.store.isEnvAdmin(target.username))
      throw new BadRequestException(
        '该用户由 ADMIN_USERNAMES 环境变量指定为固定管理员，需在服务端配置中移除',
      )
    this.store.setUserAdmin(targetId, on)
    return null
  }

  /** 禁用/启用账号 */
  setDisabled(actor: SessionUser, targetId: number, on: boolean) {
    const target = this.store.getUser(targetId)
    if (!target) throw new NotFoundException('用户不存在')
    if (on && actor.id === targetId) throw new BadRequestException('不能禁用自己的账号')
    this.store.setUserDisabled(targetId, on)
    return null
  }
}
