import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common'
import type { Notification, Reminder } from '@prisma/client'
import type { NotificationDto, Paginated } from '@moonbud/shared'
import { PrismaService } from '../prisma/prisma.service'
import { PUSH_PROVIDER, type PushProvider } from '../push/push-provider.interface'
import type { QueryNotificationsDto } from './dto/query-notifications.dto'

function toNotificationDto(notification: Notification): NotificationDto {
  return {
    id: notification.id,
    userId: notification.userId,
    familyId: notification.familyId,
    occurrenceId: notification.occurrenceId,
    title: notification.title,
    body: notification.body,
    readAt: notification.readAt?.toISOString() ?? null,
    createdAt: notification.createdAt.toISOString(),
  }
}

type ReminderWithChild = Reminder & { child: { name: string } | null }

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name)

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PUSH_PROVIDER) private readonly push: PushProvider,
  ) {}

  async list(userId: string, query: QueryNotificationsDto): Promise<Paginated<NotificationDto>> {
    const { page, pageSize, unreadOnly } = query
    const where = { userId, ...(unreadOnly ? { readAt: null } : {}) }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.notification.count({ where }),
    ])

    return { items: items.map(toNotificationDto), total, page, pageSize }
  }

  /**
   * `userId` 条件不可省：少了它就能标记别人的通知，是最典型的越权。
   * 重复标记是幂等的——已读再标一次不该报错。
   */
  async markRead(id: string, userId: string): Promise<NotificationDto> {
    const existing = await this.prisma.notification.findUnique({ where: { id } })
    if (!existing || existing.userId !== userId) {
      throw new NotFoundException('通知不存在')
    }
    if (existing.readAt !== null) return toNotificationDto(existing)

    const updated = await this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    })
    return toNotificationDto(updated)
  }

  async readAll(userId: string): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    })
    return { updated: result.count }
  }

  /**
   * 为一条已到期的实例生成站内通知并交给推送通道。
   *
   * 收件人规则（spec 第 6 节）：`assigneeId` 非空只发给该成员，为空发给
   * 全家成员。**自身不做幂等**——幂等由调用方（调度器）用 `firedAt` 保证，
   * 因为"这条实例通知过没有"是实例级的属性，不是通知服务能判断的。
   */
  async createForOccurrence(occurrenceId: string): Promise<number> {
    const occurrence = await this.prisma.reminderOccurrence.findUnique({
      where: { id: occurrenceId },
      include: { reminder: { include: { child: { select: { name: true } } } } },
    })
    if (!occurrence) {
      throw new NotFoundException('提醒实例不存在')
    }

    const reminder = occurrence.reminder as ReminderWithChild
    const recipients = await this.resolveRecipients(reminder)
    const body = buildBody(reminder)
    let created = 0

    for (const userId of recipients) {
      await this.prisma.notification.create({
        data: {
          userId,
          familyId: reminder.familyId,
          occurrenceId,
          title: reminder.title,
          body,
        },
      })
      created += 1
      await this.push.send(userId, reminder.title, body, {
        occurrenceId,
        reminderId: reminder.id,
        familyId: reminder.familyId,
      })
    }

    this.logger.debug(`实例 ${occurrenceId} 生成 ${created} 条通知`)
    return created
  }

  private async resolveRecipients(reminder: ReminderWithChild): Promise<string[]> {
    const members = await this.prisma.familyMember.findMany({
      where: { familyId: reminder.familyId },
      select: { userId: true },
    })
    const memberIds = members.map((m) => m.userId)

    if (reminder.assigneeId) {
      // 执行人已经退出家庭时发给全家：这条提醒不能因为一个人的离开而消失，
      // 但也不能继续把家庭内容推给一个不再是成员的人。
      return memberIds.includes(reminder.assigneeId) ? [reminder.assigneeId] : memberIds
    }
    // Set 去重：同一用户在一个家庭里只有一条成员记录，这里是兜底。
    return [...new Set(memberIds)]
  }
}

function buildBody(reminder: ReminderWithChild): string {
  const parts = [reminder.child?.name, reminder.note ?? '提醒到点了']
  return parts.filter((p): p is string => Boolean(p)).join(' · ')
}
