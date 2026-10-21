import { adjacentDayKey, dayKeyIn } from '../events/summary'

/**
 * 提醒的钟点与"今天/明天"必须按提醒自己的时区念出来：
 * 设备在别的时区时，按设备算会把凌晨的提醒写成昨天。
 * 时区名非法或环境没有 Intl 时退回设备本地时间 —— 报个时间总比"待定"有用。
 */
export function formatDueIn(timezone: string, when: Date | null | undefined, now: Date = new Date()): string {
  if (!when || Number.isNaN(when.getTime())) return '待定'
  const day = dayName(timezone, when, now)
  const clock = clockIn(timezone, when)
  if (day !== '今天') return `${day} ${clock}`
  // "今天 08:00"在晚上看像还没到，而它其实已经过了。列表里"待办"和"已过期"
  // 两栏都可能画同一条提醒，这一行时间是唯一线索，不能说反。
  return when.getTime() <= now.getTime() ? `今天 ${clock}（已过）` : `今天 ${clock}`
}

/**
 * 重复提醒"还欠着"的那一次。
 *
 * 只能由服务端告诉客户端：周期本身算不出"哪一次已被家里人点掉"，
 * 按周期回推会把昨晚做过的那次也说成没过。
 * "还欠"本身就是过去时，所以不再叠一个"（已过）"。
 */
export function formatOverdueIn(timezone: string, when: Date | null | undefined, now: Date = new Date()): string {
  if (!when || Number.isNaN(when.getTime())) return '还欠 待定'
  return `还欠 ${dayName(timezone, when, now)} ${clockIn(timezone, when)}`
}

function dayName(timezone: string, when: Date, now: Date): string {
  const key = dayKeyIn(timezone, when)
  if (key === dayKeyIn(timezone, now)) return '今天'
  if (key === adjacentDayKey(timezone, now, 1)) return '明天'
  if (key === adjacentDayKey(timezone, now, -1)) return '昨天'
  const [, month, day] = key.split('-').map(Number)
  return `${month}月${day}日`
}

function clockIn(timezone: string, when: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(when)
    const hour = parts.find((p) => p.type === 'hour')?.value
    const minute = parts.find((p) => p.type === 'minute')?.value
    if (hour && minute) return `${hour}:${minute}`
  } catch {
    // 落到本地兜底
  }
  return `${pad(when.getHours())}:${pad(when.getMinutes())}`
}
