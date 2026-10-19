import { describe, expect, it } from 'vitest'
import { isoFromWallTime, wallFields } from '../wall-time'

/**
 * 表单里用户按的是钟点（"明天 08:00"），后端存的是时刻。中间这一步必须由
 * 账号时区来翻译：设备在 UTC+0 而家在上海时，按设备换算会把上海早 8 点的
 * 喂药提醒排到下午 4 点，而列表里念出来的又是账号时区的钟点——同一屏自相矛盾。
 */
describe('isoFromWallTime：钟点 → 时刻', () => {
  it('上海的 08:00 是 UTC 的 00:00', () => {
    expect(isoFromWallTime('Asia/Shanghai', '2026-11-01', '08:00')).toBe('2026-11-01T00:00:00.000Z')
  })

  it('同一份钟点在纽约是另一个时刻', () => {
    expect(isoFromWallTime('America/New_York', '2026-11-01', '08:00')).toBe('2026-11-01T13:00:00.000Z')
  })

  it('凌晨 0 点不漂到前一天', () => {
    expect(isoFromWallTime('Asia/Shanghai', '2026-11-01', '00:00')).toBe('2026-10-31T16:00:00.000Z')
  })

  it('时区认不出来时退回设备本地时间，等于改动前的行为', () => {
    const deviceLocal = new Date(2026, 10, 1, 8, 0).toISOString()
    expect(isoFromWallTime('Not/AZone', '2026-11-01', '08:00')).toBe(deviceLocal)
  })
})

describe('wallFields：时刻 → 表单该显示的钟点', () => {
  it('按账号时区读“现在”，跨日的凌晨也算对的那天', () => {
    expect(wallFields('Asia/Shanghai', new Date('2026-11-01T00:00:00Z'))).toEqual({
      date: '2026-11-01',
      time: '08:00',
    })
    expect(wallFields('Asia/Shanghai', new Date('2026-10-31T16:30:00Z'))).toEqual({
      date: '2026-11-01',
      time: '00:30',
    })
  })

  it('写入和读回互为逆运算', () => {
    const instant = new Date('2026-12-15T13:00:00Z')
    const { date, time } = wallFields('America/New_York', instant)
    expect(isoFromWallTime('America/New_York', date, time)).toBe(instant.toISOString())
  })

  it('时区认不出来时退回设备本地日期', () => {
    const now = new Date(2026, 10, 1, 8, 0)
    expect(wallFields('Not/AZone', now)).toEqual({ date: '2026-11-01', time: '08:00' })
  })
})
