import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { CoreModule } from './core/core.module'
import { AuthModule } from './auth/auth.module'
import { ProjectsModule } from './projects/projects.module'
import { DeploymentsModule } from './deployments/deployments.module'
import { AdminModule } from './admin/admin.module'
import { PromptsModule } from './prompts/prompts.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    CoreModule,
    AuthModule,
    ProjectsModule,
    DeploymentsModule,
    AdminModule,
    PromptsModule,
  ],
})
export class AppModule {}
