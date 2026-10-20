import type { EventDto } from '@moonbud/shared'
import { EVENT_TYPE_META } from './event-fields'
import { relativeTime } from './duplicate-warning'

type Payload = Record<string, unknown>

const LABELS: Record<string, string> = {
  breast: '母乳',
  bottle: '奶瓶',
  formula: '配方奶',
  left: '左侧',
  right: '右侧',
  both: '双侧',
  good: '睡得好',
  fair: '一般',
  poor: '睡得差',
  pee: '小便',
  poo: '大便',
  mixed: '大小便',
  axillary: '腋下',
  ear: '耳温',
  forehead: '额温',
  rectal: '肛温',
  oral: '口服',
  topical: '外用',
  other: '其他',
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const word = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null)
const named = (v: unknown) => {
  const key = word(v)
  return key ? LABELS[key] ?? key : null
}

/**
 * 一条记录的"内容"摘要（不含类型名、不含时间）。列表用它拼一行，
 * CSV 导出用同一份，两边念出来的才逐字一致。
 */
export function eventDetail(event: EventDto): string {
  const p = (event.payload ?? {}) as Payload
  const parts: string[] = []

  switch (event.type) {
    case 'feeding': {
      const method = named(p.method)
      if (method) parts.push(method)
      const side = named(p.side)
      if (side) parts.push(side)
      const ml = num(p.amountMl)
      if (ml !== null) parts.push(`${ml}ml`)
      const min = num(p.durationMin)
      if (min !== null) parts.push(`${min} 分钟`)
      break
    }
    case 'sleep': {
      const quality = named(p.quality)
      if (quality) parts.push(quality)
      const mins = sleepMinutes(event)
      if (mins !== null) parts.push(`共 ${mins} 分钟`)
      break
    }
    case 'diaper': {
      const kind = named(p.kind)
      if (kind) parts.push(kind)
      const color = word(p.color)
      if (color) parts.push(color)
      const texture = word(p.texture)
      if (texture) parts.push(texture)
      break
    }
    case 'solid': {
      const food = word(p.food)
      if (food) parts.push(food)
      const amount = word(p.amountDesc)
      if (amount) parts.push(amount)
      break
    }
    case 'medicine': {
      const name = word(p.name)
      if (name) parts.push(name)
      const dose = word(p.dose)
      if (dose) parts.push(dose)
      const route = named(p.route)
      if (route) parts.push(route)
      break
    }
    case 'temperature': {
      const c = num(p.celsius)
      if (c !== null) parts.push(`${c}℃`)
      const site = named(p.site)
      if (site) parts.push(site)
      break
    }
    case 'growth': {
      const kg = num(p.weightKg)
      if (kg !== null) parts.push(`${kg}kg`)
      const cm = num(p.heightCm)
      if (cm !== null) parts.push(`${cm}cm`)
      const head = num(p.headCm)
      if (head !== null) parts.push(`头围 ${head}cm`)
      break
    }
    case 'milestone': {
      const title = word(p.title)
      if (title) parts.push(title)
      break
    }
  }

  const note = word(event.note)
  if (note) parts.push(note)
  return parts.join(' ')
}

function sleepMinutes(event: EventDto): number | null {
  if (!event.endedAt) return null
  const start = new Date(event.occurredAt).getTime()
  const end = new Date(event.endedAt).getTime()
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null
  return Math.round((end - start) / 60_000)
}

/** 列表里一行的全部信息：类型 · 内容 · 多久以前。 */
export function formatEventLine(event: EventDto, timezone: string, now?: Date): string {
  const detail = eventDetail(event)
  const when = relativeTime(timezone, event.occurredAt, now)
  return [EVENT_TYPE_META[event.type].label, detail, when].filter(Boolean).join(' · ')
}
