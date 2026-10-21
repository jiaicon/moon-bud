import { describe, expect, it } from 'vitest'
import type { EventDto } from '@moonbud/shared'
import { formatEventLine } from '../format-event'

const event = {
  id: 'e1',
  childId: 'c1',
  familyId: 'f1',
  type: 'feeding',
  occurredAt: '2026-10-19T01:30:00.000Z',
  endedAt: null,
  payload: { amountMl: 120, bottle: true },
  note: null,
  createdBy: 'u1',
  createdByNickname: '爸爸',
} as unknown as EventDto

/**
 * 列表按账号时区分组，行尾的"多久以前"也要按同一块表念：否则同一条记录
 * 在"10月19日"这一组里写着"10月18日 18:30"，家长会以为分组错了。
 */
describe('formatEventLine 的时间按账号时区念', () => {
  // 八天以后才会退成绝对日期，七天以内念"N 天前"，那样验不出时区。
  const now = new Date('2026-10-27T04:00:00.000Z')

  it('上海的记录念 10月19日', () => {
    expect(formatEventLine(event, 'Asia/Shanghai', now)).toContain('10月19日')
  })

  it('同一时刻在洛杉矶还是前一天', () => {
    expect(formatEventLine(event, 'America/Los_Angeles', now)).toContain('10月18日')
  })
})

/**
 * 尿布这一类，类型名本身就叫"大小便"。kind=mixed 再念成"大小便"，
 * 一行就成了"大小便 · 大小便"，家长看不出自己记的到底是哪一种。
 * 表单里那格写的是"混合"，列表和 CSV 就用同一个词。
 */
describe('尿布行不把自己的类型名念两遍', () => {
  const now = new Date('2026-10-27T04:00:00.000Z')
  const diaper = (kind: string) =>
    ({ ...event, type: 'diaper', payload: { kind } }) as unknown as EventDto

  it('混合念成"大小便 · 混合"', () => {
    expect(formatEventLine(diaper('mixed'), 'Asia/Shanghai', now)).toContain('大小便 · 混合')
    expect(formatEventLine(diaper('mixed'), 'Asia/Shanghai', now)).not.toContain('大小便 · 大小便')
  })

  it('小便和大便照旧', () => {
    expect(formatEventLine(diaper('pee'), 'Asia/Shanghai', now)).toContain('大小便 · 小便')
    expect(formatEventLine(diaper('poo'), 'Asia/Shanghai', now)).toContain('大小便 · 大便')
  })
})
