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
