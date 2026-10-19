import { describe, expect, it } from 'vitest'
import type { EventDto } from '@moonbud/shared'
import { buildOverviewRows, decideHomeView } from '../home-view'
import type { TodaySummary } from '../../../events/summary'

const summary: TodaySummary = {
  lastFeeding: { occurredAt: '2026-10-19T06:00:00.000Z' } as EventDto,
  lastSleep: null,
  diaperCount: 2,
  overdueReminders: [],
}

describe('首页视图判定', () => {
  it('家庭列表加载失败时，绝不能说"还没有家庭"', () => {
    expect(
      decideHomeView({ familyLoadFailed: true, familyId: '', hasChild: false, childrenLoaded: true, childrenLoadFailed: false }),
    ).toBe('retry')
  })

  it('孩子名单还没读出来时，绝不能说"还没有孩子"', () => {
    // 冷启动的那一瞬 childrenByFamily 里还没有这个家庭：把"还不知道"渲染成
    // "确实没有"，家长看到的是自己没给孩子建过档。
    expect(
      decideHomeView({ familyLoadFailed: false, familyId: 'f1', hasChild: false, childrenLoaded: false, childrenLoadFailed: false }),
    ).toBe('loading')
  })

  it('孩子名单读失败了，"正在读取"必须变成一条出路', () => {
    // 挂在"正在读取"上没有重试，冷启动断网时首页就再也出不来了。
    expect(
      decideHomeView({ familyLoadFailed: false, familyId: 'f1', hasChild: false, childrenLoaded: false, childrenLoadFailed: true }),
    ).toBe('child-retry')
  })

  it('真的没有家庭时才给创建/加入引导', () => {
    expect(
      decideHomeView({ familyLoadFailed: false, familyId: '', hasChild: false, childrenLoaded: true, childrenLoadFailed: false }),
    ).toBe('create-family')
  })

  it('有家庭没孩子 → 添加孩子', () => {
    expect(
      decideHomeView({ familyLoadFailed: false, familyId: 'f1', hasChild: false, childrenLoaded: true, childrenLoadFailed: false }),
    ).toBe('add-child')
  })

  it('都有 → 正常概览', () => {
    expect(
      decideHomeView({ familyLoadFailed: false, familyId: 'f1', hasChild: true, childrenLoaded: true, childrenLoadFailed: false }),
    ).toBe('ready')
  })

  it('概览失败时三行都标成失败，而不是"今天还没有"', () => {
    const rows = buildOverviewRows(null, true)
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(row.value).toBe('没加载出来')
      expect(row.failed).toBe(true)
    }
  })

  it('加载成功但当天没有记录 → 才是"今天还没有"', () => {
    const rows = buildOverviewRows(null, false)
    expect(rows.every((r) => !r.failed)).toBe(true)
    expect(rows.map((r) => r.value)).toEqual(['今天还没有', '今天还没有', '0 次'])
  })

  it('有数据时按数据渲染，尿布按今日计数', () => {
    const rows = buildOverviewRows(summary, false)
    expect(rows[0].value).not.toBe('今天还没有')
    expect(rows[1].value).toBe('今天还没有')
    expect(rows[2].value).toBe('2 次')
  })
})
