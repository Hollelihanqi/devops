import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common'

/** 统一错误响应 { code, message }，HTTP status 透传以便前端 401/403 判定 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception')

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse()
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR

    let message = '服务器异常'
    if (exception instanceof HttpException) {
      const r = exception.getResponse() as any
      message = typeof r === 'string' ? r : r?.message ?? exception.message
      if (Array.isArray(message)) message = message.join('; ')
    } else if (exception instanceof Error) {
      message = exception.message
      this.logger.error(exception.stack)
    }

    res.status(status).json({ code: status, message })
  }
}
