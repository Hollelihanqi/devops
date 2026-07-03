import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common'
import { JwtGuard } from '../auth/jwt.guard'
import { CurrentUser } from '../auth/user.decorator'
import type { SessionUser } from '../common/types'
import { DeploymentsService } from './deployments.service'

@UseGuards(JwtGuard)
@Controller('deployments')
export class DeploymentsController {
  constructor(private readonly deployments: DeploymentsService) {}

  @Post()
  async create(
    @CurrentUser() user: SessionUser,
    @Body() body: { projectId: number; env: string; ref?: string; variables?: Record<string, string>; note?: string },
  ) {
    const dep = await this.deployments.create(user, body)
    return { deploymentId: dep.id, pipelineId: dep.gitlabPipelineId, jobId: dep.gitlabJobId }
  }

  @Get(':id')
  detail(@CurrentUser() user: SessionUser, @Param('id', ParseIntPipe) id: number) {
    return this.deployments.detail(user, id)
  }

  @Get(':id/logs')
  logs(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Query('offset') offset?: string,
  ) {
    return this.deployments.logs(user, id, offset ? Number(offset) : 0)
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() user: SessionUser, @Param('id', ParseIntPipe) id: number) {
    return this.deployments.cancel(user, id)
  }

  /** AI 失败诊断：触发 / 重新诊断（工具循环读日志+代码，耗时较长） */
  @Post(':id/diagnose')
  diagnose(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { model?: string },
  ) {
    return this.deployments.diagnose(user, id, body?.model)
  }

  /** 取已缓存的诊断（无则返回 null） */
  @Get(':id/diagnose')
  getDiagnosis(@CurrentUser() user: SessionUser, @Param('id', ParseIntPipe) id: number) {
    return this.deployments.getDiagnosis(user, id)
  }

  @Get()
  list(
    @CurrentUser() user: SessionUser,
    @Query('projectId') projectId?: string,
    @Query('status') status?: string,
  ) {
    return this.deployments.list(user, {
      projectId: projectId ? Number(projectId) : undefined,
      status,
    })
  }
}
