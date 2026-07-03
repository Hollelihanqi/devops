import { Body, Controller, Delete, Get, Param, ParseIntPipe, Put, UseGuards } from '@nestjs/common'
import { JwtGuard } from '../auth/jwt.guard'
import { AdminGuard } from '../auth/admin.guard'
import { CurrentUser } from '../auth/user.decorator'
import type { ProjectEnvConfig, SessionUser } from '../common/types'
import { ProjectsService } from '../projects/projects.service'
import { AdminService } from './admin.service'

@UseGuards(JwtGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly projects: ProjectsService,
  ) {}

  @Get('stats')
  stats() {
    return this.admin.stats()
  }

  @Get('users')
  users() {
    return this.admin.users()
  }

  @Put('users/:id/admin')
  setAdmin(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body('on') on: boolean,
  ) {
    return this.admin.setAdmin(user, id, !!on)
  }

  @Put('users/:id/disabled')
  setDisabled(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body('on') on: boolean,
  ) {
    return this.admin.setDisabled(user, id, !!on)
  }

  @Get('projects/:id/env-configs')
  envConfigs(@CurrentUser() user: SessionUser, @Param('id', ParseIntPipe) id: number) {
    return this.projects.envConfigsDetail(user, id)
  }

  @Put('projects/:id/env-configs')
  saveEnvConfigs(
    @Param('id', ParseIntPipe) id: number,
    @Body('configs') configs: ProjectEnvConfig[],
  ) {
    return this.projects.saveEnvConfigs(id, configs)
  }

  @Delete('projects/:id/env-configs')
  resetEnvConfigs(@Param('id', ParseIntPipe) id: number) {
    return this.projects.resetEnvConfigs(id)
  }
}
