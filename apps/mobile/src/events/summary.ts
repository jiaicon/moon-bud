import type { EventDto } from '@moonbud/shared'

export interface TodaySummary {
  lastFeeding: EventDto | null
  lastSleep: EventDto | null
  diaperCount: number
  overdueCount: number
}

export interface BuildTodaySummaryParams {
  events: EventDto[]
  /**
   * 过期几条由服务端算，客户端不自己筛：重复提醒在列表里 `dueAt` 是 null
   * （下一次靠实例展开），自己按 dueAt 挑就等于"每天 20:00 喂药"过期三小时、
   * 首页还是一个字都不提。服务端的 OVERDUE 是"活跃 + 有到期未完成的实例"。
   */
  overdueCount: number
  now?: Date
  /** 家庭所在时区：「今天」必须按它算，而不是按设备本地日期。 */
  timezone: string
}

/**
 * 把某个瞬间转成指定时区的 YYYY-MM-DD。
 * 家人可能分散在不同时区，用设备本地日期会把凌晨的记录算到昨天头上。
 * 时区名非法或运行环境没有 Intl 时退回本地日期——概览少算一天，
 * 也比整张卡片空白要好。
 */
export function dayKeyIn(timezone: string, instant: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(instant)
    const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value
    const year = read('year')
    const month = read('month')
    const day = read('day')
    if (year && month && day) return `${year}-${month}-${day}`
  } catch {
    // 落到下面的本地兜底
  }
  return `${instant.getFullYear()}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}`
}

function latestOf(events: EventDto[], type: EventDto['type']): EventDto | null {
  let best: EventDto | null = null
  for (const event of events) {
    if (event.type !== type) continue
    const at = Date.parse(event.occurredAt)
    if (Number.isNaN(at)) continue
    if (!best || at > Date.parse(best.occurredAt)) best = event
  }
  return best
}

export function buildTodaySummary(params: BuildTodaySummaryParams): TodaySummary {
  const now = params.now ?? new Date()
  const todayKey = dayKeyIn(params.timezone, now)

  const diaperToday = params.events.filter((event) => {
    if (event.type !== 'diaper') return false
    const at = Date.parse(event.occurredAt)
    return !Number.isNaN(at) && dayKeyIn(params.timezone, new Date(at)) === todayKey
  })

  return {
    lastFeeding: latestOf(params.events, 'feeding'),
    lastSleep: latestOf(params.events, 'sleep'),
    diaperCount: diaperToday.length,
    overdueCount: params.overdueCount,
  }
}
