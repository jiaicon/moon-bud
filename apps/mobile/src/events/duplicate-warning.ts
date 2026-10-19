import type { EventDto, EventType } from '@moonbud/shared'
import { wallStamp } from '../utils/wall-time'
import { EVENT_TYPE_META } from './event-fields'

const INVALID = '时间未知'

/**
 * 相对时间是这个应用的主要时间语言："20 分钟前"直接回答了家长真正想问的
 * "上次喂是多久以前"，而 21:35 需要心算。跨天后才退回绝对时间，因为
 * "3 天前"在这种尺度上已经没有意义。
 *
 * 退回绝对时间的那几条念的是账号时区里的日期与钟点：列表按账号时区分组，
 * 这里按设备本地念，同一屏会出现两个"几号几点"。
 */
export function relativeTime(timezone: string, iso: string, now: Date = new Date()): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return INVALID

  const stamp = wallStamp(timezone, at)
  const today = wallStamp(timezone, now)
  const dateLabel =
    stamp.year === today.year
      ? `${stamp.month}月${stamp.day}日`
      : `${stamp.year}年${stamp.month}月${stamp.day}日`

  const diffMs = now.getTime() - at.getTime()
  // 预录/误填的未来时间：给绝对时刻，"时间未知"等于没告诉家长任何东西。
  if (diffMs < 0) return `${dateLabel} ${stamp.clock}`

  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`

  const days = Math.floor(hours / 24)
  if (days === 1) return `昨天 ${stamp.clock}`
  if (days < 7) return `${days} 天前`

  return dateLabel
}

export interface DuplicateWarningParams {
  latest: EventDto | null
  type: EventType
  timezone: string
  now?: Date
}

export function shouldWarnDuplicate({
  latest,
  type,
  timezone,
  now = new Date(),
}: DuplicateWarningParams): { warn: boolean; message: string } {
  if (!latest) return { warn: false, message: '' }

  const occurredAt = new Date(latest.occurredAt).getTime()
  if (Number.isNaN(occurredAt)) return { warn: false, message: '' }
  // 补录未来时间（极少见但会发生）与刚发生的事都不该被当成"重复"。
  if (occurredAt > now.getTime()) return { warn: false, message: '' }

  const minutes = (now.getTime() - occurredAt) / 60_000
  const meta = EVENT_TYPE_META[type]
  if (minutes >= meta.duplicateWindowMinutes) return { warn: false, message: '' }

  const who = latest.createdByNickname || '家人'
  return { warn: true, message: `${who} ${relativeTime(timezone, latest.occurredAt, now)}刚记过一次${meta.label}` }
}
