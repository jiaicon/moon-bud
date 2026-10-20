import type { EventType, MemberDto } from '@moonbud/shared'
import type { Query } from '../api/http'
import { dayKeyIn } from './summary'
import { isoFromWallTime } from '../utils/wall-time'

export interface EventListFilters {
  type?: EventType | ''
  childId?: string
  createdBy?: string
  /** 时间界的 ISO 串，由 rangeBounds 算好后由页面带进来。 */
  from?: string
  to?: string
}

/** 记录页"按时间筛"的预设；'' 是"全部"，不带任何时间界。 */
export type EventRange = '' | 'today' | '7d' | '30d'

export const RANGE_OPTIONS: { value: EventRange; label: string }[] = [
  { value: '', label: '全部' },
  { value: 'today', label: '今天' },
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
]

const RANGE_DAYS: Record<Exclude<EventRange, ''>, number> = { today: 1, '7d': 7, '30d': 30 }

/**
 * 把日历日（YYYY-MM-DD）按天数偏移，纯字符串→UTC 日界→字符串，不碰瞬时。
 * 用 UTC 中午之外任何时刻都可能被夏令时拽到相邻一天；这里只操作"日"这个概念，
 * 落回时区由 isoFromWallTime 负责，两步合起来才对齐"上海墙上 00:00"。
 *
 * 统计页的柱状横轴也要按同样的规矩挪天，所以这里是唯一的正本：
 * 两处各写一份的话，"近 7 天"在列表和图上可能不是同一段日子。
 */
export function shiftDayKey(dayKey: string, deltaDays: number): string {
  const [year, month, day] = dayKey.split('-').map(Number)
  const dt = new Date(Date.UTC(year || 1970, (month || 1) - 1, day || 1))
  dt.setUTCDate(dt.getUTCDate() + deltaDays)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

/**
 * 预设区间 → { from, to }（ISO，闭区间两端都算进后端 lte）。
 *
 * 必须按账号时区算午夜：家人分散两地时，按设备本地会把"今天"的左界差好几个小时，
 * 于是列表少掉凌晨那条（spec 反目标：别把记录藏起来）。含今天：往前 N-1 天的本地
 * 00:00 起，到今天本地 23:59:59.999 止。"近 30 天"按日历日往前减 29 天，而不是
 * 30×24 小时——夏令时切换那天有 25 小时，硬减会把起点推到前一天。
 */
export function rangeBounds(
  range: EventRange,
  timezone: string,
  now: Date = new Date(),
): { from?: string; to?: string } {
  if (!range) return {}
  const days = RANGE_DAYS[range]
  const todayKey = dayKeyIn(timezone, now)
  const fromKey = shiftDayKey(todayKey, -(days - 1))
  const from = isoFromWallTime(timezone, fromKey, '00:00')
  // 明天本地 00:00 减 1 毫秒 = 今天本地最后一毫秒；lte 是闭区间，取不到就少一整秒。
  const tomorrowStart = Date.parse(isoFromWallTime(timezone, shiftDayKey(todayKey, 1), '00:00'))
  const to = new Date(tomorrowStart - 1).toISOString()
  return { from, to }
}

/**
 * 把界面上的筛选项拼成查询串。
 *
 * 空字符串一律丢掉：`createdBy=` 到了后端是非法 UUID，直接 400；而"没选"和
 * "选了空"在界面上是同一件事。`from/to` 同理——空的 ISO 串后端 `@IsISO8601` 会打回。
 */
export function buildEventQuery(filters: EventListFilters, page: number, pageSize: number): Query {
  const query: Query = { page, pageSize }
  if (filters.type) query.type = filters.type
  if (filters.childId) query.childId = filters.childId
  if (filters.createdBy) query.createdBy = filters.createdBy
  if (filters.from) query.from = filters.from
  if (filters.to) query.to = filters.to
  return query
}

export interface RecorderOption {
  value: string
  label: string
}

/**
 * "按记录人筛"那一行的芯片：`''` 是"全部"。
 *
 * 少于两个人返回空数组——一个人的家庭问"谁记的"没有意义，画一行只有"全部"
 * 的芯片是把界面写成假功能。名单还没读到时同样返回空：那一行不该出现，
 * 页面自己说"名单正在读取"。
 */
export function recorderOptions(members: MemberDto[], selfUserId: string): RecorderOption[] {
  if (members.length < 2) return []
  return [
    { value: '', label: '全部' },
    ...members.map((m) => ({
      value: m.userId,
      label: (m.userId === selfUserId && selfUserId ? '我' : m.displayName || m.nickname),
    })),
  ]
}

/**
 * 列表空下来时屏幕该说什么。
 *
 * 带着筛项空着 ≠ 家里没有记录：把"还没有记录"印在"爷爷 + 喂奶"的筛选下面，
 * 是在告诉用户一件他没问过的事，也让人以为记录丢了（spec 第 2 节的反目标）。
 */
export function emptyListCopy(activeFilters: string[]): { title: string; hint: string } {
  if (activeFilters.length === 0) {
    return { title: '还没有记录', hint: '点右下角 ＋，喂奶、换尿布、睡觉都能记一条。' }
  }
  return {
    title: '这个筛选下还没有记录',
    hint: `当前筛的是：${activeFilters.join('、')}。换个筛项，或点右下角 ＋ 记一条。`,
  }
}
