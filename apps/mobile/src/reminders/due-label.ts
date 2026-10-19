import { dayKeyIn } from '../events/summary'

/**
 * 提醒的钟点与"今天/明天"必须按提醒自己的时区念出来：
 * 设备在别的时区时，按设备算会把凌晨的提醒写成昨天。
 * 时区名非法或环境没有 Intl 时退回设备本地时间 —— 报个时间总比"待定"有用。
 */
export function formatDueIn(timezone: string, when: Date | null | undefined, now: Date = new Date()): string {
  if (!when || Number.isNaN(when.getTime())) return '待定'
  const clock = clockIn(timezone, when)
  const key = dayKeyIn(timezone, when)
  if (key === dayKeyIn(timezone, now)) return `今天 ${clock}`
  if (key === dayKeyIn(timezone, new Date(now.getTime() + 86_400_000))) return `明天 ${clock}`
  const [, month, day] = key.split('-').map(Number)
  return `${month}月${day}日 ${clock}`
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
