import { IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator'
import type { FamilyRole } from '@prisma/client'

/**
 * 可改的角色只有 ADMIN / MEMBER。
 *
 * OWNER **不能**经由这个接口产生：所有权只能走 /transfer，那条路径要求
 * 操作者本人就是 OWNER 并且会把自己降级。否则一个 ADMIN 就能把自己提成
 * 所有者——权限从这个字段漏出去过一次，就不需要第二次。
 */
export class UpdateMemberDto {
  @IsOptional()
  @IsIn(['ADMIN', 'MEMBER'])
  role?: Extract<FamilyRole, 'ADMIN' | 'MEMBER'>

  /** 与提醒的 dueAt 同一件事：@IsOptional 把 null 当成"没填"而放行，备注名会被抹掉。 */
  @ValidateIf((o: UpdateMemberDto) => o.displayName !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  displayName?: string
}
