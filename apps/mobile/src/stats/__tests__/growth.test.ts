import { describe, expect, it } from 'vitest'
import type { EventDto } from '@moonbud/shared'
import { GROWTH_FIELDS, growthSeries, valueExtent } from '../growth'

/**
 * 生长曲线：把某个字段的历次测量抽成按时间升序的点，并给出画图用的数值上下界。
 *
 * 诚实红线：只收 `type==='growth'` 且该字段确为正数的记录；缺字段/脏值不进序列，
 * 也不在图上凭空补一个点。上下界要留白——只量过一次（min==max）时若不撑开，
 * 折线会贴死画布顶或根本画不出斜率，看着像坏了。
 */

function ev(over: Partial<EventDto>): EventDto {
  return {
    id: Math.random().toString(36).slice(2),
    childId: 'c1',
    familyId: 'f1',
    type: 'growth',
    occurredAt: '2026-10-01T04:00:00.000Z',
    endedAt: null,
    payload: {},
    note: null,
    createdBy: 'u1',
    createdByNickname: '妈妈',
    updatedBy: null,
    createdAt: '2026-10-01T04:00:00.000Z',
    updatedAt: '2026-10-01T04:00:00.000Z',
    ...over,
  } as EventDto
}

const TZ = 'Asia/Shanghai'

describe('growthSeries', () => {
  it('按时间升序抽出带该字段的生长记录', () => {
    const events = [
      ev({ occurredAt: '2026-10-10T04:00:00.000Z', payload: { weightKg: 8.2 } }),
      ev({ occurredAt: '2026-10-01T04:00:00.000Z', payload: { weightKg: 7.5 } }),
      ev({ occurredAt: '2026-10-05T04:00:00.000Z', payload: { weightKg: 7.9 } }),
    ]
    const pts = growthSeries(events, TZ, 'weightKg')
    expect(pts.map((p) => p.v)).toEqual([7.5, 7.9, 8.2])
    expect(pts.map((p) => p.t)).toEqual([
      Date.parse('2026-10-01T04:00:00.000Z'),
      Date.parse('2026-10-05T04:00:00.000Z'),
      Date.parse('2026-10-10T04:00:00.000Z'),
    ])
  })

  it('跳过没有该字段的记录（同一孩子可能只量了身高）', () => {
    const events = [
      ev({ payload: { weightKg: 8 } }),
      ev({ occurredAt: '2026-10-02T04:00:00.000Z', payload: { heightCm: 70 } }), // 无体重
    ]
    expect(growthSeries(events, TZ, 'weightKg')).toHaveLength(1)
    expect(growthSeries(events, TZ, 'heightCm')).toHaveLength(1)
  })

  it('非 growth 类型、脏值（0/负/非数）、坏时间都被丢掉', () => {
    const events = [
      ev({ payload: { weightKg: 0 } }), // 非法（schema 要 positive）
      ev({ occurredAt: '2026-10-02T00:00:00.000Z', payload: { weightKg: -3 } }),
      ev({ occurredAt: '2026-10-03T00:00:00.000Z', payload: { weightKg: 'x' as unknown as number } }),
      ev({ occurredAt: 'garbage', payload: { weightKg: 5 } }),
      ev({ type: 'feeding', occurredAt: '2026-10-04T04:00:00.000Z', payload: { method: 'bottle', amountMl: 100 } }),
    ]
    expect(growthSeries(events, TZ, 'weightKg')).toHaveLength(0)
  })

  it('label 用账号时区的 M月D日', () => {
    // UTC 2026-10-18T20:00 = 上海 10-19 04:00 → 标签应是 10月19日
    const pts = growthSeries([ev({ occurredAt: '2026-10-18T20:00:00.000Z', payload: { weightKg: 9 } })], TZ, 'weightKg')
    expect(pts[0].label).toBe('10月19日')
  })

  it('指标清单齐全', () => {
    expect(GROWTH_FIELDS.map((f) => f.key)).toEqual(['weightKg', 'heightCm', 'headCm'])
  })
})

describe('valueExtent', () => {
  it('空序列回 {0,0}', () => {
    expect(valueExtent([])).toEqual({ min: 0, max: 0 })
  })

  it('真实量程上下各留白，且体重下界不为负', () => {
    const { min, max } = valueExtent([{ t: 1, label: '', v: 7 }, { t: 2, label: '', v: 9 }])
    expect(min).toBeLessThan(7)
    expect(max).toBeGreaterThan(9)
    expect(min).toBeGreaterThanOrEqual(0)
  })

  it('单点/全同值被撑开成一个可画的小量程，而不是 min==max', () => {
    const { min, max } = valueExtent([{ t: 1, label: '', v: 8 }])
    expect(max).toBeGreaterThan(min)
    expect(min).toBeGreaterThanOrEqual(0)
    expect((min + max) / 2).toBeCloseTo(8, 5)
  })
})
