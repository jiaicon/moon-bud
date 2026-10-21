import { expandDueDates, type ReminderType } from '@moonbud/shared'

export interface WindowSource {
  type: ReminderType
  dueAt: string | null
  rrule: string | null
  timezone: string
  /**
   * 提醒的创建时刻：INTERVAL>1 的周期网格由它对齐。不传就退回"窗口起点"，
   * 而窗口每次进前台都往前滑，"每两天"那一档会天天重排，响的那天跟着漂。
   */
  createdAt?: string | null
}

/**
 * 排期窗口只有三天。plus 的通知只有"在某一刻响一次"，所以只排下一次的话，
 * 家长当天没碰 App，第二天起就永久失声；窗口拉长到一个月则是往系统通知器里
 * 塞几百条排期，改一次时间要重建全部。三天 + 每次进前台重算，覆盖得住。
 */
export const SCHEDULE_HORIZON_MS = 3 * 86_400_000

/**
 * (now, now + 窗口] 内所有会触发的时刻，升序。
 * 任何坏输入都返回空数组：一条读不懂的提醒不该把全家其它提醒的排期一起带走。
 */
export function occurrencesWithinWindow(
  source: WindowSource,
  now: Date = new Date(),
  horizonMs = SCHEDULE_HORIZON_MS,
): Date[] {
  const endMs = now.getTime() + horizonMs

  if (source.type === 'ONE_TIME') {
    if (!source.dueAt) return []
    const at = new Date(source.dueAt)
    if (Number.isNaN(at.getTime())) return []
    return at.getTime() > now.getTime() && at.getTime() <= endMs ? [at] : []
  }

  if (!source.rrule) return []
  const anchor = source.createdAt ? new Date(source.createdAt) : null
  const listed = expandDueDates({
    rrule: source.rrule,
    timezone: source.timezone,
    from: now,
    to: new Date(endMs),
    anchor: anchor && !Number.isNaN(anchor.getTime()) ? anchor : null,
  })
  return listed.filter((at) => at.getTime() > now.getTime() && at.getTime() <= endMs)
}
