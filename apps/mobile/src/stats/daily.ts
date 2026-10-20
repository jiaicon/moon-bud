import type { EventDto } from '@moonbud/shared'
import { dayKeyIn } from '../events/summary'
import { shiftDayKey } from '../events/list-filters'
import { wallStamp } from '../utils/wall-time'

/** 页面上可切换的照护指标。次数三项 + 奶量 + 睡眠时长。 */
export type CareMetric = 'feeding' | 'feedingMl' | 'sleep' | 'sleepMin' | 'diaper'

export interface CareBucket {
  /** 账号时区里的日历日 YYYY-MM-DD。 */
  dayKey: string
  /** 今天 / 昨天 / M月D日。 */
  label: string
  feeding: number
  sleep: number
  diaper: number
  feedingMl: number
  sleepMin: number
}

export interface CareMetricDef {
  key: CareMetric
  label: string
  unit: string
}

export const CARE_METRICS: CareMetricDef[] = [
  { key: 'feeding', label: '喂奶次数', unit: '次' },
  { key: 'feedingMl', label: '奶量', unit: 'ml' },
  { key: 'sleep', label: '睡眠次数', unit: '次' },
  { key: 'sleepMin', label: '睡眠时长', unit: '分钟' },
  { key: 'diaper', label: '尿布次数', unit: '次' },
]

function dayLabel(dayKey: string, todayKey: string): string {
  if (dayKey === todayKey) return '今天'
  if (dayKey === shiftDayKey(todayKey, -1)) return '昨天'
  const [, month, day] = dayKey.split('-').map(Number)
  return `${month}月${day}日`
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * 窗口内逐日照护聚合。恰好 `days` 个桶，从最旧到最新，**空白天也占位**（次数 0），
 * 这样柱状图的横轴是真实日期而不是"有记录的日子"——否则漏一天，柱子就挤到一起说谎。
 *
 * 切日按账号时区（`dayKeyIn`），不是设备本地；occurredAt 解析不了的记录直接丢弃。
 */
export function careSeries(
  events: EventDto[],
  timezone: string,
  days: number,
  now: Date = new Date(),
): CareBucket[] {
  const todayKey = dayKeyIn(timezone, now)
  const buckets: CareBucket[] = []
  const index = new Map<string, CareBucket>()
  // 睡眠分钟用原始毫秒累加（按 dayKey 存），收尾才取整，避免逐条四舍五入的误差。
  const sleepMs = new Map<string, number>()
  for (let offset = days - 1; offset >= 0; offset--) {
    const dayKey = shiftDayKey(todayKey, -offset)
    const bucket: CareBucket = {
      dayKey,
      label: dayLabel(dayKey, todayKey),
      feeding: 0,
      sleep: 0,
      diaper: 0,
      feedingMl: 0,
      sleepMin: 0,
    }
    buckets.push(bucket)
    index.set(dayKey, bucket)
  }

  for (const event of events) {
    const at = Date.parse(event.occurredAt)
    if (Number.isNaN(at)) continue
    const dayKey = dayKeyIn(timezone, new Date(at))
    const bucket = index.get(dayKey)
    if (!bucket) continue // 窗口外的记录不参与（近 N 天以外）

    if (event.type === 'feeding') {
      bucket.feeding += 1
      bucket.feedingMl += num((event.payload as { amountMl?: unknown }).amountMl)
    } else if (event.type === 'diaper') {
      bucket.diaper += 1
    } else if (event.type === 'sleep') {
      bucket.sleep += 1
      if (event.endedAt) {
        const end = Date.parse(event.endedAt)
        if (!Number.isNaN(end) && end > at) {
          sleepMs.set(dayKey, (sleepMs.get(dayKey) ?? 0) + (end - at))
        }
      }
    }
  }

  for (const bucket of buckets) {
    const ms = sleepMs.get(bucket.dayKey)
    if (ms) bucket.sleepMin = Math.round(ms / 60000)
  }
  return buckets
}

/** 某桶在选定指标下的值——用于算柱高与最大值。 */
export function careValue(bucket: CareBucket, metric: CareMetric): number {
  return bucket[metric]
}

/** 全窗最大值；空序列回 0（不是 -Infinity），页面据此判断"这段时间到底有没有数据"。 */
export function maxCareValue(buckets: CareBucket[], metric: CareMetric): number {
  if (!buckets.length) return 0
  return buckets.reduce((max, b) => Math.max(max, careValue(b, metric)), 0)
}

/**
 * 屏幕上这批数是几点读到的。刷新失败时页面留着上一次成功读到的数字，只写一行
 * "失败了"仍可能让人以为那是此刻的状态——把读到的时刻念出来，旧数字就不再冒充现在。
 * 同一天只给钟点（"今天 09:30"），跨天才带日期；日期与钟点都按账号时区算，
 * 和柱子切日用的是同一把尺。
 */
export function readAtLabel(
  timezone: string,
  loadedAtMs: number | null,
  now: Date = new Date(),
): string {
  if (loadedAtMs === null) return ''
  const at = new Date(loadedAtMs)
  if (Number.isNaN(at.getTime())) return ''
  const stamp = wallStamp(timezone, at)
  if (dayKeyIn(timezone, at) === dayKeyIn(timezone, now)) return `今天 ${stamp.clock}`
  return `${stamp.month}月${stamp.day}日 ${stamp.clock}`
}

/**
 * 按 id 去掉重复记录，保留第一次见到的那一份。
 *
 * 统计页要翻好几页才把一个孩子的记录取齐，而服务端分页是 skip/take + 固定倒序：
 * 就在这一趟里别的家长记了一条，行号整体位移，同一条会在两页各出现一次（或被顶掉）。
 * 不去重，"今天喂了几次 / 一共多少 ml"就可能当场翻倍。
 */
export function uniqueById(events: EventDto[]): EventDto[] {
  const seen = new Set<string>()
  const out: EventDto[] = []
  for (const event of events) {
    if (seen.has(event.id)) continue
    seen.add(event.id)
    out.push(event)
  }
  return out
}
