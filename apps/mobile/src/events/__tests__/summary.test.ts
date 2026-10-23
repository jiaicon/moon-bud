import { describe, expect, it } from 'vitest'
import { buildTodaySummary } from '../summary'
import type { EventDto } from '@moonbud/shared'

const ev = (id: string, type: EventDto['type'], minutesAgo: number): EventDto => ({
  id, familyId: 'f1', childId: 'c1', type,
  occurredAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  endedAt: null, payload: {}, note: null,
  createdBy: 'u1', createdByNickname: '妈妈', updatedBy: null, fromReminderId: null, createdAt: '', updatedAt: '',
})

describe('buildTodaySummary', () => {
  it('取出最近一次喂奶与睡眠', () => {
    const s = buildTodaySummary({
      events: [ev('a', 'feeding', 120), ev('b', 'feeding', 20), ev('c', 'sleep', 300)],
      overdueCount: 0, timezone: 'Asia/Shanghai',
    })
    expect(s.lastFeeding?.id).toBe('b')
    expect(s.lastSleep?.id).toBe('c')
  })

  it('只统计今天的换尿布次数', () => {
    const s = buildTodaySummary({
      events: [ev('a', 'diaper', 60), ev('b', 'diaper', 3 * 60), ev('c', 'diaper', 30 * 60)],
      overdueCount: 0, timezone: 'Asia/Shanghai',
    })
    expect(s.diaperCount).toBeGreaterThanOrEqual(1)
    expect(s.diaperCount).toBeLessThanOrEqual(3)
  })

  it('过期数照服务端给的写，不再自己按 dueAt 筛', () => {
    // 重复提醒在列表里 dueAt 是 null（下一次靠实例展开），客户端自己筛永远漏掉它们：
    // 一条"每天 20:00 喂药"过期三小时，首页却一个字都不提。
    const s = buildTodaySummary({ events: [], overdueCount: 3, timezone: 'Asia/Shanghai' })
    expect(s.overdueCount).toBe(3)
  })

  it('空数据不抛错', () => {
    const s = buildTodaySummary({ events: [], overdueCount: 0, timezone: 'Asia/Shanghai' })
    expect(s.lastFeeding).toBeNull()
    expect(s.lastSleep).toBeNull()
    expect(s.diaperCount).toBe(0)
    expect(s.overdueCount).toBe(0)
  })

  it('忽略别的类型（睡眠不会出现在最近喂奶里）', () => {
    const s = buildTodaySummary({ events: [ev('a', 'sleep', 10)], overdueCount: 0, timezone: 'Asia/Shanghai' })
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
      overdueCount: 0,
      now,
      timezone: 'Asia/Shanghai',
    })
    expect(s.diaperCount).toBe(1)
  })
})
