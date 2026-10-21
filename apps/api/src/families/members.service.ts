import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { randomInt } from 'node:crypto'
import type { FamilyMember, Prisma } from '@prisma/client'
import type { MemberDto } from '@moonbud/shared'
import { hashPassword } from '../auth/password.util'
import { TokenService } from '../auth/token.service'
import { PrismaService } from '../prisma/prisma.service'
import type { UpdateMemberDto } from './dto/update-member.dto'

/** 临时密码要能当面口述，所以同样排除易混字符。 */
const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
const TEMP_PASSWORD_LENGTH = 12
const RESET_TTL_MS = 24 * 60 * 60 * 1000

export function generateTemporaryPassword(): string {
  let out = ''
  for (let i = 0; i < TEMP_PASSWORD_LENGTH; i += 1) {
    out += TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)]
  }
  return out
}

/**
 * "家庭至少保留一名 OWNER"这条不变量的唯一实现处。
 *
 * 在事务内、**变更之后**调用：计数为 0 就抛错，让整个事务回滚。放在变更
 * 之后而不是之前，是因为"移除成员""把 OWNER 降级""退出家庭"三条路径的
 * 变更形态不同，而后置检查对三者是同一句话。
 */
export async function assertFamilyHasOwner(
  tx: Prisma.TransactionClient,
  familyId: string,
): Promise<void> {
  const owners = await tx.familyMember.count({ where: { familyId, role: 'OWNER' } })
  if (owners === 0) {
    throw new BadRequestException('家庭必须至少保留一名所有者，请先转让所有权')
  }
}

type MemberWithUser = FamilyMember & { user: { nickname: string; username: string } }

function toMemberDto(member: MemberWithUser): MemberDto {
  return {
    id: member.id,
    userId: member.userId,
    role: member.role,
    displayName: member.displayName,
    joinedAt: member.joinedAt.toISOString(),
    nickname: member.user.nickname,
    username: member.user.username,
  }
}

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  async list(familyId: string): Promise<MemberDto[]> {
    const rows = await this.prisma.familyMember.findMany({
      where: { familyId },
      include: { user: { select: { nickname: true, username: true } } },
      orderBy: { joinedAt: 'asc' },
    })
    return rows.map(toMemberDto)
  }

  async update(
    familyId: string,
    memberId: string,
    dto: UpdateMemberDto,
    actor: FamilyMember,
  ): Promise<MemberDto> {
    const target = await this.findInFamily(familyId, memberId)
    assertCanOperateOn(actor, target)

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.familyMember.update({
        where: { id: target.id },
        data: {
          ...(dto.role === undefined ? {} : { role: dto.role }),
          ...(dto.displayName === undefined ? {} : { displayName: dto.displayName }),
        },
        include: { user: { select: { nickname: true, username: true } } },
      })
      // 把最后一名 OWNER 降级会让家庭失去管理者：抛错即回滚上面的 update。
      await assertFamilyHasOwner(tx, familyId)
      return toMemberDto(updated)
    })
  }

  async remove(familyId: string, memberId: string, actor: FamilyMember): Promise<void> {
    const target = await this.findInFamily(familyId, memberId)
    assertCanOperateOn(actor, target)

    await this.prisma.$transaction(async (tx) => {
      await tx.familyMember.delete({ where: { id: target.id } })
      await assertFamilyHasOwner(tx, familyId)
    })
  }

  /**
   * 家庭成员重置密码：忘记密码又没有邮箱短信时的唯一通路。
   * 明文临时密码只在这里返回一次，库里只有哈希。
   */
  async resetPassword(
    familyId: string,
    memberId: string,
    actor: FamilyMember,
  ): Promise<{ temporaryPassword: string }> {
    const target = await this.findInFamily(familyId, memberId)

    // 给自己重置等于绕过旧密码校验，改自己的密码必须走 change-password。
    if (target.userId === actor.userId) {
      throw new BadRequestException('请使用「修改密码」功能修改自己的密码')
    }
    assertCanOperateOn(actor, target)

    const temporaryPassword = generateTemporaryPassword()
    const tokenHash = await hashPassword(temporaryPassword)

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: target.userId },
        data: { passwordHash: tokenHash, mustChangePassword: true, passwordChangedAt: new Date() },
      }),
      // 审计线索：谁在什么时候给谁发过临时密码。
      this.prisma.passwordResetToken.create({
        data: {
          userId: target.userId,
          tokenHash,
          issuedBy: actor.userId,
          expiresAt: new Date(Date.now() + RESET_TTL_MS),
        },
      }),
    ])

    // 重置的意义是"这个人已经失去对自己账号的控制"，那么他名下所有还活着的
    // 会话也必须一起作废——否则旧设备上的登录原样有效，重置只是换了个密码。
    await this.tokens.revokeAllForUser(target.userId)

    return { temporaryPassword }
  }

  /** 成员的 id 只在它所属的家庭里有效；别的家庭的 id 一律当作不存在。 */
  private async findInFamily(familyId: string, memberId: string): Promise<FamilyMember> {
    const target = await this.prisma.familyMember.findUnique({ where: { id: memberId } })
    if (!target || target.familyId !== familyId) {
      throw new NotFoundException('成员不存在')
    }
    return target
  }
}

/**
 * ADMIN 不能操作 OWNER。允许的话，一个被授予管理权的人就能移除所有者、
 * 或者重置所有者的密码后接管其账号——两种都是权限倒挂。
 */
function assertCanOperateOn(actor: FamilyMember, target: FamilyMember): void {
  if (actor.role === 'ADMIN' && target.role === 'OWNER') {
    throw new ForbiddenException('管理员不能操作所有者')
  }
}
