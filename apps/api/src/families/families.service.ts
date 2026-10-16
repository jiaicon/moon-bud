import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type { FamilyRole } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class FamiliesService {
  constructor(private readonly prisma: PrismaService) {}

  /** 事务内一次创建家庭与 OWNER 成员，避免出现没有任何所有者的家庭。 */
  async create(name: string, userId: string) {
    const family = await this.prisma.$transaction(async (tx) => {
      const created = await tx.family.create({ data: { name, ownerId: userId } })
      await tx.familyMember.create({
        data: { familyId: created.id, userId, role: 'OWNER' },
      })
      return created
    })
    return this.toDto(family, 'OWNER')
  }

  async listForUser(userId: string) {
    const memberships = await this.prisma.familyMember.findMany({
      where: { userId, family: { archivedAt: null } },
      include: { family: true },
      orderBy: { joinedAt: 'asc' },
    })
    return memberships.map((m) => this.toDto(m.family, m.role))
  }

  async detail(familyId: string, role: FamilyRole) {
    const family = await this.prisma.family.findUniqueOrThrow({ where: { id: familyId } })
    const members = await this.prisma.familyMember.findMany({
      where: { familyId },
      include: { user: { select: { nickname: true, username: true } } },
      orderBy: { joinedAt: 'asc' },
    })
    return {
      ...this.toDto(family, role),
      members: members.map((m) => ({
        id: m.id,
        userId: m.userId,
        role: m.role,
        displayName: m.displayName,
        joinedAt: m.joinedAt.toISOString(),
        nickname: m.user.nickname,
        username: m.user.username,
      })),
    }
  }

  async rename(familyId: string, name: string, role: FamilyRole) {
    const family = await this.prisma.family.update({ where: { id: familyId }, data: { name } })
    return this.toDto(family, role)
  }

  /** 归档而不是删除：家庭可能积累数年的记录，硬删不可接受。 */
  async archive(familyId: string, role: FamilyRole) {
    const family = await this.prisma.family.update({
      where: { id: familyId },
      data: { archivedAt: new Date() },
    })
    return this.toDto(family, role)
  }

  async transfer(familyId: string, fromUserId: string, toUserId: string) {
    const target = await this.prisma.familyMember.findUnique({
      where: { familyId_userId: { familyId, userId: toUserId } },
    })
    // 只能转让给本家庭成员，否则会把家庭交给一个没有上下文的外人。
    if (!target) throw new BadRequestException('只能转让给本家庭的成员')

    await this.prisma.$transaction([
      this.prisma.familyMember.update({
        where: { id: target.id },
        data: { role: 'OWNER' },
      }),
      this.prisma.familyMember.update({
        where: { familyId_userId: { familyId, userId: fromUserId } },
        data: { role: 'ADMIN' },
      }),
      this.prisma.family.update({ where: { id: familyId }, data: { ownerId: toUserId } }),
    ])

    return { ok: true }
  }

  async leave(familyId: string, userId: string) {
    const remainingOwners = await this.prisma.familyMember.count({
      where: { familyId, role: 'OWNER', userId: { not: userId } },
    })
    if (remainingOwners === 0) {
      throw new BadRequestException('家庭必须至少保留一名所有者，请先转让所有权')
    }
    await this.prisma.familyMember.delete({
      where: { familyId_userId: { familyId, userId } },
    })
  }

  private toDto(
    family: { id: string; name: string; ownerId: string; archivedAt: Date | null },
    role: FamilyRole,
  ) {
    return {
      id: family.id,
      name: family.name,
      ownerId: family.ownerId,
      role,
      archivedAt: family.archivedAt?.toISOString() ?? null,
    }
  }
}
