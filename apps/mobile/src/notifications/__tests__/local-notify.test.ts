import { beforeEach, describe, expect, it, vi } from 'vitest'
import { armReminders, clearLocalNotifications, disarmReminder, rearmLocalNotifications, SCHEDULE_KEY } from '../local-notify'
import type { ArmableReminder } from '../local-notify'

const NOW = new Date('2026-10-19T09:00:00.000Z')

const daily = (id: string, hour = 20): ArmableReminder => ({
  id,
  title: `提醒${id}`,
  body: '全家',
  type: 'RECURRING',
  dueAt: null,
  rrule: `FREQ=DAILY;BYHOUR=${String(hour).padStart(2, '0')};BYMINUTE=00`,
  timezone: 'America/Los_Angeles',
})

interface Row {
  owner: string
  family: string
  title: string
  at: number
}

const laClock = (at: number) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(at))

function allRows(): Row[] {
  const stored = uni.getStorageSync(SCHEDULE_KEY)
  return stored && typeof stored === 'object' ? (Object.values(stored) as Row[]) : []
}

function rowsOf(family: string, owner?: string): Row[] {
  return allRows().filter((r) => r.family === family && (!owner || r.owner === owner))
}

describe('本地排期表', () => {
  beforeEach(() => {
    clearLocalNotifications()
  })

  it('一条重复提醒写下的是接下来几天的多次触发', () => {
    armReminders('f1', [daily('a')], ['f1'], NOW)
    const rows = rowsOf('f1', 'a')
    expect(rows.length).toBeGreaterThanOrEqual(2)
    expect(Math.min(...rows.map((r) => r.at))).toBeGreaterThan(NOW.getTime())
    for (const row of rows) expect(laClock(row.at)).toBe('20:00')
  })

  it('整块重建这一家的排期：服务端已经不列出的提醒不会再响', () => {
    armReminders('f1', [daily('a')], ['f1'], NOW)
    // 在另一台设备上把 a 做完或停掉了，本机重拉的 ACTIVE 列表里没有它。
    armReminders('f1', [daily('b', 8)], ['f1'], NOW)
    expect(rowsOf('f1', 'a')).toEqual([])
    expect(rowsOf('f1', 'b').length).toBeGreaterThanOrEqual(2)
  })

  it('这一家的重建不碰别人家：多家庭账号两边的提醒都算', () => {
    armReminders('f1', [daily('a')], ['f1', 'f2'], NOW)
    armReminders('f2', [daily('z')], ['f1', 'f2'], NOW)
    armReminders('f1', [daily('a', 9)], ['f1', 'f2'], NOW)
    expect(rowsOf('f2', 'z').length).toBeGreaterThanOrEqual(2)
    // 改了时间的 a 不该留下旧时刻。
    const a = rowsOf('f1', 'a')
    expect(a.length).toBeGreaterThanOrEqual(2)
    for (const row of a) expect(laClock(row.at)).toBe('09:00')
  })

  it('这一家没有待办了，就把这一家整块清掉，别留下已经做完的事', () => {
    armReminders('f1', [daily('a')], ['f1', 'f2'], NOW)
    armReminders('f2', [daily('z')], ['f1', 'f2'], NOW)
    armReminders('f1', [], ['f1', 'f2'], NOW)
    expect(rowsOf('f1')).toEqual([])
    expect(rowsOf('f2').length).toBeGreaterThan(0)
  })

  it('已经不在这个账号名下的家庭（归档或退出），排期跟着清掉', () => {
    // 归档/退出都不动别的家庭那一次重算，所以没人会再去清它：
    // 名单里没有它，就得在这里把它留下的推送一起抹掉，否则人都不在这个家了，
    // 锁屏还会继续"该喂药了"直到窗口过完。
    armReminders('f1', [daily('a')], ['f1', 'f2'], NOW)
    armReminders('f2', [daily('z')], ['f1', 'f2'], NOW)
    armReminders('f1', [daily('a')], ['f1'], NOW)
    expect(rowsOf('f1', 'a').length).toBeGreaterThan(0)
    expect(rowsOf('f2')).toEqual([])
  })

  it('名单里两家都在时，重算这一家不许碰另一家', () => {
    armReminders('f1', [daily('a')], ['f1', 'f2'], NOW)
    armReminders('f2', [daily('z')], ['f1', 'f2'], NOW)
    armReminders('f1', [], ['f1', 'f2'], NOW)
    expect(rowsOf('f1')).toEqual([])
    expect(rowsOf('f2').length).toBeGreaterThan(0)
  })

  it('日子往前走，已经响过的那次不再留在表里', () => {
    armReminders('f1', [daily('a')], ['f1'], NOW)
    const later = new Date(NOW.getTime() + 86_400_000)
    armReminders('f1', [daily('a')], ['f1'], later)
    const rows = rowsOf('f1', 'a')
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) expect(row.at).toBeGreaterThan(later.getTime())
  })

  it('一次性提醒过了点，重算时它自己就掉出表', () => {
    const oneTime: ArmableReminder = {
      ...daily('g'),
      type: 'ONE_TIME',
      rrule: null,
      dueAt: new Date(NOW.getTime() + 3_600_000).toISOString(),
    }
    armReminders('f1', [oneTime], ['f1'], NOW)
    expect(rowsOf('f1', 'g')).toHaveLength(1)
    armReminders('f1', [oneTime], ['f1'], new Date(NOW.getTime() + 86_400_000))
    expect(rowsOf('f1', 'g')).toEqual([])
  })

  it('停掉提醒时本地立刻撤销它自己的排期，不等网络', () => {
    armReminders('f1', [daily('a'), daily('b')], ['f1'], NOW)
    disarmReminder('a')
    expect(rowsOf('f1', 'a')).toEqual([])
    expect(rowsOf('f1', 'b').length).toBeGreaterThan(0)
  })

  it('旧版只排一次时留下的条目（没有归属家庭）在重算时清掉', () => {
    // 上一个版本写的登记表条目没有 family 字段，它不属于任何一次重算，
    // 于是会一直压在表里：家庭早就删了，推送还在响。
    uni.setStorageSync(SCHEDULE_KEY, {
      'legacy-id': { id: 'legacy-id', title: '旧版一次性', body: '全家', at: Date.now() + 3_600_000 },
    })
    armReminders('f1', [daily('a')], ['f1'], NOW)
    expect(allRows().some((r) => r.title === '旧版一次性')).toBe(false)
    expect(rowsOf('f1', 'a').length).toBeGreaterThan(0)
  })

  it('冷启动重放时清掉已经过去了的条目和旧版没有归属的条目', () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    armReminders('f1', [daily('a')], ['f1'], NOW)
    expect(allRows().length).toBeGreaterThanOrEqual(2)
    // 旧版（一条提醒一次排期）留下的条目：没有 family，谁也不会重算它。
    const legacyKey = 'legacy-id'
    const stored = uni.getStorageSync(SCHEDULE_KEY) as Record<string, unknown>
    stored[legacyKey] = { id: 'legacy-id', title: '旧版一次性', body: '全家', at: Date.now() + 3_600_000 }
    uni.setStorageSync(SCHEDULE_KEY, stored)
    // 两天后才想起重放：头两次早就响过了，不该还留在表里等着被写回。
    vi.setSystemTime(new Date(NOW.getTime() + 2 * 86_400_000))
    rearmLocalNotifications()
    const after = rowsOf('f1')
    expect(after.length).toBeGreaterThan(0)
    for (const row of after) expect(row.at).toBeGreaterThan(Date.now())
    expect(allRows().some((r) => r.title === '旧版一次性')).toBe(false)
    vi.useRealTimers()
  })
})
