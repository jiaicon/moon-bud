import { createParamDecorator, type ExecutionContext } from '@nestjs/common'
import type { FamilyMember } from '@prisma/client'

/**
 * 取 FamilyMemberGuard 已经解析好的成员记录。
 * 守卫在放行前必然已写入 request.familyMember，所以这里不需要再查一次库。
 */
export const CurrentMember = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): FamilyMember => {
    const request = ctx.switchToHttp().getRequest<{ familyMember?: FamilyMember }>()
    if (!request.familyMember) {
      // 只会在忘记挂 FamilyMemberGuard 时发生，属于编程错误而非用户错误。
      throw new Error('CurrentMember 需要配合 FamilyMemberGuard 使用')
    }
    return request.familyMember
  },
)
