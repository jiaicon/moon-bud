import { SetMetadata } from '@nestjs/common'
import type { FamilyRole } from '@prisma/client'

export const FAMILY_ROLES_KEY = 'familyRoles'

/**
 * 声明访问该路由所需的家庭角色。不标注时默认要求"至少是成员"。
 * 角色判断只在 FamilyMemberGuard 一处实现，禁止散落到 service。
 */
export const RequireFamilyRole = (...roles: FamilyRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(FAMILY_ROLES_KEY, roles)
