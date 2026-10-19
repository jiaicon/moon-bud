import { describe, expect, it } from 'vitest'
import { buildTodaySummary } from '../summary'
import type { EventDto, ReminderDto } from '@moonbud/shared'

const ev = (id: string, type: EventDto['type'], minutesAgo: number): EventDto => ({
  id, familyId: 'f1', childId: 'c1', type,
  occurredAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  endedAt: null, payload: {}, note: null,
  createdBy: 'u1', createdByNickname: '妈妈', updatedBy: null, createdAt: '', updatedAt: '',
})

const rm = (id: string, hoursFromNow: number): ReminderDto => ({
  id, familyId: 'f1', childId: 'c1', title: id, note: null, type: 'ONE_TIME',
  dueAt: new Date(Date.now() + hoursFromNow * 3600_000).toISOString(),
  rrule: null, timezone: 'Asia/Shanghai', assigneeId: null, status: 'ACTIVE',
  createdBy: 'u1', createdAt: '',
})

describe('buildTodaySummary', () => {
  it('取出最近一次喂奶与睡眠', () => {
    const s = buildTodaySummary({
      events: [ev('a', 'feeding', 120), ev('b', 'feeding', 20), ev('c', 'sleep', 300)],
      reminders: [], timezone: 'Asia/Shanghai',
    })
    expect(s.lastFeeding?.id).toBe('b')
    expect(s.lastSleep?.id).toBe('c')
  })

  it('只统计今天的换尿布次数', () => {
    const s = buildTodaySummary({
      events: [ev('a', 'diaper', 60), ev('b', 'diaper', 3 * 60), ev('c', 'diaper', 30 * 60)],
      reminders: [], timezone: 'Asia/Shanghai',
    })
    expect(s.diaperCount).toBeGreaterThanOrEqual(1)
    expect(s.diaperCount).toBeLessThanOrEqual(3)
  })

  it('挑出已过期的提醒', () => {
    const s = buildTodaySummary({
      events: [], reminders: [rm('过期', -3), rm('未到', 5)], timezone: 'Asia/Shanghai',
    })
    expect(s.overdueReminders.map((r) => r.id)).toEqual(['过期'])
  })

  it('空数据不抛错', () => {
    const s = buildTodaySummary({ events: [], reminders: [], timezone: 'Asia/Shanghai' })
    expect(s.lastFeeding).toBeNull()
    expect(s.lastSleep).toBeNull()
    expect(s.diaperCount).toBe(0)
    expect(s.overdueReminders).toEqual([])
  })

  it('忽略别的类型（睡眠不会出现在最近喂奶里）', () => {
    const s = buildTodaySummary({ events: [ev('a', 'sleep', 10)], reminders: [], timezone: 'Asia/Shanghai' })
    expect(s.lastFeeding).toBeNull()
  })

  it('「今天」按传入时区算，不按设备本地日期', () => {
    // 2026-10-15T23:30Z：上海已经是 10 月 16 日 07:30。
    const now = new Date('2026-10-16T00:30:00Z')
    const s = buildTodaySummary({
      events: [
        { ...ev('today', 'diaper', 0), occurredAt: '2026-10-15T23:30:00.000Z' },
        { ...ev('yesterday', 'diaper', 0), occurredAt: '2026-10-15T15:30:00.000Z' },
      ],
      reminders: [],
      now,
      timezone: 'Asia/Shanghai',
    })
    expect(s.diaperCount).toBe(1)
  })

  it('已完成或已取消的提醒不算过期', () => {
    const done: ReminderDto = { ...rm('已完成', -3), status: 'DONE' }
    const s = buildTodaySummary({ events: [], reminders: [done], timezone: 'Asia/Shanghai' })
    expect(s.overdueReminders).toEqual([])
  })
})
