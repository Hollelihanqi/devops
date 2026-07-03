import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { ProjectsModule } from '../projects/projects.module'
import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'

@Module({
  imports: [AuthModule, ProjectsModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
