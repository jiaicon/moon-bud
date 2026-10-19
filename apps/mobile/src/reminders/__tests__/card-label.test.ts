import { describe, expect, it } from 'vitest'
import type { ReminderDto } from '@moonbud/shared'
import { reminderCardLabel } from '../card-label'

const NOW = new Date('2026-10-19T09:00:00.000Z')

const base = (over: Partial<ReminderDto>): ReminderDto => ({
  id: 'r1',
  familyId: 'f1',
  childId: null,
  title: '该喂药',
  note: null,
  type: 'RECURRING',
  dueAt: null,
  rrule: 'FREQ=DAILY;BYHOUR=20;BYMINUTE=00',
  timezone: 'Asia/Shanghai',
  assigneeId: null,
  status: 'ACTIVE',
  createdBy: 'u1',
  createdAt: '2026-10-01T00:00:00.000Z',
  overdueSince: null,
  ...over,
})

describe('reminderCardLabel', () => {
  it('没到点的重复提醒说的是下一次', () => {
    // 上海 17:00，每天 20:00 那次还没到。
    const at = new Date('2026-10-19T09:00:00.000Z')
    expect(reminderCardLabel(base({}), at)).toBe('每天 · 下次 今天 20:00')
  })

  it('过期了就说还欠哪一次，不许只报下一次', () => {
    // 上海 09:00：每天 08:00 那次已经过去。光写"下次 明天 08:00"，
    // 家长扫一眼就过去了，那一次谁都没做。
    const label = reminderCardLabel(
      base({ rrule: 'FREQ=DAILY;BYHOUR=8;BYMINUTE=00', overdueSince: '2026-10-19T00:00:00.000Z' }),
      NOW,
    )
    expect(label).toBe('每天 · 还欠 今天 08:00')
  })

  it('欠的是昨天那次就写昨天', () => {
    const label = reminderCardLabel(
      base({ rrule: 'FREQ=DAILY;BYHOUR=8;BYMINUTE=00', overdueSince: '2026-10-18T00:00:00.000Z' }),
      NOW,
    )
    expect(label).toBe('每天 · 还欠 昨天 08:00')
  })

  it('每 N 天把间隔念出来', () => {
    const label = reminderCardLabel(
      base({ rrule: 'FREQ=DAILY;INTERVAL=3;BYHOUR=8;BYMINUTE=00', overdueSince: '2026-10-19T00:00:00.000Z' }),
      NOW,
    )
    expect(label).toBe('每 3 天 · 还欠 今天 08:00')
  })

  it('一次性提醒过期了同样说还欠，没过期说钟点', () => {
    expect(
      reminderCardLabel(base({ type: 'ONE_TIME', rrule: null, dueAt: '2026-10-19T00:00:00.000Z', overdueSince: '2026-10-19T00:00:00.000Z' }), NOW),
    ).toBe('还欠 今天 08:00')
    expect(
      reminderCardLabel(base({ type: 'ONE_TIME', rrule: null, dueAt: '2026-10-20T01:00:00.000Z' }), NOW),
    ).toBe('明天 09:00')
  })

  it('按提醒自己的时区念，不按设备', () => {
    // 洛杉矶 10-18 21:00 = UTC 10-19 04:00：按设备（上海）会念成第二天。
    const la = base({ timezone: 'America/Los_Angeles', rrule: 'FREQ=DAILY;BYHOUR=8;BYMINUTE=00', overdueSince: '2026-10-19T03:00:00.000Z' })
    expect(reminderCardLabel(la, new Date('2026-10-19T04:00:00.000Z'))).toBe('每天 · 还欠 今天 20:00')
  })

  it('过期的一次性提醒仍然说得出它约定的时间', () => {
    // 已完成分栏里就是这条时间被做掉了；写成"未设定时间"是把事实说反。
    expect(
      reminderCardLabel(
        base({ type: 'ONE_TIME', rrule: null, dueAt: '2026-10-19T00:00:00.000Z', status: 'DONE' }),
        NOW,
      ),
    ).toBe('今天 08:00（已过）')
    expect(
      reminderCardLabel(
        base({ type: 'ONE_TIME', rrule: null, dueAt: '2026-10-12T00:00:00.000Z', status: 'DONE' }),
        NOW,
      ),
    ).toBe('10月12日 08:00')
  })

  it('算不出下次触发时承认待调度，不编一个时间', () => {
    expect(reminderCardLabel(base({ rrule: null }), NOW)).toBe('重复 · 下次 待定')
    expect(reminderCardLabel(base({ type: 'ONE_TIME', rrule: null, dueAt: null }), NOW)).toBe('未设定时间')
  })
})
