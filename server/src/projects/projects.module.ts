import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { ProjectsController } from './projects.controller'
import { ProjectsService } from './projects.service'
import { AiService } from '../prompts/ai.service'

@Module({
  imports: [AuthModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, AiService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
