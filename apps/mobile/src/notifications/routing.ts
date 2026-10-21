import type { NotificationDto } from '@moonbud/shared'

/**
 * 通知点下去该落在哪一页。
 *
 * 通知表里没有类型字段，能依据的只有 occurrenceId：到点的提醒一定带实例 id，
 * 找回密码请求一定不带（见 notifications.service.ts 与 reset-request.service.ts
 * 这两个唯一写入方）。找回请求的正文写着"请在成员列表里设置临时密码"，
 * 却把人送到提醒页，等于路标指反方向。
 */
export type NotificationTarget =
  | { kind: 'reminders' }
  | { kind: 'members'; familyId: string | null }

export function notificationTarget(
  item: Pick<NotificationDto, 'occurrenceId' | 'familyId'>,
): NotificationTarget {
  if (item.occurrenceId) return { kind: 'reminders' }
  return { kind: 'members', familyId: item.familyId || null }
}
