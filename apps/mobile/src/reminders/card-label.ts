import { computeDueAt, type ReminderDto } from '@moonbud/shared'
import { formatDueIn, formatOverdueIn } from './due-label'

/**
 * 提醒卡片上那一行时间。
 *
 * 三个状态必须互相区分开，因为家长只扫这一眼：
 * 还欠着一次没做（说欠的是哪一次）、还没到点（说下次）、时间没设（直说）。
 * 欠着的时候绝不能只报"下次 明天 08:00"——那读起来像一切都按部就班，
 * 而今早那次其实谁都没点。
 */
export function reminderCardLabel(reminder: ReminderDto, now: Date = new Date()): string {
  const period = reminder.type === 'ONE_TIME' ? null : rruleHint(reminder.rrule)

  const overdue = reminder.overdueSince ? new Date(reminder.overdueSince) : null
  if (overdue && !Number.isNaN(overdue.getTime())) {
    const text = formatOverdueIn(reminder.timezone, overdue, now)
    return period ? `${period} · ${text}` : text
  }

  const next = nextDue(reminder, now)
  if (reminder.type === 'ONE_TIME') {
    return next ? formatDueIn(reminder.timezone, next, now) : '未设定时间'
  }
  const time = next ? formatDueIn(reminder.timezone, next, now) : '待定'
  return `${period} · 下次 ${time}`
}

/**
 * 后端列表里重复提醒的 dueAt 是 null（下一次由调度器按周期展开），
 * 直接显示会得到"下次 待定"。客户端用同一个 computeDueAt 把下次触发算出来，
 * 家长才知道"今天这点还要不要做"。
 */
function nextDue(reminder: ReminderDto, now: Date): Date | null {
  if (reminder.type === 'ONE_TIME') return reminder.dueAt ? new Date(reminder.dueAt) : null
  if (reminder.dueAt) {
    const at = new Date(reminder.dueAt)
    if (!Number.isNaN(at.getTime()) && at.getTime() > now.getTime()) return at
  }
  const anchor = new Date(reminder.createdAt)
  return computeDueAt({
    type: reminder.type,
    dueAt: reminder.dueAt ? new Date(reminder.dueAt) : null,
    rrule: reminder.rrule,
    timezone: reminder.timezone,
    after: now,
    // "下次"要和调度器落在同一张网格上，否则每 N 天那一档的卡片日期天天往后跑。
    anchor: Number.isNaN(anchor.getTime()) ? null : anchor,
  })
}

function rruleHint(rrule: string | null): string {
  if (!rrule) return '重复'
  if (rrule.includes('FREQ=DAILY')) {
    return rrule.includes('INTERVAL') ? `每 ${intervalOf(rrule)} 天` : '每天'
  }
  if (rrule.includes('FREQ=WEEKLY')) return '每周'
  if (rrule.includes('FREQ=MONTHLY')) return '每月'
  return '重复'
}

function intervalOf(rrule: string): string {
  const m = /INTERVAL=(\d+)/.exec(rrule)
  return m ? m[1] : '?'
}
