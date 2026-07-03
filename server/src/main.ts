import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ConfigService } from '@nestjs/config'
import { Logger } from '@nestjs/common'
import { AppModule } from './app.module'
import { ResponseInterceptor } from './common/response.interceptor'
import { HttpExceptionFilter } from './common/http-exception.filter'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  const config = app.get(ConfigService)

  app.setGlobalPrefix('api')
  app.useGlobalInterceptors(new ResponseInterceptor())
  app.useGlobalFilters(new HttpExceptionFilter())
  app.enableCors({
    origin: config.get<string>('FRONTEND_URL') || true,
    credentials: true,
  })

  // 监听进程退出信号，触发 onModuleDestroy（StoreService 落盘 flush）
  app.enableShutdownHooks()

  const port = Number(config.get('PORT') ?? 3000)
  await app.listen(port)
  new Logger('Bootstrap').log(`BFF 已启动: http://localhost:${port}/api`)
}
bootstrap()
