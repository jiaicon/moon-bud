import type { EventDto, FamilyRole } from '@moonbud/shared'
import { fieldsFor } from './event-fields'

export interface EventFormState {
  values: Record<string, string>
  note: string
  date: string
  time: string
  endDate: string
  endTime: string
}

const pad = (n: number) => String(n).padStart(2, '0')

function parts(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { date: '', time: '' }
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  }
}

/**
 * 编辑一条记录时，界面必须显出它本来的内容 —— 用今天的当前时刻打开表单，
 * 家长看不到自己要点什么，改一个字段就会把时间悄悄改掉。
 */
export function eventToFormState(event: EventDto): EventFormState {
  const values: Record<string, string> = {}
  const payload = event.payload as Record<string, unknown>
  for (const field of fieldsFor(event.type)) {
    const raw = payload[field.name]
    if (raw === undefined || raw === null) continue
    values[field.name] = typeof raw === 'string' ? raw : String(raw)
  }
  const start = parts(event.occurredAt)
  const end = event.endedAt ? parts(event.endedAt) : { date: '', time: '' }
  return {
    values,
    note: event.note ?? '',
    date: start.date,
    time: start.time,
    endDate: end.date,
    endTime: end.time,
  }
}

/** 与后端 events.service.ts 的 assertCanModify 同一条规则（spec 第 4 节）。 */
export function canModifyEvent(
  event: EventDto,
  userId: string | null,
  role: FamilyRole | null,
): boolean {
  if (role === 'OWNER' || role === 'ADMIN') return true
  return userId !== null && event.createdBy === userId
}

const HANDOFF_KEY = 'editingEvent'

/**
 * 后端没有 GET /events/:id，而列表页手里已经有完整的 EventDto ——
 * 用一次性 storage 交接，比让表单再拉一页列表去凑出那条记录诚实。
 */
export function stageForEdit(event: EventDto): void {
  uni.setStorageSync(HANDOFF_KEY, event)
}

export function takeForEdit(eventId: string): EventDto | null {
  const stored = uni.getStorageSync(HANDOFF_KEY) as EventDto | ''
  if (!stored || typeof stored !== 'object' || stored.id !== eventId) return null
  uni.removeStorageSync(HANDOFF_KEY)
  return stored
}
