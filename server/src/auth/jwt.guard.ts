import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { StoreService } from '../core/store.service'

/** 校验 Bearer JWT，并将用户挂到 req.user */
@Injectable()
export class JwtGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly store: StoreService,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest()
    const header: string = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : null
    if (!token) throw new UnauthorizedException('未登录')

    let payload: any
    try {
      payload = this.jwt.verify(token)
    } catch {
      throw new UnauthorizedException('登录态无效')
    }
    const user = this.store.getUser(payload.sub)
    if (!user) throw new UnauthorizedException('会话已失效，请重新登录')
    if (user.disabled) throw new ForbiddenException('账号已被禁用，请联系管理员')
    req.user = user
    return true
  }
}
