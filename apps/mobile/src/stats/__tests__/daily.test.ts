import { describe, expect, it } from 'vitest'
import type { EventDto } from '@moonbud/shared'
import { CARE_METRICS, careSeries, careValue, maxCareValue, readAtLabel, uniqueById } from '../daily'

/**
 * 每日照护统计的纯聚合。三条不能骗人的红线：
 *
 * 1. 按**账号时区**切日，不是设备本地——家人两地时，凌晨那条会记错一天。
 * 2. 窗口里**没有记录的天也要占位**（次数 0），否则柱子会挤在一起、横轴说谎。
 * 3. 奶量只加有 `amountMl` 的（母乳亲喂没标毫升不该被当 0 拉低平均，也不该凭空造数）；
 *    睡眠时长只认 `endedAt>occurredAt`，缺结束时间的按 0 分钟，绝不编一个正数。
 */

function ev(over: Partial<EventDto>): EventDto {
  return {
    id: Math.random().toString(36).slice(2),
    childId: 'c1',
    familyId: 'f1',
    type: 'feeding',
    occurredAt: '2026-10-19T02:00:00.000Z',
    endedAt: null,
    payload: {},
    note: null,
    createdBy: 'u1',
    createdByNickname: '妈妈',
    updatedBy: null,
    createdAt: '2026-10-19T02:00:00.000Z',
    updatedAt: '2026-10-19T02:00:00.000Z',
    ...over,
  } as EventDto
}

// 固定"现在"：上海时间 2026-10-19 12:00 = UTC 04:00。
const NOW = new Date('2026-10-19T04:00:00.000Z')
const TZ = 'Asia/Shanghai'

describe('careSeries', () => {
  it('恰好产出 days 个桶，从最旧到最新，含今天', () => {
    const buckets = careSeries([], TZ, 7, NOW)
    expect(buckets).toHaveLength(7)
    expect(buckets[6].label).toBe('今天')
    expect(buckets[5].label).toBe('昨天')
    // 最旧桶 = 今天往前 6 天 = 10-13
    expect(buckets[0].dayKey).toBe('2026-10-13')
    expect(buckets[6].dayKey).toBe('2026-10-19')
  })

  it('空白天次数为 0 但仍占位', () => {
    const buckets = careSeries([], TZ, 3, NOW)
    expect(buckets.every((b) => b.feeding === 0 && b.sleep === 0 && b.diaper === 0)).toBe(true)
  })

  it('按类型计数', () => {
    const events = [
      ev({ type: 'feeding', occurredAt: '2026-10-19T01:00:00.000Z' }),
      ev({ type: 'feeding', occurredAt: '2026-10-19T03:00:00.000Z' }),
      ev({ type: 'diaper', occurredAt: '2026-10-19T02:00:00.000Z' }),
      ev({ type: 'sleep', occurredAt: '2026-10-18T10:00:00.000Z' }), // 上海 10-18 18:00 = 昨天
    ]
    const today = careSeries(events, TZ, 7, NOW)[6]
    expect(today.feeding).toBe(2)
    expect(today.diaper).toBe(1)
    expect(today.sleep).toBe(0)
    const yesterday = careSeries(events, TZ, 7, NOW)[5]
    expect(yesterday.dayKey).toBe('2026-10-18')
    expect(yesterday.sleep).toBe(1)
  })

  it('凌晨那条按账号时区归到正确的一天（上海 vs UTC 差一天）', () => {
    // UTC 2026-10-18T20:00 = 上海 2026-10-19 04:00 → 上海口径应算"今天"
    const e = ev({ type: 'feeding', occurredAt: '2026-10-18T20:00:00.000Z' })
    const buckets = careSeries([e], TZ, 7, NOW)
    expect(buckets[6].dayKey).toBe('2026-10-19')
    expect(buckets[6].feeding).toBe(1)
    expect(buckets[5].feeding).toBe(0)
  })

  it('奶量只累加带 amountMl 的记录', () => {
    const events = [
      ev({ type: 'feeding', payload: { method: 'bottle', amountMl: 120 } }),
      ev({ type: 'feeding', payload: { method: 'breast', durationMin: 15 } }), // 亲喂无毫升
      ev({ type: 'feeding', payload: { method: 'bottle', amountMl: 80 } }),
    ]
    const today = careSeries(events, TZ, 7, NOW)[6]
    expect(today.feedingMl).toBe(200)
    expect(today.feeding).toBe(3)
  })

  it('睡眠时长按 endedAt-occurredAt 累加，缺结束时间记 0', () => {
    const events = [
      ev({ type: 'sleep', occurredAt: '2026-10-19T01:00:00.000Z', endedAt: '2026-10-19T01:30:00.000Z' }), // 30 分
      ev({ type: 'sleep', occurredAt: '2026-10-19T02:00:00.000Z', endedAt: null }), // 没结束
      // endedAt 早于 occurredAt（脏数据）→ 不产生负数
      ev({ type: 'sleep', occurredAt: '2026-10-19T03:00:00.000Z', endedAt: '2026-10-19T02:00:00.000Z' }),
    ]
    const today = careSeries(events, TZ, 7, NOW)[6]
    expect(today.sleep).toBe(3)
    expect(today.sleepMin).toBe(30)
  })

  it('occurredAt 非法的记录被忽略，不进任何桶', () => {
    const events = [ev({ type: 'feeding', occurredAt: 'not-a-date' })]
    const buckets = careSeries(events, TZ, 7, NOW)
    expect(buckets.reduce((s, b) => s + b.feeding, 0)).toBe(0)
  })
})

describe('careValue / maxCareValue', () => {
  it('每个指标都映射到桶上的数值字段', () => {
    const b = careSeries([ev({ type: 'feeding', payload: { method: 'bottle', amountMl: 50 } })], TZ, 1, NOW)[0]
    expect(careValue(b, 'feeding')).toBe(1)
    expect(careValue(b, 'feedingMl')).toBe(50)
  })

  it('最大值取全场，空序列回 0（不是 -Infinity）', () => {
    const buckets = careSeries([], TZ, 7, NOW)
    expect(maxCareValue(buckets, 'feeding')).toBe(0)
    expect(maxCareValue([], 'feeding')).toBe(0)
  })

  it('指标清单齐全，供页面渲染选择器', () => {
    expect(CARE_METRICS.map((m) => m.key)).toEqual(['feeding', 'feedingMl', 'sleep', 'sleepMin', 'diaper'])
  })
})

describe('uniqueById', () => {
  it('翻页取数叠出的同一条只留一份：留第一次见到的那条（后一页是它的旧副本）', () => {
    const a = ev({ id: 'x', payload: { method: 'bottle', amountMl: 100 } })
    const aCopy = ev({ id: 'x', payload: { method: 'bottle', amountMl: 30 } })
    const b = ev({ id: 'y', payload: { method: 'bottle', amountMl: 50 } })
    expect(uniqueById([a, b, aCopy])).toEqual([a, b])
  })

  it('空数组原样回空，不造出一条', () => {
    expect(uniqueById([])).toEqual([])
  })

  it('去重后计数不再翻倍：分页期间别人记了一条就会行号位移', () => {
    const one = ev({ id: 'x' })
    expect(careSeries(uniqueById([one, one, one]), TZ, 1, NOW)[0].feeding).toBe(1)
  })
})

describe('readAtLabel：刷新失败时要说清旧数字是几点读到的', () => {
  it('没读到过就说不出时刻（空串），页面据此不出这一行', () => {
    expect(readAtLabel(TZ, null, NOW)).toBe('')
    expect(readAtLabel(TZ, Number.NaN, NOW)).toBe('')
  })

  it('同一天只报钟点，且按账号时区念', () => {
    // NOW 是上海 10-19 12:00；这一趟是上海 09:30（UTC 01:30）读到的。
    expect(readAtLabel(TZ, Date.parse('2026-10-19T01:30:00.000Z'), NOW)).toBe('今天 09:30')
  })

  it('跨到另一天才带日期：同一个时刻在两个时区里各算各的天', () => {
    const at = Date.parse('2026-10-18T23:30:00.000Z')
    expect(readAtLabel('UTC', at, new Date('2026-10-19T00:30:00.000Z'))).toBe('10月18日 23:30')
    // 上海此刻已是 10-19 08:30，同一趟读数是"今天 07:30"，不能念成昨天。
    expect(readAtLabel(TZ, at, new Date('2026-10-19T00:30:00.000Z'))).toBe('今天 07:30')
  })
})
