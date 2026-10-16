import { Controller, Get } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { MeResponse } from '@moonbud/shared'
import { PrismaService } from '../prisma/prisma.service'
import { toUserDto } from './auth.service'
import { CurrentUser, type AuthUser } from './current-user.decorator'

@ApiTags('我的')
@Controller('me')
export class MeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async me(@CurrentUser() user: AuthUser): Promise<MeResponse> {
    const [row, memberships] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
      // 只返回未归档的家庭：归档家庭不出现在切换列表里。
      this.prisma.familyMember.findMany({
        where: { userId: user.id, family: { archivedAt: null } },
        include: { family: true },
        orderBy: { joinedAt: 'asc' },
      }),
    ])

    return {
      user: toUserDto(row),
      families: memberships.map((m) => ({
        id: m.family.id,
        name: m.family.name,
        ownerId: m.family.ownerId,
        role: m.role,
        archivedAt: m.family.archivedAt?.toISOString() ?? null,
      })),
    }
  }
}
