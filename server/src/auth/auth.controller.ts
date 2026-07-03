import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common'
import { AuthService } from './auth.service'
import { JwtGuard } from './jwt.guard'
import { CurrentUser } from './user.decorator'
import type { SessionUser } from '../common/types'

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** 用 GitLab Personal Access Token 登录，返回平台会话 JWT + 用户信息 */
  @Post('login')
  login(@Body() body: { token: string }) {
    return this.auth.loginWithToken(body?.token)
  }

  @UseGuards(JwtGuard)
  @Get('me')
  me(@CurrentUser() user: SessionUser) {
    return user
  }

  @UseGuards(JwtGuard)
  @Post('logout')
  logout(@CurrentUser() user: SessionUser) {
    this.auth.logout(user)
    return null
  }
}
