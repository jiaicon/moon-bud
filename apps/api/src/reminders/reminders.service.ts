import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, type Reminder } from '@prisma/client'
import { isEventType, validateEventPayload } from '@moonbud/shared'
import type { EventPayload, EventType, Paginated, ReminderDto } from '@moonbud/shared'
import { PrismaService } from '../prisma/prisma.service'
import { OccurrencesService } from './occurrences.service'
import type { CreateReminderDto } from './dto/create-reminder.dto'
import type { UpdateReminderDto } from './dto/update-reminder.dto'
import type { QueryRemindersDto } from './dto/query-reminders.dto'

function toReminderDto(reminder: Reminder, overdueSince: Date | null = null): ReminderDto {
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
    // 库里是裸 String（加类型不必迁移），读回来在这里收窄；不在 EVENT_TYPES 里的脏值当没有动作。
    eventType: isEventType(reminder.eventType) ? reminder.eventType : null,
    actionPayload: (reminder.actionPayload as EventPayload | null) ?? null,
    status: reminder.status,
    createdBy: reminder.createdBy,
    createdAt: reminder.createdAt.toISOString(),
    overdueSince: overdueSince?.toISOString() ?? null,
  }
}

/**
 * 提醒动作的写入规则，第一期唯一的判定点（第二期 AI 也走这里）：
 * 有类型必须有孩子；预填非空必须过该类型的完整校验；没有类型就没有预填；
 * 类型变了等于换了一件事，旧预填不能跟着走。
 *
 * `current` 是库里已有的那条，PATCH 用它区分"这次没动的部分"。null = 新增。
 */
function resolveAction(
  input: { eventType?: EventType | null; actionPayload?: Record<string, unknown> | null },
  childId: string | null,
  current: Reminder | null,
): { eventType: string | null; actionPayload: Prisma.InputJsonValue | typeof Prisma.DbNull } {
  const typeTouched = input.eventType !== undefined
  const eventType = typeTouched ? (input.eventType ?? null) : (current?.eventType ?? null)

  // 带了预填就用它；没带但改了类型就清空；两者都没动才沿用库里那条。
  const payload =
    input.actionPayload !== undefined
      ? (input.actionPayload ?? null)
      : typeTouched
        ? null
        : ((current?.actionPayload as Record<string, unknown> | null) ?? null)

  if (eventType && !childId) throw new BadRequestException('带动作的提醒必须挂在某个孩子上')
  if (!eventType && payload) {
    throw new BadRequestException('没有记录类型就没有预填：请先选类型，或把预填一起清掉')
  }
  if (eventType && payload) {
    if (!isEventType(eventType)) throw new BadRequestException('未知的记录类型')
    const result = validateEventPayload(eventType, payload)
    if (!result.ok) throw new BadRequestException(`预填不完整：${result.errors.join('；')}`)
  }

  return {
    eventType: eventType ?? null,
    // 可空 JSON 只能用 DbNull 表达"没有"：写 null 会被 Prisma 拒绝（它表示 JSON 字面量 null）。
    actionPayload: payload === null ? Prisma.DbNull : (payload as Prisma.InputJsonValue),
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

    const action = resolveAction(
      { eventType: dto.eventType, actionPayload: dto.actionPayload },
      dto.childId ?? null,
      null,
    )

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
        eventType: action.eventType,
        actionPayload: action.actionPayload,
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

    const overdue = await this.earliestOverdue(items.map((r) => r.id))
    return {
      items: items.map((r) => toReminderDto(r, overdue.get(r.id) ?? null)),
      total,
      page,
      pageSize,
    }
  }

  async detail(familyId: string, reminderId: string): Promise<ReminderDto> {
    const reminder = await this.findInFamily(familyId, reminderId)
    // 读的时候顺手补齐到期实例：客户端不必等下一次 cron 才能看到"今天这次"。
    await this.occurrences.materializeDue()
    const overdue = await this.earliestOverdue([reminderId])
    return toReminderDto(reminder, overdue.get(reminderId) ?? null)
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

    // 生效的孩子：这次没提就沿用库里那条，显式 null 表示摘掉孩子（也算没孩子）。
    const action = resolveAction(
      { eventType: dto.eventType, actionPayload: dto.actionPayload },
      dto.childId === undefined ? reminder.childId : dto.childId,
      reminder,
    )

    const data: Prisma.ReminderUpdateInput = {
      ...(dto.title === undefined ? {} : { title: dto.title }),
      ...(dto.note === undefined ? {} : { note: dto.note }),
      ...(dto.dueAt === undefined ? {} : { dueAt: new Date(dto.dueAt) }),
      ...(dto.rrule === undefined ? {} : { rrule: dto.rrule }),
      ...(dto.timezone === undefined ? {} : { timezone: dto.timezone }),
      ...(dto.childId === undefined ? {} : { childId: dto.childId }),
      ...(dto.assigneeId === undefined ? {} : { assigneeId: dto.assigneeId }),
      eventType: action.eventType,
      actionPayload: action.actionPayload,
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
    // 还欠着别的日子就说还欠着：这里回的是"做完这一次之后"最早那条没过的那次，
    // 不是做完之前的那一条。
    const overdue = await this.earliestOverdue([reminderId])
    return toReminderDto(reminder, overdue.get(reminderId) ?? null)
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

  /**
   * 每条提醒"最早那条还没做的过期实例"，一次查完整页。
   *
   * 客户端自己算不出来：它看得见 rrule，看不见哪一次已经被家里人点掉，
   * 按周期回推会把"昨晚做过的"也说成没过。而这是整页一次查询，不是每条一发。
   */
  private async earliestOverdue(reminderIds: string[]): Promise<Map<string, Date>> {
    if (reminderIds.length === 0) return new Map()
    const rows = await this.prisma.reminderOccurrence.findMany({
      where: { reminderId: { in: reminderIds }, status: 'PENDING', dueAt: { lt: new Date() } },
      orderBy: { dueAt: 'asc' },
      select: { reminderId: true, dueAt: true },
    })
    const earliest = new Map<string, Date>()
    for (const row of rows) {
      // dueAt 升序，第一条就是最早的那次。
      if (!earliest.has(row.reminderId)) earliest.set(row.reminderId, row.dueAt)
    }
    return earliest
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
