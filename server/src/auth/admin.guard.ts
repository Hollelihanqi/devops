import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import type { SessionUser } from '../common/types'

/** 管理员守卫：需配合 JwtGuard 使用（依赖 req.user），非管理员一律 403 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const user = ctx.switchToHttp().getRequest().user as SessionUser | undefined
    if (!user?.isAdmin) throw new ForbiddenException('需要管理员权限')
    return true
  }
}
