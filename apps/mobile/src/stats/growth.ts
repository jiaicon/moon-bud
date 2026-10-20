import type { EventDto } from '@moonbud/shared'
import { dayKeyIn } from '../events/summary'

export type GrowthField = 'weightKg' | 'heightCm' | 'headCm'

export interface GrowthPoint {
  /** occurredAt 的 epoch 毫秒，用于按时间排布横轴。 */
  t: number
  /** 账号时区的 M月D日。 */
  label: string
  v: number
}

export interface GrowthFieldDef {
  key: GrowthField
  label: string
  unit: string
}

export const GROWTH_FIELDS: GrowthFieldDef[] = [
  { key: 'weightKg', label: '体重', unit: 'kg' },
  { key: 'heightCm', label: '身高', unit: 'cm' },
  { key: 'headCm', label: '头围', unit: 'cm' },
]

function positiveNum(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/**
 * 抽出某生长字段的全部测量点，按时间升序。只认 `type==='growth'`、该字段为正数、
 * 且 occurredAt 可解析的记录——缺测/脏值宁可少画一个点，也不在曲线上凭空造。
 */
export function growthSeries(events: EventDto[], timezone: string, field: GrowthField): GrowthPoint[] {
  const points: GrowthPoint[] = []
  for (const event of events) {
    if (event.type !== 'growth') continue
    const v = positiveNum((event.payload as Record<string, unknown>)[field])
    if (v === null) continue
    const t = Date.parse(event.occurredAt)
    if (Number.isNaN(t)) continue
    points.push({ t, label: monthDayLabel(timezone, new Date(t)), v })
  }
  points.sort((a, b) => a.t - b.t)
  return points
}

function monthDayLabel(timezone: string, instant: Date): string {
  const [, month, day] = dayKeyIn(timezone, instant).split('-').map(Number)
  return `${month}月${day}日`
}

/**
 * 画折线用的数值上下界（含留白）。生长指标都是正量，下界钳到 0，
 * 免得留白把轴拉到负数、看着像体重能为负。单点/全同值也撑开成可画的小量程。
 */
export function valueExtent(points: GrowthPoint[]): { min: number; max: number } {
  if (!points.length) return { min: 0, max: 0 }
  let lo = Infinity
  let hi = -Infinity
  for (const p of points) {
    if (p.v < lo) lo = p.v
    if (p.v > hi) hi = p.v
  }
  if (lo === hi) {
    const margin = Math.abs(lo) * 0.1 || 1
    return { min: Math.max(0, lo - margin), max: hi + margin }
  }
  const pad = (hi - lo) * 0.1
  return { min: Math.max(0, lo - pad), max: hi + pad }
}
