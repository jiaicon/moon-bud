import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { NotificationsService } from '../notifications/notifications.service'
import { PrismaService } from '../prisma/prisma.service'
import { OccurrencesService } from './occurrences.service'

export interface TickResult {
  created: number
  notified: number
}

/**
 * 每分钟扫描一次提醒（spec 第 6 节阶段一）。
 *
 * 两条设计要点：
 *  1. **幂等**：实例靠 `unique(reminderId, dueAt)` 去重，通知靠实例上的
 *     `firedAt` 只发一次。重复跑不会重复打扰。
 *  2. **错误隔离**：任何一条提醒、任何一次通知失败都不能让整轮扫描崩掉——
 *     每分钟跑的东西一旦抛错，`@nestjs/schedule` 会持续记录未处理异常。
 */
@Injectable()
export class ReminderSchedulerService {
  private readonly logger = new Logger(ReminderSchedulerService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly occurrences: OccurrencesService,
    private readonly notifications: NotificationsService,
  ) {}

  /** 单轮扫描。`now` 可注入，测试因此不需要等真实时间。 */
  async tick(now: Date = new Date()): Promise<TickResult> {
    const created = await this.occurrences.materializeDue(now)

    // 到期且还没通知过的实例（包含刚生成的那批）。
    // 归档家庭被排除在外：归档是硬边界，不该再收到提醒。
    const due = await this.prisma.reminderOccurrence.findMany({
      where: {
        dueAt: { lte: now },
        firedAt: null,
        reminder: { status: 'ACTIVE', family: { archivedAt: null } },
      },
      orderBy: { dueAt: 'asc' },
    })

    let notified = 0
    for (const occurrence of due) {
      try {
        notified += await this.notifications.createForOccurrence(occurrence.id)
      } catch (error) {
        this.logger.error(`实例 ${occurrence.id} 的通知生成失败: ${String(error)}`)
      } finally {
        // 成功失败都标记 firedAt。失败的这条不再每分钟重试：
        // "重复轰炸"比"漏一次"更快让用户关掉通知（spec 反目标）。
        await this.prisma.reminderOccurrence.update({
          where: { id: occurrence.id },
          data: { firedAt: now },
        })
      }
    }

    return { created, notified }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron(): Promise<void> {
    try {
      const result = await this.tick()
      this.logger.log(`提醒扫描完成：新建实例 ${result.created} 条，发出通知 ${result.notified} 条`)
    } catch (error) {
      // 绝不让异常逃出 cron。
      this.logger.error(`提醒扫描整体失败: ${String(error)}`)
    }
  }
}
