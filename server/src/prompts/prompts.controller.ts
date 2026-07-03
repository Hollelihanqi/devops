import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common'
import { JwtGuard } from '../auth/jwt.guard'
import { CurrentUser } from '../auth/user.decorator'
import type { SessionUser } from '../common/types'
import { PromptsService, type PromptInput } from './prompts.service'

@UseGuards(JwtGuard)
@Controller('prompts')
export class PromptsController {
  constructor(private readonly prompts: PromptsService) {}

  // 静态路由必须声明在 :id 之前，否则会被 ParseIntPipe 拦截报 400

  @Get('tags')
  tags(@CurrentUser() user: SessionUser) {
    return this.prompts.tags(user)
  }

  @Get('ai/models')
  aiModels() {
    return this.prompts.aiModels()
  }

  @Get('ai/config')
  aiConfig(@CurrentUser() user: SessionUser) {
    return this.prompts.getAiConfig(user)
  }

  @Put('ai/config')
  setAiKey(@CurrentUser() user: SessionUser, @Body('apiKey') apiKey: string) {
    return this.prompts.setAiKey(user, apiKey)
  }

  @Delete('ai/config')
  clearAiKey(@CurrentUser() user: SessionUser) {
    this.prompts.clearAiKey(user)
  }

  @Post('ai/refine')
  refine(
    @CurrentUser() user: SessionUser,
    @Body('conversation') conversation: string,
    @Body('model') model?: string,
  ) {
    return this.prompts.refine(user, conversation, model)
  }

  @Get('share-users')
  shareUsers(@CurrentUser() user: SessionUser) {
    return this.prompts.shareUsers(user)
  }

  /** 一键分享：把当前用户的全部提示词分享给指定用户（静态路由，须在 :id 之前） */
  @Post('share-all')
  shareAllTo(@CurrentUser() user: SessionUser, @Body('userIds') userIds: number[]) {
    return this.prompts.shareAllTo(user, userIds ?? [])
  }

  @Get()
  list(@CurrentUser() user: SessionUser) {
    return this.prompts.list(user)
  }

  @Post()
  create(@CurrentUser() user: SessionUser, @Body() input: PromptInput) {
    return this.prompts.create(user, input)
  }

  @Put(':id')
  update(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() input: PromptInput,
  ) {
    return this.prompts.update(user, id, input)
  }

  @Delete(':id')
  remove(@CurrentUser() user: SessionUser, @Param('id', ParseIntPipe) id: number) {
    this.prompts.remove(user, id)
  }

  @Post(':id/use')
  use(@CurrentUser() user: SessionUser, @Param('id', ParseIntPipe) id: number) {
    return this.prompts.markUsed(user, id)
  }

  @Put(':id/favorite')
  favorite(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body('on') on: boolean,
  ) {
    return this.prompts.setFavorite(user, id, !!on)
  }

  @Put(':id/share')
  share(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body('userIds') userIds: number[],
  ) {
    return this.prompts.share(user, id, userIds ?? [])
  }
}
