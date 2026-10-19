import { dayKeyIn } from '../events/summary'
import { wallStamp } from '../utils/wall-time'

/**
 * 提醒的钟点与"今天/明天"必须按提醒自己的时区念出来：
 * 设备在别的时区时，按设备算会把凌晨的提醒写成昨天。
 * 时区名非法或环境没有 Intl 时退回设备本地时间 —— 报个时间总比"待定"有用。
 */
export function formatDueIn(timezone: string, when: Date | null | undefined, now: Date = new Date()): string {
  if (!when || Number.isNaN(when.getTime())) return '待定'
  const clock = clockIn(timezone, when)
  const key = dayKeyIn(timezone, when)
  if (key === dayKeyIn(timezone, now)) {
    // "今天 08:00"在晚上看像还没到，而它其实已经过了。列表里"待办"和"已过期"
    // 两栏都可能画同一条提醒，这一行时间是唯一线索，不能说反。
    return when.getTime() <= now.getTime() ? `今天 ${clock}（已过）` : `今天 ${clock}`
  }
  if (key === adjacentDayKey(timezone, now, 1)) return `明天 ${clock}`
  if (key === adjacentDayKey(timezone, now, -1)) return `昨天 ${clock}`
  const [, month, day] = key.split('-').map(Number)
  return `${month}月${day}日 ${clock}`
}

/**
 * "今天 ± N 天"要按墙上日期算，不能给瞬间加 24 小时：夏令时切换那天有 23 或 25 个小时，
 * 加满一天会落在同一天的深夜，"明天"就被念成了月日。
 */
function adjacentDayKey(timezone: string, now: Date, offsetDays: number): string {
  const { year, month, day } = wallStamp(timezone, now)
  const shifted = new Date(Date.UTC(year, month - 1, day) + offsetDays * 86_400_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`
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
