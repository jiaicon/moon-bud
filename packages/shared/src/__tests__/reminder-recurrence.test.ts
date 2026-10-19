import { describe, expect, it } from 'vitest'
import {
  computeDueAt,
  expandDueDates,
  instantFromWallClock,
  isSupportedTimezone,
  wallClockAt,
} from '../reminder-recurrence'

const TZ = 'Asia/Shanghai' // UTC+8，无夏令时，便于断言

describe('computeDueAt / ONE_TIME', () => {
  it('未来时间原样返回', () => {
    const due = new Date('2026-11-01T00:00:00Z')
    const after = new Date('2026-10-31T00:00:00Z')
    expect(
      computeDueAt({ type: 'ONE_TIME', dueAt: due, timezone: TZ, after })?.toISOString(),
    ).toBe('2026-11-01T00:00:00.000Z')
  })

  it('已过去的时间返回 null', () => {
    const due = new Date('2026-10-01T00:00:00Z')
    const after = new Date('2026-10-31T00:00:00Z')
    expect(computeDueAt({ type: 'ONE_TIME', dueAt: due, timezone: TZ, after })).toBeNull()
  })

  it('缺少 dueAt 时返回 null 而不抛错', () => {
    expect(
      computeDueAt({ type: 'ONE_TIME', dueAt: null, timezone: TZ, after: new Date() }),
    ).toBeNull()
  })
})

describe('computeDueAt / RECURRING', () => {
  it('每天 08:00（上海）在 UTC 是 00:00', () => {
    const after = new Date('2026-10-15T12:00:00Z')
    const next = computeDueAt({
      type: 'RECURRING',
      rrule: 'FREQ=DAILY;BYHOUR=8;BYMINUTE=0',
      timezone: TZ,
      after,
    })
    expect(next?.toISOString()).toBe('2026-10-16T00:00:00.000Z')
  })

  it('时区不同则触发时刻不同', () => {
    const after = new Date('2026-10-15T12:00:00Z')
    const sh = computeDueAt({
      type: 'RECURRING',
      rrule: 'FREQ=DAILY;BYHOUR=8;BYMINUTE=0',
      timezone: 'Asia/Shanghai',
      after,
    })
    const ny = computeDueAt({
      type: 'RECURRING',
      rrule: 'FREQ=DAILY;BYHOUR=8;BYMINUTE=0',
      timezone: 'America/New_York',
      after,
    })
    expect(sh!.getTime()).not.toBe(ny!.getTime())
  })

  it('结果严格晚于 after，不会重复返回同一时刻', () => {
    const rrule = 'FREQ=DAILY;BYHOUR=8;BYMINUTE=0'
    const first = computeDueAt({
      type: 'RECURRING',
      rrule,
      timezone: TZ,
      after: new Date('2026-10-15T12:00:00Z'),
    })!
    const second = computeDueAt({ type: 'RECURRING', rrule, timezone: TZ, after: first })!
    expect(second.getTime()).toBeGreaterThan(first.getTime())
  })

  it('无法解析的 rrule 返回 null 而不抛错', () => {
    expect(
      computeDueAt({
        type: 'RECURRING',
        rrule: 'THIS IS NOT RRULE',
        timezone: TZ,
        after: new Date(),
      }),
    ).toBeNull()
    expect(
      computeDueAt({ type: 'RECURRING', rrule: null, timezone: TZ, after: new Date() }),
    ).toBeNull()
  })

  it('非法时区返回 null 而不抛错', () => {
    expect(
      computeDueAt({
        type: 'RECURRING',
        rrule: 'FREQ=DAILY;BYHOUR=8;BYMINUTE=0',
        timezone: 'Not/AZone',
        after: new Date('2026-10-15T12:00:00Z'),
      }),
    ).toBeNull()
  })
})

describe('expandDueDates', () => {
  it('展开区间内所有触发的本地 8 点', () => {
    const dates = expandDueDates({
      rrule: 'FREQ=DAILY;BYHOUR=8;BYMINUTE=0',
      timezone: TZ,
      from: new Date('2026-10-15T00:00:00Z'),
      to: new Date('2026-10-18T00:00:00Z'),
    })
    expect(dates.map((d) => d.toISOString())).toEqual([
      '2026-10-15T00:00:00.000Z',
      '2026-10-16T00:00:00.000Z',
      '2026-10-17T00:00:00.000Z',
    ])
  })

  it('遵守 limit 上限，避免无限展开', () => {
    const dates = expandDueDates({
      rrule: 'FREQ=MINUTELY',
      timezone: TZ,
      from: new Date('2026-10-15T00:00:00Z'),
      to: new Date('2026-10-16T00:00:00Z'),
      limit: 10,
    })
    expect(dates).toHaveLength(10)
  })

  it('恰好等于 to 的触发点不包含（左闭右开，避免调度器提前生成未到期实例）', () => {
    const dates = expandDueDates({
      rrule: 'FREQ=DAILY;BYHOUR=8;BYMINUTE=0',
      timezone: TZ,
      from: new Date('2026-10-15T00:00:00Z'),
      to: new Date('2026-10-16T00:00:00Z'),
    })
    expect(dates.map((d) => d.toISOString())).toEqual(['2026-10-15T00:00:00.000Z'])
  })

  it('恰好等于 from 的触发点包含（否则上一轮的最后一个实例会漏掉）', () => {
    const dates = expandDueDates({
      rrule: 'FREQ=DAILY;BYHOUR=8;BYMINUTE=0',
      timezone: TZ,
      from: new Date('2026-10-15T00:00:00Z'),
      to: new Date('2026-10-17T00:00:00Z'),
    })
    expect(dates[0]!.toISOString()).toBe('2026-10-15T00:00:00.000Z')
  })

  it('to 早于 from 时返回空数组', () => {
    expect(
      expandDueDates({
        rrule: 'FREQ=DAILY',
        timezone: TZ,
        from: new Date('2026-10-20T00:00:00Z'),
        to: new Date('2026-10-15T00:00:00Z'),
      }),
    ).toEqual([])
  })

  it('非法时区或非法 rrule 返回空数组而不抛错', () => {
    expect(
      expandDueDates({
        rrule: 'FREQ=DAILY',
        timezone: 'Not/AZone',
        from: new Date('2026-10-15T00:00:00Z'),
        to: new Date('2026-10-18T00:00:00Z'),
      }),
    ).toEqual([])
    expect(
      expandDueDates({
        rrule: 'NOPE',
        timezone: TZ,
        from: new Date('2026-10-15T00:00:00Z'),
        to: new Date('2026-10-18T00:00:00Z'),
      }),
    ).toEqual([])
  })
})

describe('instantFromWallClock / wallClockAt', () => {
  it('上海墙上的 08:00 是 UTC 的 00:00', () => {
    const at = instantFromWallClock('Asia/Shanghai', {
      year: 2026,
      month: 11,
      day: 1,
      hour: 8,
      minute: 0,
    })
    expect(at?.toISOString()).toBe('2026-11-01T00:00:00.000Z')
  })

  it('同一份钟点在别的时区是另一个时刻', () => {
    const clock = { year: 2026, month: 12, day: 15, hour: 8, minute: 0 }
    const sh = instantFromWallClock('Asia/Shanghai', clock)
    const ny = instantFromWallClock('America/New_York', clock)
    expect(sh?.toISOString()).toBe('2026-12-15T00:00:00.000Z')
    expect(ny?.toISOString()).toBe('2026-12-15T13:00:00.000Z')
  })

  it('墙上的 0 点不会漂到前一天', () => {
    const at = instantFromWallClock('Asia/Shanghai', {
      year: 2026,
      month: 11,
      day: 1,
      hour: 0,
      minute: 0,
    })
    expect(at?.toISOString()).toBe('2026-10-31T16:00:00.000Z')
  })

  it('夏令时切换日按当天真实偏移换算', () => {
    // 纽约 2026-03-08 02:30 并不存在（02:00 直接跳到 03:00）：
    // 换算不能抛错，也不能给出一个偏移完全错的时刻。
    const before = instantFromWallClock('America/New_York', {
      year: 2026,
      month: 3,
      day: 7,
      hour: 8,
      minute: 0,
    })
    const after = instantFromWallClock('America/New_York', {
      year: 2026,
      month: 3,
      day: 9,
      hour: 8,
      minute: 0,
    })
    expect(before?.toISOString()).toBe('2026-03-07T13:00:00.000Z')
    expect(after?.toISOString()).toBe('2026-03-09T12:00:00.000Z')
  })

  it('非法时区返回 null 而不抛错', () => {
    expect(
      instantFromWallClock('Not/AZone', { year: 2026, month: 1, day: 1, hour: 0, minute: 0 }),
    ).toBeNull()
  })

  it('和 wallClockAt 互为逆运算', () => {
    const clock = wallClockAt('Asia/Shanghai', new Date('2026-11-01T00:00:00Z'))
    expect(clock).toEqual({ year: 2026, month: 11, day: 1, hour: 8, minute: 0 })
    expect(instantFromWallClock('Asia/Shanghai', clock!)?.toISOString()).toBe(
      '2026-11-01T00:00:00.000Z',
    )
    expect(wallClockAt('Not/AZone', new Date())).toBeNull()
  })
})

describe('isSupportedTimezone', () => {
  it('认识 IANA 名，不认识乱写的字符串', () => {
    expect(isSupportedTimezone('Asia/Shanghai')).toBe(true)
    expect(isSupportedTimezone('Not/AZone')).toBe(false)
  })

  it('拒绝空字符串与非字符串', () => {
    expect(isSupportedTimezone('')).toBe(false)
    // 签名收 unknown，因此这两条是运行期防御，不是类型错误
    expect(isSupportedTimezone(null)).toBe(false)
    expect(isSupportedTimezone(42)).toBe(false)
    expect(isSupportedTimezone({ toString: () => 'Asia/Shanghai' })).toBe(false)
  })
})
