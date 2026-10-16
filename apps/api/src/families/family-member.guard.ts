import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { FamilyMember, FamilyRole } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { FAMILY_ROLES_KEY } from './roles.decorator'
import type { AuthUser } from '../auth/current-user.decorator'

export interface FamilyScopedRequest {
  user: AuthUser
  params: Record<string, string>
  familyMember?: FamilyMember
}

/**
 * 家庭作用域权限的唯一实现处。
 *
 * 两条刻意的设计：
 *  1. 非成员与不存在的家庭**都返回 403**，不用 404。否则攻击者可以靠
 *     404/403 的差异探测出某个家庭是否存在。
 *  2. 归档家庭一律拒绝，无论角色。归档必须是硬边界，不能只是从列表里隐藏。
 */
@Injectable()
export class FamilyMemberGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FamilyScopedRequest>()
    const familyId = request.params?.familyId

    // 非家庭作用域的路由交给 JwtAuthGuard 负责。
    if (!familyId) return true

    const required =
      this.reflector.getAllAndOverride<FamilyRole[]>(FAMILY_ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? []

    const member = await this.prisma.familyMember.findUnique({
      where: { familyId_userId: { familyId, userId: request.user.id } },
      include: { family: { select: { archivedAt: true } } },
    })

    if (!member || member.family.archivedAt !== null) {
      throw new ForbiddenException('无权访问该家庭')
    }

    // 未显式声明时，只要求是成员。
    if (required.length > 0 && !required.includes(member.role)) {
      throw new ForbiddenException('当前角色无权执行此操作')
    }

    request.familyMember = member
    return true
  }
}
