import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'

/** 统一响应包络 { code, message, data }，与前端 http.ts 约定一致 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    const res = ctx.switchToHttp().getResponse()
    return next.handle().pipe(
      map((data) => {
        // 已被显式处理（如重定向）的响应不包裹
        if (res.headersSent || data === undefined) return data
        return { code: 0, message: 'ok', data: data ?? null }
      }),
    )
  }
}
