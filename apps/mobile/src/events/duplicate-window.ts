import type { EventType } from '@moonbud/shared'
import { EVENT_TYPE_META } from './event-fields'

/** 用户在"设置"里按类型覆盖的窗口分钟数；缺省即沿用内置默认。 */
export type WindowOverrides = Partial<Record<EventType, number>>

/** 各类型的内置默认窗口，从类型元数据里取，避免两处各写一份数字。 */
export const DEFAULT_WINDOW_MINUTES = Object.fromEntries(
  Object.entries(EVENT_TYPE_META).map(([type, meta]) => [type, meta.duplicateWindowMinutes]),
) as Record<EventType, number>

/** 设置页里给的可选项。覆盖从"很勤"到"很松"的合理间隔；默认值走各类型自带的那档。 */
export const WINDOW_CHOICES = [30, 45, 60, 90, 120, 180, 240] as const

/** 解析某类型当前生效的窗口：非正数的脏覆盖按没设处理，回落默认。 */
export function resolveWindowMinutes(type: EventType, overrides: WindowOverrides): number {
  const override = overrides[type]
  if (typeof override === 'number' && Number.isFinite(override) && override > 0) return override
  return DEFAULT_WINDOW_MINUTES[type]
}
