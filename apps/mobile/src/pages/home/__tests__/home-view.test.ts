import { describe, expect, it } from 'vitest'
import type { EventDto } from '@moonbud/shared'
import { buildGuestOverviewRows, buildOverviewRows, decideHomeView } from '../home-view'
import type { TodaySummary } from '../../../events/summary'

const summary: TodaySummary = {
  lastFeeding: { occurredAt: '2026-10-19T06:00:00.000Z' } as EventDto,
  lastSleep: null,
  diaperCount: 2,
  overdueCount: 0,
}

describe('首页视图判定', () => {
  it('会话还没问出来 → 既不能说"还没有家庭"，也不能说"来登录吧"', () => {
    // 冷启动第一帧 token 还在路上；这时判成游客，老用户每次打开都被问一遍要不要登录。
    expect(
      decideHomeView({ session: 'unknown', familyLoadFailed: false, familyId: '', hasChild: false, childrenLoaded: false, childrenLoadFailed: false }),
    ).toBe('checking')
  })

  it('确认是游客 → 游客引导，排在家庭空态之前', () => {
    // 游客身上 familyId 永远是空串，和"有账号但没建过家"长得一模一样；不分流就念错。
    expect(
      decideHomeView({ session: 'guest', familyLoadFailed: false, familyId: '', hasChild: false, childrenLoaded: false, childrenLoadFailed: false }),
    ).toBe('guest')
  })

  it('游客的判定压过加载失败：断网冷启动不该在游客屏上挂一个"重试"', () => {
    expect(
      decideHomeView({ session: 'guest', familyLoadFailed: true, familyId: '', hasChild: false, childrenLoaded: false, childrenLoadFailed: false }),
    ).toBe('guest')
  })

  it('有会话的人照旧走家庭/孩子那套判定', () => {
    expect(
      decideHomeView({ session: 'member', familyLoadFailed: true, familyId: '', hasChild: false, childrenLoaded: true, childrenLoadFailed: false }),
    ).toBe('retry')
  })

  it('家庭列表加载失败时，绝不能说"还没有家庭"', () => {
    expect(
      decideHomeView({ session: 'member', familyLoadFailed: true, familyId: '', hasChild: false, childrenLoaded: true, childrenLoadFailed: false }),
    ).toBe('retry')
  })

  it('孩子名单还没读出来时，绝不能说"还没有孩子"', () => {
    // 冷启动的那一瞬 childrenByFamily 里还没有这个家庭：把"还不知道"渲染成
    // "确实没有"，家长看到的是自己没给孩子建过档。
    expect(
      decideHomeView({ session: 'member', familyLoadFailed: false, familyId: 'f1', hasChild: false, childrenLoaded: false, childrenLoadFailed: false }),
    ).toBe('loading')
  })

  it('孩子名单读失败了，"正在读取"必须变成一条出路', () => {
    // 挂在"正在读取"上没有重试，冷启动断网时首页就再也出不来了。
    expect(
      decideHomeView({ session: 'member', familyLoadFailed: false, familyId: 'f1', hasChild: false, childrenLoaded: false, childrenLoadFailed: true }),
    ).toBe('child-retry')
  })

  it('真的没有家庭时才给创建/加入引导', () => {
    expect(
      decideHomeView({ session: 'member', familyLoadFailed: false, familyId: '', hasChild: false, childrenLoaded: true, childrenLoadFailed: false }),
    ).toBe('create-family')
  })

  it('有家庭没孩子 → 添加孩子', () => {
    expect(
      decideHomeView({ session: 'member', familyLoadFailed: false, familyId: 'f1', hasChild: false, childrenLoaded: true, childrenLoadFailed: false }),
    ).toBe('add-child')
  })

  it('都有 → 正常概览', () => {
    expect(
      decideHomeView({ session: 'member', familyLoadFailed: false, familyId: 'f1', hasChild: true, childrenLoaded: true, childrenLoadFailed: false }),
    ).toBe('ready')
  })

  it('概览失败时三行都标成失败，而不是"今天还没有"', () => {
    const rows = buildOverviewRows(null, true, 'Asia/Shanghai')
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(row.value).toBe('没加载出来')
      expect(row.failed).toBe(true)
    }
  })

  it('加载成功但当天没有记录 → 才是"今天还没有"', () => {
    const rows = buildOverviewRows(null, false, 'Asia/Shanghai')
    expect(rows.every((r) => !r.failed)).toBe(true)
    expect(rows.map((r) => r.value)).toEqual(['今天还没有', '今天还没有', '0 次'])
  })

  it('有数据时按数据渲染，尿布按今日计数', () => {
    const rows = buildOverviewRows(summary, false, 'Asia/Shanghai')
    expect(rows[0].value).not.toBe('今天还没有')
    expect(rows[1].value).toBe('今天还没有')
    expect(rows[2].value).toBe('2 次')
  })

  /**
   * 概览行是"多久以前"退成绝对日期的那一类文案：家人不在同一块表上时，
   * 按设备本地念会让上海的 10月19日 变成洛杉矶的 10月18日。
   */
  it('最近喂奶念的是账号时区里的钟点', () => {
    // 同一个时刻：上海是 10月19日 14:00，洛杉矶还是 10月18日 23:00。
    const now = new Date('2026-10-21T04:00:00.000Z')
    expect(buildOverviewRows(summary, false, 'Asia/Shanghai', now)[0].value).toBe('昨天 14:00')
    expect(buildOverviewRows(summary, false, 'America/Los_Angeles', now)[0].value).toBe('昨天 23:00')
  })

  /**
   * 游客那一屏的概览行。这一格挡的是一句很顺手的谎话：游客没有 summary，
   * 直接把 null 喂给 buildOverviewRows 会念出"今天还没有 / 0 次"——
   * 那是"这个家今天没人喂过孩子"，而他根本没有这个家。
   */
  it('游客的概览行只有短横线，不说"今天还没有"', () => {
    const rows = buildGuestOverviewRows()
    expect(rows.map((r) => r.label)).toEqual(['最近喂奶', '最近睡眠', '今日换尿布'])
    expect(rows.map((r) => r.value)).toEqual(['—', '—', '—'])
    expect(rows.every((r) => !r.failed)).toBe(true)
  })
})
