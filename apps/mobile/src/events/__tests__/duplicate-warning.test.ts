import { describe, expect, it } from 'vitest'
import { relativeTime, shouldWarnDuplicate } from '../duplicate-warning'

const feeding = (minutesAgo: number) => ({
  id: 'e1', familyId: 'f1', childId: 'c1', type: 'feeding' as const,
  occurredAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  endedAt: null, payload: { method: 'bottle' as const, amountMl: 120 },
  note: null, createdBy: 'u1', createdByNickname: '爸爸',
  updatedBy: null, createdAt: '', updatedAt: '',
})

describe('relativeTime', () => {
  it('一分钟内显示刚刚', () => {
    expect(relativeTime(new Date(Date.now() - 20_000).toISOString())).toBe('刚刚')
  })
  it('同一天内显示分钟与小时', () => {
    expect(relativeTime(new Date(Date.now() - 20 * 60_000).toISOString())).toBe('20 分钟前')
    expect(relativeTime(new Date(Date.now() - 3 * 3600_000).toISOString())).toBe('3 小时前')
  })
  it('跨天显示日期', () => {
    expect(relativeTime(new Date(Date.now() - 48 * 3600_000).toISOString())).toMatch(/天前|月|日/)
  })
  it('非法时间串不抛错', () => {
    expect(relativeTime('not-a-date')).toBeTruthy()
  })
  it('未来的时间显示绝对时刻，而不是"时间未知"', () => {
    // 预录/误填明天的时间会真实出现在列表里，"时间未知"等于没告诉家长任何东西。
    expect(relativeTime(new Date(Date.now() + 30 * 60_000).toISOString())).toMatch(/\d{1,2}:\d{2}/)
  })
})

describe('shouldWarnDuplicate', () => {
  it('90 分钟内已有喂奶记录时给出带记录人的提示', () => {
    const r = shouldWarnDuplicate({ latest: feeding(20), type: 'feeding' })
    expect(r.warn).toBe(true)
    expect(r.message).toContain('爸爸')
    expect(r.message).toContain('20 分钟前')
  })

  it('超过窗口不提示', () => {
    expect(shouldWarnDuplicate({ latest: feeding(200), type: 'feeding' }).warn).toBe(false)
  })

  it('没有历史记录时不提示', () => {
    expect(shouldWarnDuplicate({ latest: null, type: 'feeding' }).warn).toBe(false)
  })

  it('未来时间的记录不触发提示（用户补录过去时间时不能被误报）', () => {
    const future = { ...feeding(-30) }
    expect(shouldWarnDuplicate({ latest: future, type: 'feeding' }).warn).toBe(false)
  })

  it('用药窗口更长，30 分钟前记过药会提示', () => {
    expect(
      shouldWarnDuplicate({ latest: { ...feeding(30), type: 'medicine' as const }, type: 'medicine' })
        .warn,
    ).toBe(true)
  })
})
