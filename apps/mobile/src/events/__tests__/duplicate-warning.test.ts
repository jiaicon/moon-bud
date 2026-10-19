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
  const now = new Date('2026-10-20T04:00:00.000Z')

  it('一分钟内显示刚刚', () => {
    expect(relativeTime('Asia/Shanghai', new Date(Date.now() - 20_000).toISOString())).toBe('刚刚')
  })
  it('同一天内显示分钟与小时', () => {
    expect(relativeTime('Asia/Shanghai', new Date(Date.now() - 20 * 60_000).toISOString())).toBe('20 分钟前')
    expect(relativeTime('Asia/Shanghai', new Date(Date.now() - 3 * 3600_000).toISOString())).toBe('3 小时前')
  })
  it('跨天显示日期', () => {
    expect(relativeTime('Asia/Shanghai', new Date(Date.now() - 48 * 3600_000).toISOString())).toMatch(/天前|月|日/)
  })
  it('非法时间串不抛错', () => {
    expect(relativeTime('Asia/Shanghai', 'not-a-date')).toBeTruthy()
  })
  it('未来的时间显示绝对时刻，而不是"时间未知"', () => {
    // 预录/误填明天的时间会真实出现在列表里，"时间未知"等于没告诉家长任何东西。
    expect(relativeTime('Asia/Shanghai', new Date(Date.now() + 30 * 60_000).toISOString())).toMatch(/\d{1,2}:\d{2}/)
  })

  /**
   * 退回绝对时间的那几条文案念的是"哪天几点"，就必须念家人那块表上的哪天几点：
   * 同一个时刻在上海是 10月19日 09:30，在洛杉矶还是 10月18日 18:30。
   */
  it('绝对日期按账号时区念，不是设备本地', () => {
    // 八天前才会退成绝对日期（七天以内念"N 天前"）。
    const at = '2026-10-19T01:30:00.000Z'
    const now = new Date('2026-10-27T04:00:00.000Z')
    expect(relativeTime('Asia/Shanghai', at, now)).toBe('10月19日')
    expect(relativeTime('America/Los_Angeles', at, now)).toBe('10月18日')
  })

  it('"昨天"后面的钟点按账号时区念', () => {
    const at = '2026-10-19T01:30:00.000Z'
    expect(relativeTime('Asia/Shanghai', at, now)).toBe('昨天 09:30')
    expect(relativeTime('America/Los_Angeles', at, now)).toBe('昨天 18:30')
  })

  it('未来时间的日期也按账号时区念', () => {
    // 上海的 2027-01-01 00:30 在洛杉矶还是 2026-12-31 08:30：两块表念出两个日期才对。
    const at = '2026-12-31T16:30:00.000Z'
    expect(relativeTime('Asia/Shanghai', at, new Date('2026-12-31T16:00:00.000Z'))).toBe('1月1日 00:30')
    expect(relativeTime('America/Los_Angeles', at, new Date('2026-12-31T16:00:00.000Z'))).toBe('12月31日 08:30')
  })

  it('只有账号时区里跨年时才把年份写出来', () => {
    // 七步之外才带钟点，这里是"N 天前"退成的绝对日期。
    expect(relativeTime('Asia/Shanghai', '2025-12-31T16:30:00.000Z', new Date('2027-01-01T01:00:00.000Z'))).toBe(
      '2026年1月1日',
    )
    expect(relativeTime('America/Los_Angeles', '2025-12-31T16:30:00.000Z', new Date('2027-01-01T01:00:00.000Z'))).toBe(
      '2025年12月31日',
    )
  })
})

describe('shouldWarnDuplicate', () => {
  it('90 分钟内已有喂奶记录时给出带记录人的提示', () => {
    const r = shouldWarnDuplicate({ latest: feeding(20), type: 'feeding', timezone: 'Asia/Shanghai' })
    expect(r.warn).toBe(true)
    expect(r.message).toContain('爸爸')
    expect(r.message).toContain('20 分钟前')
  })

  it('超过窗口不提示', () => {
    expect(shouldWarnDuplicate({ latest: feeding(200), type: 'feeding', timezone: 'Asia/Shanghai' }).warn).toBe(false)
  })

  it('没有历史记录时不提示', () => {
    expect(shouldWarnDuplicate({ latest: null, type: 'feeding', timezone: 'Asia/Shanghai' }).warn).toBe(false)
  })

  it('未来时间的记录不触发提示（用户补录过去时间时不能被误报）', () => {
    const future = { ...feeding(-30) }
    expect(shouldWarnDuplicate({ latest: future, type: 'feeding', timezone: 'Asia/Shanghai' }).warn).toBe(false)
  })

  it('用药窗口更长，30 分钟前记过药会提示', () => {
    expect(
      shouldWarnDuplicate({
        latest: { ...feeding(30), type: 'medicine' as const },
        type: 'medicine',
        timezone: 'Asia/Shanghai',
      }).warn,
    ).toBe(true)
  })
})
