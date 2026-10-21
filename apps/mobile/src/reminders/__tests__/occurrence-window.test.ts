import { describe, expect, it } from 'vitest'
import { occurrencesWithinWindow, SCHEDULE_HORIZON_MS } from '../occurrence-window'

/** 此刻：上海 2026-10-19 17:00，洛杉矶 2026-10-19 02:00。 */
const NOW = new Date('2026-10-19T09:00:00.000Z')

const clockIn = (zone: string, at: Date) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at)

describe('本地排期的未来窗口', () => {
  it('重复提醒在窗口里展开成多次，而不是只有下一次', () => {
    const at = occurrencesWithinWindow(
      { type: 'RECURRING', dueAt: null, rrule: 'FREQ=DAILY;BYHOUR=20;BYMINUTE=00', timezone: 'America/Los_Angeles' },
      NOW,
    )
    expect(at.length).toBeGreaterThanOrEqual(2)
    expect(at.length).toBeLessThanOrEqual(Math.round(SCHEDULE_HORIZON_MS / 86_400_000) + 1)
    for (const instant of at) {
      expect(instant.getTime()).toBeGreaterThan(NOW.getTime())
      expect(instant.getTime()).toBeLessThanOrEqual(NOW.getTime() + SCHEDULE_HORIZON_MS)
      expect(clockIn('America/Los_Angeles', instant)).toBe('20:00')
    }
    expect([...at].sort((a, b) => a.getTime() - b.getTime())).toEqual(at)
  })

  it('时刻按提醒自己的时区落，不按设备', () => {
    const at = occurrencesWithinWindow(
      { type: 'RECURRING', dueAt: null, rrule: 'FREQ=DAILY;BYHOUR=08;BYMINUTE=30', timezone: 'Asia/Shanghai' },
      NOW,
    )
    expect(at.length).toBeGreaterThan(0)
    for (const instant of at) expect(clockIn('Asia/Shanghai', instant)).toBe('08:30')
  })

  it('每两天的网格由创建时刻对齐：晚两天进前台，该排的还是那天', () => {
    // 10-19 10:00（上海）创建的"每隔两天 08:00"，网格因此是 21、23……
    const everyTwoDays = {
      type: 'RECURRING' as const,
      dueAt: null,
      rrule: 'FREQ=DAILY;INTERVAL=2;BYHOUR=08;BYMINUTE=00',
      timezone: 'Asia/Shanghai',
      createdAt: '2026-10-19T02:00:00.000Z',
    }
    // 20 号 17:00（上海）进前台，往后看三天：21 号那次必须在表里。
    expect(
      occurrencesWithinWindow(everyTwoDays, new Date('2026-10-20T09:00:00.000Z')).map((d) => d.toISOString()),
    ).toEqual(['2026-10-21T00:00:00.000Z', '2026-10-23T00:00:00.000Z'])
  })

  it('一次性提醒：还没到就排一次，已过就什么都不排', () => {
    const soon = new Date(NOW.getTime() + 3_600_000).toISOString()
    expect(occurrencesWithinWindow({ type: 'ONE_TIME', dueAt: soon, rrule: null, timezone: 'Asia/Shanghai' }, NOW)).toHaveLength(1)
    const past = new Date(NOW.getTime() - 3_600_000).toISOString()
    expect(occurrencesWithinWindow({ type: 'ONE_TIME', dueAt: past, rrule: null, timezone: 'Asia/Shanghai' }, NOW)).toEqual([])
    const far = new Date(NOW.getTime() + SCHEDULE_HORIZON_MS + 3_600_000).toISOString()
    expect(occurrencesWithinWindow({ type: 'ONE_TIME', dueAt: far, rrule: null, timezone: 'Asia/Shanghai' }, NOW)).toEqual([])
  })

  it('坏输入返回空数组，绝不抛错——一条坏提醒不能毁掉整张排期表', () => {
    expect(occurrencesWithinWindow({ type: 'RECURRING', dueAt: null, rrule: 'FREQ=Nonsense', timezone: 'Asia/Shanghai' }, NOW)).toEqual([])
    expect(occurrencesWithinWindow({ type: 'RECURRING', dueAt: null, rrule: null, timezone: 'Asia/Shanghai' }, NOW)).toEqual([])
    expect(
      occurrencesWithinWindow({ type: 'RECURRING', dueAt: null, rrule: 'FREQ=DAILY;BYHOUR=08;BYMINUTE=00', timezone: 'Mars/Olympus' }, NOW),
    ).toEqual([])
    expect(occurrencesWithinWindow({ type: 'ONE_TIME', dueAt: 'not-a-date', rrule: null, timezone: 'Asia/Shanghai' }, NOW)).toEqual([])
  })
})
