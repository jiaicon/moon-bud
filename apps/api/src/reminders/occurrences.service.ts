import { Injectable, Logger } from '@nestjs/common'
import type { Reminder, ReminderOccurrence } from '@prisma/client'
import { expandDueDates, type ReminderOccurrenceDto } from '@moonbud/shared'
import { PrismaService } from '../prisma/prisma.service'

/**
 * 首次物化的回看窗口。
 *
 * 24 小时而不是 7 天：一条"每天早 8 点"的提醒刚建好时，24 小时内一定有
 * 且只有一个触发时刻，所以列表当场就有东西可以点"完成本次"；而 7 天窗口
 * 会让用户刚建好的提醒立刻显示 7 条"错过的剂量"——那是凭空捏造的历史。
 */
const BACKFILL_WINDOW_MS = 24 * 60 * 60 * 1000

/** 安全上限：一条很久没扫的提醒最多回看 7 天，避免一次展开上万条。 */
const MAX_BACKFILL_MS = 7 * 24 * 60 * 60 * 1000

/** 单条提醒一次最多物化的实例数。 */
const EXPAND_LIMIT = 500

function toOccurrenceDto(occurrence: ReminderOccurrence): ReminderOccurrenceDto {
  return {
    id: occurrence.id,
    reminderId: occurrence.reminderId,
    dueAt: occurrence.dueAt.toISOString(),
    firedAt: occurrence.firedAt?.toISOString() ?? null,
    status: occurrence.status,
    completedBy: occurrence.completedBy,
    completedAt: occurrence.completedAt?.toISOString() ?? null,
  }
}

@Injectable()
export class OccurrencesService {
  private readonly logger = new Logger(OccurrencesService.name)

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 把"已经到期但还没有实例"的提醒补成实例，返回新建条数。
   *
   * 幂等由 `unique(reminderId, dueAt)` + `skipDuplicates` 共同保证：
   * 同一分钟扫两次不会多出任何一行（spec 第 6 节）。
   */
  async materializeDue(now: Date = new Date()): Promise<number> {
    // 归档家庭不参与调度：归档是硬边界，它的提醒不该继续产生实例与通知。
    const reminders = await this.prisma.reminder.findMany({
      where: { status: 'ACTIVE', family: { archivedAt: null } },
    })
    let created = 0

    for (const reminder of reminders) {
      try {
        created += await this.materializeOne(reminder, now)
      } catch (error) {
        // 一条 rrule 写坏的提醒不能让整轮扫描崩掉：记下来，继续下一条。
        this.logger.error(`提醒 ${reminder.id} 的实例生成失败: ${String(error)}`)
      }
    }

    return created
  }

  async list(reminderId: string): Promise<ReminderOccurrenceDto[]> {
    const rows = await this.prisma.reminderOccurrence.findMany({
      where: { reminderId },
      orderBy: { dueAt: 'asc' },
    })
    return rows.map(toOccurrenceDto)
  }

  private async materializeOne(reminder: Reminder, now: Date): Promise<number> {
    if (reminder.type === 'ONE_TIME') {
      if (!reminder.dueAt || reminder.dueAt.getTime() > now.getTime()) return 0
      const result = await this.prisma.reminderOccurrence.createMany({
        data: [{ reminderId: reminder.id, dueAt: reminder.dueAt }],
        skipDuplicates: true,
      })
      return result.count
    }

    if (!reminder.rrule) return 0

    const newest = await this.prisma.reminderOccurrence.findFirst({
      where: { reminderId: reminder.id },
      orderBy: { dueAt: 'desc' },
    })

    // 游标取"最后一条实例"与"提醒最后改动时刻"里更晚的那个。
    // 后者的作用是：计划改过之后，不会拿新规则去回填改动之前已经过去的时刻
    // ——那会凭空造出"你错过了"的记录。副作用是改标题也会推进游标，而
    // 每分钟扫描本来就会补齐缺口，所以最坏情况只差一轮。
    const cursor = newest
      ? Math.max(newest.dueAt.getTime(), reminder.updatedAt.getTime())
      : now.getTime() - BACKFILL_WINDOW_MS
    const from = new Date(Math.max(cursor, now.getTime() - MAX_BACKFILL_MS))

    const candidates = expandDueDates({
      rrule: reminder.rrule,
      timezone: reminder.timezone,
      from,
      to: now,
      limit: EXPAND_LIMIT,
    })
    if (candidates.length === 0) return 0

    const result = await this.prisma.reminderOccurrence.createMany({
      data: candidates.map((dueAt) => ({ reminderId: reminder.id, dueAt })),
      skipDuplicates: true,
    })
    return result.count
  }
}
