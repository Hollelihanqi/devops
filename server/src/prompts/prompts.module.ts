import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { PromptsController } from './prompts.controller'
import { PromptsService } from './prompts.service'
import { AiService } from './ai.service'

/** AI 提示词管理：提示词库 CRUD + 内网 MaaS 网关接入（见 docs/06） */
@Module({
  imports: [AuthModule],
  controllers: [PromptsController],
  providers: [PromptsService, AiService],
})
export class PromptsModule {}
