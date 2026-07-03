import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { ProjectsModule } from '../projects/projects.module'
import { DeploymentsController } from './deployments.controller'
import { DeploymentsService } from './deployments.service'
import { AiService } from '../prompts/ai.service'

@Module({
  imports: [AuthModule, ProjectsModule],
  controllers: [DeploymentsController],
  providers: [DeploymentsService, AiService],
})
export class DeploymentsModule {}
