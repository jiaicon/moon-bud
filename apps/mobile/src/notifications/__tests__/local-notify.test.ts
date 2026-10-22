import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  armReminders,
  clearLocalNotifications,
  disarmReminder,
  rearmLocalNotifications,
  setLocalPushEnabled,
  SCHEDULE_KEY,
} from '../local-notify'
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

// 真机上装的云打包 APK 若没包含 push 模块，plus.push.clear/createMessage 会抛
// "打包时未添加push模块，请参考…"。这句话既不该出现在家长面前，也不该让"新建提醒"整个失败：
// 站内提醒中心和应用内的到点提示都不依赖原生 push。
describe('APK 未打包 push 模块', () => {
  const plus = (globalThis as unknown as { plus: { push: { clear: () => void; createMessage: () => void } } }).plus
  let native: typeof import('../local-notify')

  beforeEach(async () => {
    vi.resetModules()
    native = await import('../local-notify')
    native.setLocalPushEnabled(true)
    plus.push.clear = () => {
      throw new Error('打包时未添加push模块')
    }
    plus.push.createMessage = plus.push.clear
  })

  afterEach(() => {
    native.setLocalPushEnabled(false)
    plus.push.clear = () => {}
    plus.push.createMessage = () => {}
  })

  const rows = () => {
    const stored = uni.getStorageSync(native.SCHEDULE_KEY)
    return stored && typeof stored === 'object' ? Object.values(stored) : []
  }

  it('排期不抛错，登记表照常写', () => {
    expect(() => native.armReminders('f1', [daily('a')], ['f1'], NOW)).not.toThrow()
    expect(rows().length).toBeGreaterThanOrEqual(2)
  })

  it('撤销与退出登录也不抛错，表照样清空', () => {
    native.armReminders('f1', [daily('a')], ['f1'], NOW)
    expect(() => native.disarmReminder('a')).not.toThrow()
    expect(rows().length).toBe(0)
    native.armReminders('f1', [daily('b')], ['f1'], NOW)
    expect(() => native.clearLocalNotifications()).not.toThrow()
    expect(rows().length).toBe(0)
  })

  it('只在第一次说一遍，不每次重算都刷屏', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    native.armReminders('f1', [daily('a')], ['f1'], NOW)
    native.armReminders('f1', [daily('b')], ['f1'], NOW)
    native.rearmLocalNotifications()
    const pushWarns = warn.mock.calls.filter((args) => String(args[0]).includes('push'))
    expect(pushWarns.length).toBe(1)
    warn.mockRestore()
  })
})

// 2026-10-22 真机四路对照：plus 与 uni 两套 API 上 `when` 都是"消息上显示的时间戳"，
// 消息一提交就立刻冒出来（A/D 两条都是），真正推迟显示的参数是 `delay`（秒，B/C 两条
// 各自在 +120s / +180s 响）。这就是"保存即弹、到点不响"的根因。
describe('交给原生 push 的参数', () => {
  const plus = (
    globalThis as unknown as {
      plus: { push: { clear: () => void; createMessage: (content: string, payload: string, options: Record<string, unknown>) => void } }
    }
  ).plus
  let submitted: Array<[string, string, Record<string, unknown>]>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    clearLocalNotifications()
    submitted = []
    plus.push.clear = () => {}
    plus.push.createMessage = (content, payload, options) => {
      submitted.push([content, payload, options])
    }
    setLocalPushEnabled(true)
  })

  afterEach(() => {
    setLocalPushEnabled(false)
    plus.push.createMessage = () => {}
    vi.useRealTimers()
  })

  it('排进去的是延迟秒数：离现在多久就延多久，而不是塞一个 when', () => {
    const oneTime: ArmableReminder = {
      ...daily('g'),
      type: 'ONE_TIME',
      rrule: null,
      dueAt: new Date(NOW.getTime() + 30 * 60_000).toISOString(),
    }
    armReminders('f1', [oneTime], ['f1'], NOW)
    expect(submitted).toHaveLength(1)
    const [content, , options] = submitted[0]
    expect(content).toBe('全家')
    expect(options).toEqual({ title: '提醒g', delay: 1800 })
  })

  it('重复提醒的每一次触发各按自己的时刻延迟，不是全部立刻响', () => {
    armReminders('f1', [daily('a')], ['f1'], NOW)
    expect(submitted.length).toBeGreaterThanOrEqual(2)
    const expected = rowsOf('f1', 'a')
      .map((row) => Math.round((row.at - NOW.getTime()) / 1000))
      .sort((x, y) => x - y)
    const actual = submitted
      .map(([, , options]) => options.delay as number)
      .sort((x, y) => x - y)
    expect(actual).toEqual(expected)
    for (const [, , options] of submitted) expect(options.when).toBeUndefined()
  })
})

// plus 排上去的定时消息撤不掉（官方《Push 推送开发指南》：clear() 清的是"系统通知栏中
// 属于当前应用的所有消息"，还没到点、压在队列里的那条它碰不到），真机也验过：停掉提醒后
// 旧时刻照响。所以"到点提醒"改由服务端推送负责（PUSH_REMINDER_DUE），本地排期只留给
// 这台设备上报不到 cid 的情况兜底 —— 默认关，宁可少响也不能响掉一个已经撤不掉的。
describe('本地排期只是兜底', () => {
  const plus = (
    globalThis as unknown as {
      plus: { push: { clear: () => void; createMessage: (content: string, payload: string, options: Record<string, unknown>) => void } }
    }
  ).plus
  let nativeCalls: number

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    clearLocalNotifications()
    nativeCalls = 0
    plus.push.clear = () => {}
    plus.push.createMessage = () => {
      nativeCalls += 1
    }
  })

  afterEach(() => {
    setLocalPushEnabled(false)
    plus.push.createMessage = () => {}
    vi.useRealTimers()
  })

  it('没开启时一条都不交给原生，登记表照常写', () => {
    armReminders('f1', [daily('a')], ['f1'], NOW)
    expect(nativeCalls).toBe(0)
    expect(rowsOf('f1', 'a').length).toBeGreaterThanOrEqual(2)
  })

  it('上报不到 cid 而开启兜底时，把表里已有的排期补交给原生', () => {
    armReminders('f1', [daily('a')], ['f1'], NOW)
    expect(nativeCalls).toBe(0)
    setLocalPushEnabled(true)
    expect(nativeCalls).toBe(rowsOf('f1', 'a').length)
  })

  it('重新关掉（这台设备上报上 cid 了）之后不再往原生里排', () => {
    setLocalPushEnabled(true)
    armReminders('f1', [daily('a')], ['f1'], NOW)
    expect(nativeCalls).toBeGreaterThan(0)
    const alreadyArmed = nativeCalls
    setLocalPushEnabled(false)
    armReminders('f1', [daily('b')], ['f1'], NOW)
    expect(nativeCalls).toBe(alreadyArmed)
  })
})
