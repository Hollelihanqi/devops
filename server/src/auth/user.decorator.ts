import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import type { SessionUser } from '../common/types'

/** 从请求上下文取出当前登录用户（由 JwtGuard 注入） */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SessionUser => {
    return ctx.switchToHttp().getRequest().user
  },
)
