import { dayKeyIn } from './summary'

export interface DayGroup<T> {
  key: string
  label: string
  items: T[]
}

/**
 * 分组必须按账号时区，而不是设备本地日期：家人分散在两个时区时，
 * 同一条凌晨的记录会在首页算"今天"、在列表里算"昨天"。
 * 输入按后端给的时间倒序原样保留，只切相邻的同一天。
 */
export function groupByDay<T extends { occurredAt: string }>(events: T[], timezone: string, now: Date = new Date()): DayGroup<T>[] {
  const todayKey = dayKeyIn(timezone, now)
  const yesterdayKey = dayKeyIn(timezone, new Date(now.getTime() - 86_400_000))
  const out: DayGroup<T>[] = []
  for (const event of events) {
    const at = Date.parse(event.occurredAt)
    const key = Number.isNaN(at) ? 'unknown' : dayKeyIn(timezone, new Date(at))
    const last = out[out.length - 1]
    if (last && last.key === key) last.items.push(event)
    else out.push({ key, label: dayLabel(key, todayKey, yesterdayKey), items: [event] })
  }
  return out
}

function dayLabel(key: string, todayKey: string, yesterdayKey: string): string {
  if (key === 'unknown') return '未知时间'
  if (key === todayKey) return '今天'
  if (key === yesterdayKey) return '昨天'
  const [, month, day] = key.split('-').map(Number)
  return `${month}月${day}日`
}
