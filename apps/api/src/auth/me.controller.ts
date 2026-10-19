import { Body, Controller, Get, Patch } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { MeResponse, UserDto } from '@moonbud/shared'
import { PrismaService } from '../prisma/prisma.service'
import { toUserDto } from './auth.service'
import { CurrentUser, type AuthUser } from './current-user.decorator'
import { UpdateMeDto } from './dto/update-me.dto'

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
      mustChangePassword: row.mustChangePassword,
      families: memberships.map((m) => ({
        id: m.family.id,
        name: m.family.name,
        ownerId: m.family.ownerId,
        role: m.role,
        archivedAt: m.family.archivedAt?.toISOString() ?? null,
      })),
    }
  }

  /**
   * 改账号时区。注册时这个值是设备那块表静默定的，看不见也改不了，于是设备时钟
   * 设错过、在国外注册过的人，之后每一屏的"几点"都是错的，且没有自救入口。
   *
   * 只改"怎么看"，不改"已经记下了什么"：事件与提醒存的是时刻，改完它们还在原来的
   * 瞬间上；提醒还各自带着自己那一份 timezone（家庭共用的东西，不能因为一个人搬了
   * 城市就替全家的日程改时间）。
   */
  @Patch()
  async update(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto): Promise<UserDto> {
    const row = await this.prisma.user.update({
      where: { id: user.id },
      data: { timezone: dto.timezone },
    })
    return toUserDto(row)
  }
}
