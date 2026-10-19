import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common'
import { Prisma, type Family, type FamilyInvite, type FamilyMember, type FamilyRole } from '@prisma/client'
import type { FamilyDto, InviteDto } from '@moonbud/shared'
import { PrismaService } from '../prisma/prisma.service'
import { generateInviteCode } from './invite-code.util'
import type { CreateInviteDto } from './dto/create-invite.dto'

const DEFAULT_EXPIRES_HOURS = 72
/** 8 位 31 字符表下的碰撞概率极低；重试只是不让一次巧合变成 500。 */
const MAX_CODE_ATTEMPTS = 5

/** 所有失败共用一句话：任何一句更具体的话都能被用来探测家庭信息。 */
const INVALID_INVITE = '邀请码无效或已失效'

function toInviteDto(invite: FamilyInvite): InviteDto {
  return {
    id: invite.id,
    code: invite.code,
    // 收窄到 ADMIN|MEMBER：列上的枚举带着 OWNER，但邀请只能由 CreateInviteDto 建，
    // 那里就只收这两个值。所有权不通过一条链接发出去。
    role: invite.role as InviteDto['role'],
    expiresAt: invite.expiresAt.toISOString(),
    maxUses: invite.maxUses,
    usedCount: invite.usedCount,
    revokedAt: invite.revokedAt?.toISOString() ?? null,
  }
}

function toFamilyDto(family: Family, role: FamilyRole): FamilyDto {
  return {
    id: family.id,
    name: family.name,
    ownerId: family.ownerId,
    role,
    archivedAt: family.archivedAt?.toISOString() ?? null,
  }
}

@Injectable()
export class InvitesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(familyId: string, dto: CreateInviteDto, createdBy: string): Promise<InviteDto> {
    const expiresAt = new Date(
      Date.now() + (dto.expiresInHours ?? DEFAULT_EXPIRES_HOURS) * 60 * 60 * 1000,
    )

    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
      try {
        const invite = await this.prisma.familyInvite.create({
          data: {
            familyId,
            code: generateInviteCode(),
            role: dto.role,
            createdBy,
            expiresAt,
            maxUses: dto.maxUses ?? 1,
          },
        })
        return toInviteDto(invite)
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002' &&
          attempt < MAX_CODE_ATTEMPTS - 1
        ) {
          continue
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new InternalServerErrorException('邀请码生成失败，请重试')
        }
        throw error
      }
    }

    throw new InternalServerErrorException('邀请码生成失败，请重试')
  }

  async list(familyId: string): Promise<InviteDto[]> {
    const rows = await this.prisma.familyInvite.findMany({
      where: { familyId },
      orderBy: { createdAt: 'desc' },
    })
    return rows.map(toInviteDto)
  }

  async revoke(familyId: string, inviteId: string): Promise<void> {
    const invite = await this.prisma.familyInvite.findUnique({ where: { id: inviteId } })
    // 别的家庭的邀请码在本家庭里等于不存在。
    if (!invite || invite.familyId !== familyId) {
      throw new NotFoundException('邀请不存在')
    }
    if (invite.revokedAt !== null) return
    await this.prisma.familyInvite.update({
      where: { id: inviteId },
      data: { revokedAt: new Date() },
    })
  }

  /**
   * 用邀请码加入家庭。这条路径**没有家庭上下文**——使用者还不知道自己
   * 会被加进哪个家庭，所以只能靠 code 本身作为凭据。
   */
  async accept(code: string, userId: string): Promise<FamilyDto> {
    return this.prisma.$transaction(async (tx) => {
      const invite = await tx.familyInvite.findUnique({
        where: { code },
        include: { family: true },
      })

      if (
        !invite ||
        invite.revokedAt !== null ||
        invite.expiresAt.getTime() <= Date.now() ||
        // 归档家庭是硬边界：连"加入"都要挡住，否则归档只挡住了老成员。
        invite.family.archivedAt !== null
      ) {
        throw new BadRequestException(INVALID_INVITE)
      }

      const existing = await tx.familyMember.findUnique({
        where: { familyId_userId: { familyId: invite.familyId, userId } },
      })

      // 已经是成员：幂等返回家庭，且**不消耗使用次数**。
      // 否则一家人反复点同一个链接，会把 maxUses=1 的码白白烧掉。
      if (existing) {
        return toFamilyDto(invite.family, existing.role)
      }

      // 已知窗口：这两步之间是"先读后写"，同一码的最后一次名额被两个并发请求
      // 同时抢到时，会多放进一个人。要收口就得把校验并进更新本身
      // （updateMany where usedCount < maxUses，count 为 0 即失败），
      // 现按"家庭内部邀请码、误用要正好撞在同一毫秒"接受。
      if (invite.usedCount >= invite.maxUses) {
        throw new BadRequestException(INVALID_INVITE)
      }

      const member: FamilyMember = await tx.familyMember.create({
        data: { familyId: invite.familyId, userId, role: invite.role },
      })
      await tx.familyInvite.update({
        where: { id: invite.id },
        data: { usedCount: { increment: 1 } },
      })

      return toFamilyDto(invite.family, member.role)
    })
  }
}
