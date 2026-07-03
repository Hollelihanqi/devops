import { Global, Module } from '@nestjs/common'
import { GitlabService } from './gitlab.service'
import { StoreService } from './store.service'
import { FeishuService } from './feishu.service'
import { GitlabCiProvider } from './ci/gitlab-ci.provider'
import { CI_PROVIDER } from './ci/ci-provider.interface'

/**
 * 全局核心服务：GitLab 客户端 + 内存存储 + 飞书通知 + CI 供应商抽象，供各业务模块直接注入。
 * 业务层注入 CI_PROVIDER（抽象的 CiProvider），不直接认 GitLab 实现，为 Jenkins 留口子。
 */
@Global()
@Module({
  providers: [
    GitlabService,
    StoreService,
    FeishuService,
    GitlabCiProvider,
    { provide: CI_PROVIDER, useExisting: GitlabCiProvider },
  ],
  exports: [GitlabService, StoreService, FeishuService, CI_PROVIDER],
})
export class CoreModule {}
