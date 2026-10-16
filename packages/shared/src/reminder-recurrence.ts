import * as rruleNs from 'rrule'
import type { RRule as RRuleClass } from 'rrule'
import type { ReminderType } from './api-types'

// rrule 的三种解析路径各有缺口：CommonJS 入口只有 default，bundler 走的 ESM 入口
// （package.json 的 module 字段）只有具名导出，而 Node 的 ESM 加载器面对这个 UMD 包
// 又不保证合成具名导出。因此取 RRule 必须同时兼容"具名"和"default 上取属性"两种形态——
// 只写其中一种，另一端就会在加载时报 "No matching export for import default"。
type RRuleCtor = typeof import('rrule').RRule
const RRule: RRuleCtor =
  (rruleNs as { RRule?: RRuleCtor }).RRule ??
  (rruleNs as { default?: { RRule: RRuleCtor } }).default!.RRule

/**
 * 时区处理的关键：RRULE 的 BYHOUR 指的是"墙上时间"（当地几点），
 * 不是 UTC 小时。所以整个计算必须在"目标时区的墙上时间坐标系"里做，
 * 算完再换算回真实 UTC。直接拿 UTC 去套 BYHOUR，会让"每天早上 8 点"
 * 在一个 UTC+8 的家庭里变成下午 4 点。
 */

const MS_PER_MINUTE = 60_000

type WallParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function safeFormat(tz: string): Intl.DateTimeFormat | null {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return null
  }
}

export function isSupportedTimezone(tz: unknown): boolean {
  if (typeof tz !== 'string' || tz.length === 0) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** 把一个真实时刻拆成它在目标时区的墙上时间。 */
function wallPartsOf(tz: string, fmt: Intl.DateTimeFormat, instant: Date): WallParts {
  const parts = fmt.formatToParts(instant)
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((p) => p.type === type)
    return found ? Number(found.value) : 0
  }
  // Intl 在 hour12:false 下可能把午夜表示为 24，归一化成 0
  const hour = get('hour')
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: hour === 24 ? 0 : hour,
    minute: get('minute'),
    second: get('second'),
  }
}

/** 把墙上时间（当作 UTC 字段）打包成一个便于 RRule 运算的 Date。 */
function packWall(p: WallParts): Date {
  return new Date(
    Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second),
  )
}

function unpackWall(wall: Date): WallParts {
  return {
    year: wall.getUTCFullYear(),
    month: wall.getUTCMonth() + 1,
    day: wall.getUTCDate(),
    hour: wall.getUTCHours(),
    minute: wall.getUTCMinutes(),
    second: wall.getUTCSeconds(),
  }
}

/**
 * 目标时区在某个真实时刻的 UTC 偏移（分钟）。
 * 用"该时区读出来的墙上时间"减去"真实时刻"得到。
 */
function offsetMinutesAt(tz: string, fmt: Intl.DateTimeFormat, instant: Date): number {
  const wall = packWall(wallPartsOf(tz, fmt, instant))
  return Math.round((wall.getTime() - instant.getTime()) / MS_PER_MINUTE)
}

/** 墙上时间 → 真实 UTC。夏令时切换日偏移会变，因此迭代校正。 */
function wallToInstant(
  tz: string,
  fmt: Intl.DateTimeFormat,
  wall: Date,
): Date {
  let candidate = new Date(wall.getTime())
  for (let i = 0; i < 2; i++) {
    const offset = offsetMinutesAt(tz, fmt, candidate)
    const next = new Date(wall.getTime() - offset * MS_PER_MINUTE)
    if (next.getTime() === candidate.getTime()) break
    candidate = next
  }
  return candidate
}

function parseRule(rrule: string, dtstartWall: Date): RRuleClass | null {
  try {
    return RRule.fromString(
      rrule.includes('DTSTART') ? rrule : `DTSTART:${toIcsUtc(dtstartWall)}\nRRULE:${rrule}`,
    )
  } catch {
    return null
  }
}

function toIcsUtc(d: Date): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, '0')
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  )
}

export interface ComputeDueAtParams {
  type: ReminderType
  dueAt?: Date | null
  rrule?: string | null
  timezone: string
  after: Date
}

/**
 * 返回严格晚于 `after` 的第一个触发时刻；没有则返回 null。
 * 任何无法解析的输入都返回 null——调度器依赖这一点做错误隔离，
 * 一条坏提醒不能让整个每分钟扫描崩掉。
 */
export function computeDueAt(params: ComputeDueAtParams): Date | null {
  const { type, dueAt, rrule, timezone, after } = params

  if (type === 'ONE_TIME') {
    if (!dueAt) return null
    return dueAt.getTime() > after.getTime() ? dueAt : null
  }

  if (!rrule || !isSupportedTimezone(timezone)) return null
  const fmt = safeFormat(timezone)
  if (!fmt) return null

  const afterWall = packWall(wallPartsOf(timezone, fmt, after))
  const rule = parseRule(rrule, afterWall)
  if (!rule) return null

  let nextWall: Date | null
  try {
    nextWall = rule.after(afterWall, false)
  } catch {
    return null
  }
  if (!nextWall) return null

  const instant = wallToInstant(timezone, fmt, nextWall)
  // 换算后必须仍严格晚于 after，否则调度器会陷入"每次都算出同一个时刻"
  return instant.getTime() > after.getTime() ? instant : null
}

export interface ExpandDueDatesParams {
  rrule: string
  timezone: string
  from: Date
  to: Date
  /** 上限，默认 500。防止一个长期未跑的提醒一次展开出上万条。 */
  limit?: number
}

/**
 * 展开 [from, to) 区间内所有触发时刻（真实 UTC），按时间升序。
 *
 * 区间是**左闭右开**：起点包含（否则上一轮的最后一个实例会被漏掉），
 * 终点不包含（调度器传 `to = now`，而恰好等于 now 的实例还没到期，
 * 此刻不该生成——下一分钟的扫描自然会带上它）。
 */
export function expandDueDates(params: ExpandDueDatesParams): Date[] {
  const { rrule, timezone, from, to, limit = 500 } = params
  if (to.getTime() < from.getTime()) return []
  if (!isSupportedTimezone(timezone)) return []
  const fmt = safeFormat(timezone)
  if (!fmt) return []

  const fromWall = packWall(wallPartsOf(timezone, fmt, from))
  const toWall = packWall(wallPartsOf(timezone, fmt, to))
  const rule = parseRule(rrule, fromWall)
  if (!rule) return []

  let walls: Date[]
  try {
    walls = rule
      .between(fromWall, toWall, true)
      .filter((w: Date) => w.getTime() < toWall.getTime())
  } catch {
    return []
  }

  return walls
    .slice(0, limit)
    .map((w: Date) => wallToInstant(timezone, fmt, w))
    .sort((a: Date, b: Date) => a.getTime() - b.getTime())
}
