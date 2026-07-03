import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { JwtGuard } from '../auth/jwt.guard'
import { CurrentUser } from '../auth/user.decorator'
import type { SessionUser } from '../common/types'
import { ProjectsService } from './projects.service'

@UseGuards(JwtGuard)
@Controller()
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get('groups/tree')
  groupTree(@CurrentUser() user: SessionUser) {
    return this.projects.groupTree(user)
  }

  @Get('projects')
  list(
    @CurrentUser() user: SessionUser,
    @Query('groupId') groupId?: string,
    @Query('keyword') keyword?: string,
    @Query('onlyFavorite') onlyFavorite?: string,
    @Query('fresh') fresh?: string,
  ) {
    return this.projects.list(user, {
      groupId: groupId ? Number(groupId) : undefined,
      keyword,
      onlyFavorite: onlyFavorite === 'true',
      fresh: fresh === 'true',
    })
  }

  @Get('projects/:id/branches')
  branches(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Query('keyword') keyword?: string,
  ) {
    return this.projects.branches(user, id, keyword)
  }

  @Get('projects/:id/environments')
  environments(@CurrentUser() user: SessionUser, @Param('id', ParseIntPipe) id: number) {
    return this.projects.environments(user, id)
  }

  @Get('projects/:id/ci-config')
  getCiConfig(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Query('ref') ref?: string,
  ) {
    return this.projects.getCiConfig(user, id, ref)
  }

  @Post('projects/:id/ci-config/generate')
  generateCiConfig(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { ref?: string; requirement?: string; model?: string; base?: string },
  ) {
    return this.projects.generateCiConfig(user, id, body)
  }

  @Post('projects/:id/ci-config/lint')
  lintCiConfig(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body('content') content: string,
  ) {
    return this.projects.lintCiConfig(user, id, content)
  }

  @Post('projects/:id/ci-config')
  commitCiConfig(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: {
      content: string
      mode?: 'commit' | 'merge_request'
      targetBranch?: string
      newBranch?: string
      commitMessage?: string
      mrTitle?: string
      mrDescription?: string
    },
  ) {
    return this.projects.commitCiConfig(user, id, body)
  }

  @Post('projects/:id/chat')
  chat(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: {
      conversationId?: number
      question?: string
      messages?: { role: 'user' | 'assistant'; content: string }[]
      model?: string
      ref?: string
    },
  ) {
    return this.projects.chat(user, id, body)
  }

  /** 某项目下当前用户的会话列表（不含消息体，供侧栏） */
  @Get('projects/:id/conversations')
  listConversations(@CurrentUser() user: SessionUser, @Param('id', ParseIntPipe) id: number) {
    return this.projects.listConversations(user, id)
  }

  /** 单个会话详情（含完整消息，用于续聊还原） */
  @Get('conversations/:cid')
  getConversation(@CurrentUser() user: SessionUser, @Param('cid', ParseIntPipe) cid: number) {
    return this.projects.getConversation(user, cid)
  }

  /** 重命名会话 */
  @Patch('conversations/:cid')
  renameConversation(
    @CurrentUser() user: SessionUser,
    @Param('cid', ParseIntPipe) cid: number,
    @Body('title') title: string,
  ) {
    return this.projects.renameConversation(user, cid, title)
  }

  /** 删除会话 */
  @Delete('conversations/:cid')
  deleteConversation(@CurrentUser() user: SessionUser, @Param('cid', ParseIntPipe) cid: number) {
    return this.projects.deleteConversation(user, cid)
  }

  @Post('projects/:id/favorite')
  fav(@CurrentUser() user: SessionUser, @Param('id', ParseIntPipe) id: number) {
    return this.projects.toggleFavorite(user, id, true)
  }

  @Delete('projects/:id/favorite')
  unfav(@CurrentUser() user: SessionUser, @Param('id', ParseIntPipe) id: number) {
    return this.projects.toggleFavorite(user, id, false)
  }
}
