import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const listMock = vi.hoisted(() => vi.fn())
vi.mock('../../api/endpoints', () => ({ notificationsApi: { list: listMock } }))

const { applyUnreadBadge, refreshUnreadTabBadge, REMINDER_TAB_INDEX } = await import('../tab-badge')

const calls: Array<{ kind: 'set' | 'remove'; arg: { index: number; text?: string } }> = []
const g = globalThis as Record<string, any>
let restore: (() => void) | null = null

beforeEach(() => {
  calls.length = 0
  listMock.mockReset()
  const before = g.uni
  g.uni = {
    ...before,
    setTabBarBadge: (arg: { index: number; text?: string }) => calls.push({ kind: 'set', arg }),
    removeTabBarBadge: (arg: { index: number }) => calls.push({ kind: 'remove', arg }),
  }
  restore = () => {
    g.uni = before
  }
})
afterEach(() => restore?.())

describe('底部“提醒”格的未读角标', () => {
  it('有未读就把数字写在提醒那一格上', () => {
    applyUnreadBadge(7)
    expect(calls).toEqual([{ kind: 'set', arg: { index: REMINDER_TAB_INDEX, text: '7' } }])
  })

  it('清零是摘掉角标，不是写一个 0', () => {
    applyUnreadBadge(0)
    expect(calls.map((c) => c.kind)).toEqual(['remove'])
  })

  it('角标窄，一百条只写 99+', () => {
    applyUnreadBadge(120)
    expect(calls).toEqual([{ kind: 'set', arg: { index: REMINDER_TAB_INDEX, text: '99+' } }])
  })

  it('读不到时什么都不动：摘掉角标等于替用户宣布"没有要看的"', () => {
    applyUnreadBadge(null)
    expect(calls).toEqual([])
  })

  it('刷新只要服务端给的总数', async () => {
    listMock.mockResolvedValue({ items: [], total: 3, page: 1, pageSize: 1 })
    await refreshUnreadTabBadge()
    expect(listMock).toHaveBeenCalledWith({ unreadOnly: 'true', pageSize: 1 })
    expect(calls).toEqual([{ kind: 'set', arg: { index: REMINDER_TAB_INDEX, text: '3' } }])
  })

  it('拉不到未读数就不改屏幕', async () => {
    listMock.mockRejectedValue(new Error('离线'))
    await refreshUnreadTabBadge()
    expect(calls).toEqual([])
  })

  it('并发只问一次：冷启动会同时触发 App 与落地页', async () => {
    let resolveList: (v: unknown) => void = () => {}
    listMock.mockReturnValue(new Promise((r) => { resolveList = r }))
    const twice = Promise.all([refreshUnreadTabBadge(), refreshUnreadTabBadge()])
    resolveList({ items: [], total: 4, page: 1, pageSize: 1 })
    await twice
    expect(listMock).toHaveBeenCalledTimes(1)
    expect(calls).toEqual([{ kind: 'set', arg: { index: REMINDER_TAB_INDEX, text: '4' } }])
  })
})
