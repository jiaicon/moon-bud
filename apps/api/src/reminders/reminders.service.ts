import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type { Prisma, Reminder } from '@prisma/client'
import type { Paginated, ReminderDto } from '@moonbud/shared'
import { PrismaService } from '../prisma/prisma.service'
import { OccurrencesService } from './occurrences.service'
import type { CreateReminderDto } from './dto/create-reminder.dto'
import type { UpdateReminderDto } from './dto/update-reminder.dto'
import type { QueryRemindersDto } from './dto/query-reminders.dto'

function toReminderDto(reminder: Reminder): ReminderDto {
  return {
    id: reminder.id,
    familyId: reminder.familyId,
    childId: reminder.childId,
    title: reminder.title,
    note: reminder.note,
    type: reminder.type,
    dueAt: reminder.dueAt?.toISOString() ?? null,
    rrule: reminder.rrule,
    timezone: reminder.timezone,
    assigneeId: reminder.assigneeId,
    status: reminder.status,
    createdBy: reminder.createdBy,
    createdAt: reminder.createdAt.toISOString(),
  }
}

@Injectable()
export class RemindersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly occurrences: OccurrencesService,
  ) {}

  async create(familyId: string, userId: string, dto: CreateReminderDto): Promise<ReminderDto> {
    assertShape(dto.type, dto.dueAt, dto.rrule)
    if (dto.childId) await this.assertChildInFamily(dto.childId, familyId)
    if (dto.assigneeId) await this.assertFamilyMember(dto.assigneeId, familyId)

    const timezone =
      dto.timezone ??
      (await this.prisma.user.findUniqueOrThrow({ where: { id: userId } })).timezone

    const reminder = await this.prisma.reminder.create({
      data: {
        familyId,
        childId: dto.childId ?? null,
        title: dto.title,
        note: dto.note ?? null,
        type: dto.type,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
        rrule: dto.rrule ?? null,
        timezone,
        assigneeId: dto.assigneeId ?? null,
        createdBy: userId,
      },
    })
    return toReminderDto(reminder)
  }

  async list(familyId: string, query: QueryRemindersDto): Promise<Paginated<ReminderDto>> {
    const { page, pageSize } = query
    const where = buildWhere(familyId, query.status)

    const [items, total] = await this.prisma.$transaction([
      this.prisma.reminder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.reminder.count({ where }),
    ])

    return { items: items.map(toReminderDto), total, page, pageSize }
  }

  async detail(familyId: string, reminderId: string): Promise<ReminderDto> {
    const reminder = await this.findInFamily(familyId, reminderId)
    // 读的时候顺手补齐到期实例：客户端不必等下一次 cron 才能看到"今天这次"。
    await this.occurrences.materializeDue()
    return toReminderDto(reminder)
  }

  async update(
    familyId: string,
    reminderId: string,
    dto: UpdateReminderDto,
  ): Promise<ReminderDto> {
    const reminder = await this.findInFamily(familyId, reminderId)
    if (dto.childId) await this.assertChildInFamily(dto.childId, familyId)
    if (dto.assigneeId) await this.assertFamilyMember(dto.assigneeId, familyId)

    // 计划真的变了，才需要清理实例。"计划"= 什么时候触发：rrule / dueAt / timezone。
    const scheduleChanged =
      (dto.rrule !== undefined && dto.rrule !== reminder.rrule) ||
      (dto.timezone !== undefined && dto.timezone !== reminder.timezone) ||
      (dto.dueAt !== undefined &&
        new Date(dto.dueAt).getTime() !== (reminder.dueAt?.getTime() ?? 0))

    const data: Prisma.ReminderUpdateInput = {
      ...(dto.title === undefined ? {} : { title: dto.title }),
      ...(dto.note === undefined ? {} : { note: dto.note }),
      ...(dto.dueAt === undefined ? {} : { dueAt: new Date(dto.dueAt) }),
      ...(dto.rrule === undefined ? {} : { rrule: dto.rrule }),
      ...(dto.timezone === undefined ? {} : { timezone: dto.timezone }),
      ...(dto.childId === undefined ? {} : { childId: dto.childId }),
      ...(dto.assigneeId === undefined ? {} : { assigneeId: dto.assigneeId }),
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.reminder.update({ where: { id: reminderId }, data })
      if (scheduleChanged) {
        // 只删"还没到的"待办实例：已经到点没完成的（过去）与已完成的都是历史，
        // 换计划不该把它们抹掉。
        await tx.reminderOccurrence.deleteMany({
          where: { reminderId, status: 'PENDING', dueAt: { gt: new Date() } },
        })
      }
      return next
    })

    return toReminderDto(updated)
  }

  /**
   * "完成"的语义按类型分开（spec 第 9 节：重复提醒只完本次）。
   * 取消是另一回事：DELETE 走 cancel。
   */
  async complete(
    familyId: string,
    reminderId: string,
    occurrenceId: string | undefined,
    userId: string,
  ): Promise<ReminderDto> {
    const reminder = await this.findInFamily(familyId, reminderId)
    const now = new Date()

    if (reminder.type === 'ONE_TIME') {
      const dueAt = reminder.dueAt ?? now
      const [, updated] = await this.prisma.$transaction([
        this.prisma.reminderOccurrence.upsert({
          where: { reminderId_dueAt: { reminderId, dueAt } },
          create: { reminderId, dueAt, status: 'DONE', completedBy: userId, completedAt: now },
          update: { status: 'DONE', completedBy: userId, completedAt: now },
        }),
        this.prisma.reminder.update({ where: { id: reminderId }, data: { status: 'DONE' } }),
      ])
      return toReminderDto(updated)
    }

    // 重复提醒：只关掉这一个实例，系列本身继续 ACTIVE。
    await this.occurrences.materializeDue(now)
    const target = occurrenceId
      ? await this.prisma.reminderOccurrence.findUnique({ where: { id: occurrenceId } })
      : await this.prisma.reminderOccurrence.findFirst({
          where: { reminderId, status: 'PENDING' },
          orderBy: { dueAt: 'asc' },
        })

    if (!target || target.reminderId !== reminderId) {
      throw new NotFoundException('实例不存在')
    }

    await this.prisma.reminderOccurrence.update({
      where: { id: target.id },
      data: { status: 'DONE', completedBy: userId, completedAt: now },
    })
    return toReminderDto(reminder)
  }

  /**
   * 取消而不是删除：提醒的历史（谁在什么时候完成过）必须留着。
   * 未触发的实例置 SKIPPED，已完成的原样保留。
   */
  async cancel(familyId: string, reminderId: string): Promise<void> {
    await this.findInFamily(familyId, reminderId)
    await this.prisma.$transaction([
      this.prisma.reminderOccurrence.updateMany({
        where: { reminderId, status: 'PENDING' },
        data: { status: 'SKIPPED' },
      }),
      this.prisma.reminder.update({ where: { id: reminderId }, data: { status: 'CANCELLED' } }),
    ])
  }

  async listOccurrences(familyId: string, reminderId: string) {
    await this.findInFamily(familyId, reminderId)
    // 读列表时先补齐到期实例：否则"完成本次"在第一次 cron 之前无从下手。
    await this.occurrences.materializeDue()
    return this.occurrences.list(reminderId)
  }

  private async findInFamily(familyId: string, reminderId: string): Promise<Reminder> {
    const reminder = await this.prisma.reminder.findUnique({ where: { id: reminderId } })
    if (!reminder || reminder.familyId !== familyId) {
      throw new NotFoundException('提醒不存在')
    }
    return reminder
  }

  private async assertChildInFamily(childId: string, familyId: string): Promise<void> {
    const child = await this.prisma.child.findUnique({ where: { id: childId } })
    if (!child || child.familyId !== familyId) {
      throw new BadRequestException('孩子不存在或不属于该家庭')
    }
  }

  /** 执行人必须是本家庭成员：否则通知会发给一个跟这个家庭无关的人。 */
  private async assertFamilyMember(userId: string, familyId: string): Promise<void> {
    const member = await this.prisma.familyMember.findUnique({
      where: { familyId_userId: { familyId, userId } },
    })
    if (!member) {
      throw new BadRequestException('执行人不是本家庭成员')
    }
  }
}

function assertShape(type: string, dueAt?: string, rrule?: string): void {
  if (type === 'ONE_TIME' && !dueAt) {
    throw new BadRequestException('一次性提醒必须给出 dueAt')
  }
  if (type === 'RECURRING' && !rrule) {
    throw new BadRequestException('重复提醒必须给出 rrule')
  }
}

/** `OVERDUE` 不是库里的状态，而是"活跃 + 有到期未完成的实例"（spec 第 9 节）。 */
function buildWhere(familyId: string, status?: string): Prisma.ReminderWhereInput {
  if (status === 'OVERDUE') {
    return {
      familyId,
      status: 'ACTIVE',
      occurrences: { some: { status: 'PENDING', dueAt: { lt: new Date() } } },
    }
  }
  if (status === 'ACTIVE' || status === 'DONE' || status === 'CANCELLED') {
    return { familyId, status }
  }
  return { familyId }
}
