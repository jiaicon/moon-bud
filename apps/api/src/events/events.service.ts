import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import type { Child, Event, FamilyRole, Prisma } from '@prisma/client'
import {
  validateEventPayload,
  validateNote,
  type EventDto,
  type EventPayload,
  type EventType,
  type Paginated,
} from '@moonbud/shared'
import { PrismaService } from '../prisma/prisma.service'
import type { CreateEventDto } from './dto/create-event.dto'
import type { UpdateEventDto } from './dto/update-event.dto'
import type { QueryEventsDto } from './dto/query-events.dto'

type EventWithCreator = Event & { creator: { nickname: string } }

function toEventDto(event: EventWithCreator): EventDto {
  return {
    id: event.id,
    childId: event.childId,
    familyId: event.familyId,
    type: event.type as EventType,
    occurredAt: event.occurredAt.toISOString(),
    endedAt: event.endedAt?.toISOString() ?? null,
    payload: event.payload as EventPayload,
    note: event.note,
    createdBy: event.createdBy,
    createdByNickname: event.creator.nickname,
    updatedBy: event.updatedBy,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
  }
}

const INCLUDE_CREATOR = { creator: { select: { nickname: true } } } as const

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(familyId: string, userId: string, dto: CreateEventDto): Promise<EventDto> {
    await this.assertChildWritable(dto.childId, familyId)

    const payload = validatePayloadOrThrow(dto.type, dto.payload)
    assertNoteOrThrow(dto.note)
    assertIntervalOrThrow(dto.occurredAt, dto.endedAt)

    const data = {
      ...(dto.id ? { id: dto.id } : {}),
      childId: dto.childId,
      familyId,
      type: dto.type,
      occurredAt: new Date(dto.occurredAt),
      endedAt: dto.endedAt ? new Date(dto.endedAt) : null,
      payload: payload as Prisma.InputJsonValue,
      note: dto.note ?? null,
      createdBy: userId,
    }

    try {
      const event = await this.prisma.event.create({ data, include: INCLUDE_CREATOR })
      return toEventDto(event)
    } catch (err) {
      // 客户端自带 id 的重放：这条已经在库里。只认本家庭、未删的那一条，
      // 原样返回它（幂等）；别拿这个口子把别人家的记录读出来或盖掉。
      if (dto.id && isUniqueViolation(err)) {
        const existing = await this.prisma.event.findFirst({
          where: { id: dto.id, familyId, deletedAt: null },
          include: INCLUDE_CREATOR,
        })
        if (existing) return toEventDto(existing)
        throw new ConflictException('该记录 id 已被占用')
      }
      throw err
    }
  }

  async findAll(familyId: string, query: QueryEventsDto): Promise<Paginated<EventDto>> {
    const page = query.page
    const pageSize = query.pageSize
    // until 与 to 都是上界，取更早的那个（按时间戳比，不按字符串比——
    // 两个 ISO 串可能带不同时区偏移，字典序会给出错误答案）。
    const uppers = [query.to, query.until]
      .filter((v): v is string => Boolean(v))
      .map((v) => new Date(v).getTime())
    const upper = uppers.length > 0 ? new Date(Math.min(...uppers)) : undefined

    const where: Prisma.EventWhereInput = {
      familyId,
      // 软删除的记录永远不出现在任何列表里。
      deletedAt: null,
      ...(query.childId ? { childId: query.childId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.createdBy ? { createdBy: query.createdBy } : {}),
      ...(query.from || upper
        ? {
            occurredAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(upper ? { lte: upper } : {}),
            },
          }
        : {}),
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.event.findMany({
        where,
        include: INCLUDE_CREATOR,
        orderBy: { occurredAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.event.count({ where }),
    ])

    return { items: items.map(toEventDto), total, page, pageSize }
  }

  async update(
    familyId: string,
    eventId: string,
    userId: string,
    role: FamilyRole,
    dto: UpdateEventDto,
  ): Promise<EventDto> {
    const existing = await this.findInFamily(familyId, eventId)
    assertCanEdit(existing, userId, role)

    const type = dto.type ?? (existing.type as EventType)
    const occurredAt = dto.occurredAt ?? existing.occurredAt.toISOString()
    const endedAt =
      dto.endedAt === undefined ? existing.endedAt?.toISOString() : (dto.endedAt ?? undefined)

    // 改了内容就要重新过一遍校验：否则"先建合法的、再改成非法"是一条绕过路径。
    // type 变了而 payload 没跟着给，也要用新类型重验旧 payload——否则会留下
    // 一条类型与内容互不相干的记录。
    const contentChanged = dto.payload !== undefined || dto.type !== undefined
    const payload = contentChanged
      ? validatePayloadOrThrow(type, dto.payload ?? existing.payload)
      : (existing.payload as EventPayload)
    if (dto.note !== undefined) assertNoteOrThrow(dto.note ?? undefined)
    assertIntervalOrThrow(occurredAt, endedAt)

    const event = await this.prisma.event.update({
      where: { id: eventId },
      data: {
        ...(dto.type === undefined ? {} : { type: dto.type }),
        ...(dto.occurredAt === undefined ? {} : { occurredAt: new Date(dto.occurredAt) }),
        ...(dto.endedAt === undefined
          ? {}
          : { endedAt: dto.endedAt === null ? null : new Date(dto.endedAt) }),
        payload: payload as Prisma.InputJsonValue,
        ...(dto.note === undefined ? {} : { note: dto.note }),
        updatedBy: userId,
      },
      include: INCLUDE_CREATOR,
    })
    return toEventDto(event)
  }

  async softDelete(
    familyId: string,
    eventId: string,
    userId: string,
    role: FamilyRole,
  ): Promise<void> {
    const existing = await this.findInFamily(familyId, eventId)
    assertCanEdit(existing, userId, role)
    await this.prisma.event.update({ where: { id: eventId }, data: { deletedAt: new Date() } })
  }

  /**
   * "到 `until` 为止该类型最近的一条"。防重复照护提示用（Task 12/13）。
   * 未来时间的记录不算——否则一条录错时间的记录会让提示永远说"刚刚"。
   */
  async findLatestByType(
    childId: string,
    type: EventType,
    until: Date,
  ): Promise<EventDto | null> {
    const event = await this.prisma.event.findFirst({
      where: { childId, type, deletedAt: null, occurredAt: { lte: until } },
      include: INCLUDE_CREATOR,
      orderBy: { occurredAt: 'desc' },
    })
    return event ? toEventDto(event) : null
  }

  /**
   * 家庭作用域版的"最近一条"：先确认这个孩子属于这个家庭，再查。
   * 控制器不自己拼这两步，免得哪天有人只写了后一半。
   */
  async findLatestInFamily(
    familyId: string,
    childId: string,
    type: EventType,
    until: Date,
  ): Promise<EventDto | null> {
    await this.findChildInFamily(childId, familyId)
    return this.findLatestByType(childId, type, until)
  }

  /**
   * 记录必须挂在**本家庭**的孩子上。少了这一步，任何成员都能把记录写进
   * 别家的孩子，而记录本身会带着本家庭的 familyId——数据从此自相矛盾。
   *
   * 这里不挡归档：归档的边界是"不再往身上写"，不是把这家人的历史藏起来。
   * 读接口（最近一条、记录列表）要的正是那份历史，同一个孩子不能一处读得到、
   * 另一处 400。
   */
  private async findChildInFamily(childId: string, familyId: string): Promise<Child> {
    const child = await this.prisma.child.findUnique({ where: { id: childId } })
    if (!child || child.familyId !== familyId) {
      throw new BadRequestException('孩子不存在或不属于该家庭')
    }
    return child
  }

  /** 写路径的边界：本家庭 + 未归档。 */
  private async assertChildWritable(childId: string, familyId: string): Promise<void> {
    const child = await this.findChildInFamily(childId, familyId)
    if (child.archivedAt !== null) {
      throw new BadRequestException('该孩子已归档，无法新增记录')
    }
  }

  private async findInFamily(familyId: string, eventId: string): Promise<Event> {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } })
    if (!event || event.familyId !== familyId || event.deletedAt !== null) {
      throw new NotFoundException('记录不存在')
    }
    return event
  }
}

/** 编辑/删除只限创建者本人或 ADMIN/OWNER（spec 第 4 节）。 */
function assertCanEdit(event: Event, userId: string, role: FamilyRole): void {
  if (event.createdBy !== userId && role !== 'OWNER' && role !== 'ADMIN') {
    throw new ForbiddenException('只能修改或删除自己记录的，或由管理员操作')
  }
}

function validatePayloadOrThrow(type: EventType, payload: unknown): EventPayload {
  const result = validateEventPayload(type, payload)
  if (!result.ok) {
    throw new BadRequestException(result.errors)
  }
  return result.data
}

/** Prisma 唯一约束冲突（P2002）。幂等创建要靠它区分"这条已经在库里"和真错误。 */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002'
  )
}

function assertNoteOrThrow(note: string | undefined): void {
  const result = validateNote(note)
  if (result && !result.ok) {
    throw new BadRequestException(result.errors)
  }
}

function assertIntervalOrThrow(occurredAt: string, endedAt: string | undefined): void {
  if (endedAt === undefined || endedAt === null) return
  if (new Date(endedAt).getTime() <= new Date(occurredAt).getTime()) {
    throw new BadRequestException('endedAt：结束时间必须晚于开始时间')
  }
}
