import { createParamDecorator, type ExecutionContext } from '@nestjs/common'

export interface AuthUser {
  id: string
  username: string
}

/** 从 request.user 取当前登录用户。守卫已验证过 token。 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest<{ user: AuthUser }>()
    return request.user
  },
)
