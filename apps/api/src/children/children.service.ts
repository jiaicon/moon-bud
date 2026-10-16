import { Injectable, NotFoundException } from '@nestjs/common'
import type { Child } from '@prisma/client'
import type { ChildDto } from '@moonbud/shared'
import { PrismaService } from '../prisma/prisma.service'
import type { CreateChildDto } from './dto/create-child.dto'
import type { UpdateChildDto } from './dto/update-child.dto'

/** birthday 是 `@db.Date`：库里是 UTC 零点的日期，JSON 里必须是纯日期串。 */
function toChildDto(child: Child): ChildDto {
  return {
    id: child.id,
    familyId: child.familyId,
    name: child.name,
    gender: child.gender,
    birthday: child.birthday.toISOString().slice(0, 10),
    avatarUrl: child.avatarUrl,
    archivedAt: child.archivedAt?.toISOString() ?? null,
  }
}

function birthdayToDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

@Injectable()
export class ChildrenService {
  constructor(private readonly prisma: PrismaService) {}

  async list(familyId: string): Promise<ChildDto[]> {
    const rows = await this.prisma.child.findMany({
      where: { familyId, archivedAt: null },
      orderBy: { createdAt: 'asc' },
    })
    return rows.map(toChildDto)
  }

  async create(familyId: string, dto: CreateChildDto): Promise<ChildDto> {
    const child = await this.prisma.child.create({
      data: {
        familyId,
        name: dto.name,
        gender: dto.gender ?? 'UNKNOWN',
        birthday: birthdayToDate(dto.birthday),
        avatarUrl: dto.avatarUrl ?? null,
      },
    })
    return toChildDto(child)
  }

  async update(familyId: string, childId: string, dto: UpdateChildDto): Promise<ChildDto> {
    await this.findInFamily(familyId, childId)
    const child = await this.prisma.child.update({
      where: { id: childId },
      data: {
        ...(dto.name === undefined ? {} : { name: dto.name }),
        ...(dto.gender === undefined ? {} : { gender: dto.gender }),
        ...(dto.birthday === undefined ? {} : { birthday: birthdayToDate(dto.birthday) }),
        ...(dto.avatarUrl === undefined ? {} : { avatarUrl: dto.avatarUrl }),
      },
    })
    return toChildDto(child)
  }

  /**
   * 软删除。硬删会级联带走这个孩子的全部记录——一个家庭几个月的喂养
   * 历史不该因为一次误点而消失（spec 第 2 节的"记录丢失不可接受"）。
   */
  async archive(familyId: string, childId: string): Promise<void> {
    await this.findInFamily(familyId, childId)
    await this.prisma.child.update({ where: { id: childId }, data: { archivedAt: new Date() } })
  }

  /** 孩子的 id 只在所属家庭里有效；别家的 id 一律当作不存在。 */
  private async findInFamily(familyId: string, childId: string): Promise<Child> {
    const child = await this.prisma.child.findUnique({ where: { id: childId } })
    if (!child || child.familyId !== familyId) {
      throw new NotFoundException('孩子不存在')
    }
    return child
  }
}
