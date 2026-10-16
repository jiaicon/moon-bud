import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator'
import type { InviteRole } from '@moonbud/shared'

/**
 * 邀请能给出的角色只有 ADMIN / MEMBER。
 *
 * 这不是 UI 约束而是安全约束：邀请码是可以转发的，若它能携带 OWNER，
 * 一张截图就等于把家庭所有权交了出去（spec 第 4 节）。
 */
export class CreateInviteDto {
  @IsIn(['ADMIN', 'MEMBER'], { message: '邀请角色只能是 ADMIN 或 MEMBER' })
  role!: InviteRole

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24 * 30)
  expiresInHours?: number

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  maxUses?: number
}
