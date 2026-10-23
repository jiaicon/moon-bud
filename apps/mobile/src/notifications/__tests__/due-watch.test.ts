import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotificationDto } from '@moonbud/shared'

const listMock = vi.hoisted(() => vi.fn())
const markReadMock = vi.hoisted(() => vi.fn())
const submitCreateMock = vi.hoisted(() => vi.fn())
const navMock = vi.hoisted(() => vi.fn())
vi.mock('../../api/endpoints', () => ({
  notificationsApi: { list: listMock, markRead: markReadMock },
}))
// 弹框点下去要走 quick-record 那一整套（出箱、标已读、刷角标），这里只把它的外围换成假的，
// 判定本身必须是真的 —— 否则"单条带动作才给记一笔"这条规矩就没人验。
vi.mock('../../stores/outbox', () => ({ useOutboxStore: () => ({ submitCreate: submitCreateMock }) }))
vi.mock('../tab-badge', () => ({ refreshUnreadTabBadge: vi.fn() }))

const { planDueWatch, dueWatchMessage, startDueWatch, stopDueWatch, resetDueWatch } =
  await import('../due-watch')

function notify(
  id: string,
  opts: { occurrence?: string | null; title?: string; action?: NotificationDto['action'] } = {},
): NotificationDto {
  return {
    id,
    userId: 'u-1',
    familyId: 'f-1',
    occurrenceId: opts.occurrence === undefined ? `occ-${id}` : opts.occurrence,
    title: opts.title ?? '喂奶',
    body: '',
    readAt: null,
    createdAt: '2026-10-19T09:00:00.000Z',
    // 这些用例只管"什么时候该弹"，动作由"三个样子"那批用例自己造。
    action: opts.action ?? null,
  }
}

interface ModalCall {
  title?: string
  content?: string
  showCancel?: boolean
  confirmText?: string
  cancelText?: string
  success?: (res: { confirm: boolean; cancel: boolean }) => void
  complete?: () => void
}

const modals: ModalCall[] = []
const g = globalThis as Record<string, any>
let restore: (() => void) | null = null

/** 弹窗要人点才关：测试里手动补上那一下点击。 */
function tapConfirm(): void {
  const last = modals[modals.length - 1]
  last?.success?.({ confirm: true, cancel: false })
  last?.complete?.()
}

function tapCancel(): void {
  const last = modals[modals.length - 1]
  last?.success?.({ confirm: false, cancel: true })
  last?.complete?.()
}

beforeEach(() => {
  modals.length = 0
  listMock.mockReset()
  const before = g.uni
  g.uni = {
    ...before,
    showModal: (arg: ModalCall) => modals.push(arg),
  }
  restore = () => {
    g.uni = before
  }
  resetDueWatch()
})
afterEach(() => {
  restore?.()
  resetDueWatch()
  vi.useRealTimers()
})

describe('planDueWatch：哪些未读通知值得在屏幕上弹一下', () => {
  it('第一次只记底，一条都不弹：冷启动时攒下的旧通知不该一起炸出来', () => {
    const plan = planDueWatch([notify('n-1'), notify('n-2')], null)
    expect(plan.surface).toEqual([])
    expect(plan.seen).toEqual(['n-1', 'n-2'])
  })

  it('这一轮新冒出来的到点提醒才被挑出来', () => {
    const plan = planDueWatch([notify('n-2'), notify('n-1')], ['n-1'])
    expect(plan.surface.map((n) => n.id)).toEqual(['n-2'])
    expect(plan.seen).toEqual(['n-1', 'n-2'])
  })

  it('已经弹过的不再弹第二遍', () => {
    const plan = planDueWatch([notify('n-1')], ['n-1'])
    expect(plan.surface).toEqual([])
  })

  it('入家申请这类没有 occurrenceId 的通知不归这里管', () => {
    const join = notify('n-9', { occurrence: null })
    const plan = planDueWatch([join, notify('n-1')], null)
    expect(plan.surface).toEqual([])
    expect(plan.seen).toEqual(['n-1'])
    expect(plan.seen).not.toContain('n-9')
  })

  it('记底不会越攒越多：只留最近见过的 200 条', () => {
    const many = Array.from({ length: 250 }, (_, i) => notify(`n-${i}`))
    const plan = planDueWatch(many, null)
    expect(plan.seen).toHaveLength(200)
    expect(plan.seen.at(-1)).toBe('n-249')
  })
})

describe('dueWatchMessage：弹出来的那句话', () => {
  it('一条就把它的名字念出来', () => {
    expect(dueWatchMessage([notify('n-1', { title: '夜里喂奶' })])).toBe('到点了：夜里喂奶')
  })

  it('几条只报数：toast 窄，念不下一串名字', () => {
    expect(dueWatchMessage([notify('n-1'), notify('n-2'), notify('n-3')])).toBe('3 条提醒到点')
  })
})

describe('轮询的那层壳', () => {
  it('启动先问一次，之后每分钟问一次；停止就不再问', async () => {
    vi.useFakeTimers()
    listMock.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 })
    startDueWatch()
    await vi.advanceTimersByTimeAsync(0)
    expect(listMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(listMock).toHaveBeenCalledTimes(2)

    stopDueWatch()
    await vi.advanceTimersByTimeAsync(180_000)
    expect(listMock).toHaveBeenCalledTimes(2)
  })

  it('重复启动只有一条轮询：回前台会被连着触发好几次', async () => {
    vi.useFakeTimers()
    listMock.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 })
    startDueWatch()
    startDueWatch()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(listMock).toHaveBeenCalledTimes(2)
  })

  it('新到点的那条会真的弹出来', async () => {
    vi.useFakeTimers()
    listMock.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 })
    startDueWatch()
    await vi.advanceTimersByTimeAsync(0)
    expect(modals).toEqual([])

    listMock.mockResolvedValue({ items: [notify('n-1', { title: '吃辅食' })], total: 1, page: 1, pageSize: 20 })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(modals.map((m) => m.content)).toEqual(['到点了：吃辅食'])
  })

  it('弹的是要人点一下才关的模态框：没有取消键', async () => {
    vi.useFakeTimers()
    listMock.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 })
    startDueWatch()
    await vi.advanceTimersByTimeAsync(0)

    listMock.mockResolvedValue({ items: [notify('n-1')], total: 1, page: 1, pageSize: 20 })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(modals).toHaveLength(1)
    expect(modals[0].showCancel).toBe(false)
    expect(modals[0].confirmText).toBe('知道了')
  })

  it('上一个还没点掉时不叠第二个，新到点的那条留到下一轮再弹', async () => {
    vi.useFakeTimers()
    listMock.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 })
    startDueWatch()
    await vi.advanceTimersByTimeAsync(0)

    listMock.mockResolvedValue({ items: [notify('n-1')], total: 1, page: 1, pageSize: 20 })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(modals).toHaveLength(1)

    listMock.mockResolvedValue({ items: [notify('n-1'), notify('n-2', { title: '洗澡' })], total: 2, page: 1, pageSize: 20 })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(modals).toHaveLength(1)

    tapConfirm()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(modals.map((m) => m.content)).toEqual(['到点了：喂奶', '到点了：洗澡'])

    await vi.advanceTimersByTimeAsync(60_000)
    expect(modals).toHaveLength(2)
  })

  it('弹过的不会在下一次轮询里重弹', async () => {
    vi.useFakeTimers()
    listMock.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 })
    startDueWatch()
    await vi.advanceTimersByTimeAsync(0)

    listMock.mockResolvedValue({ items: [notify('n-1')], total: 1, page: 1, pageSize: 20 })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(modals).toHaveLength(1)
    tapConfirm()

    await vi.advanceTimersByTimeAsync(120_000)
    expect(modals).toHaveLength(1)
  })

  it('拉不到就当这轮没发生：既不弹，也不把见过的当作弹过', async () => {
    vi.useFakeTimers()
    listMock.mockRejectedValue(new Error('离线'))
    startDueWatch()
    await vi.advanceTimersByTimeAsync(0)
    expect(modals).toEqual([])

    listMock.mockResolvedValue({ items: [notify('n-1')], total: 1, page: 1, pageSize: 20 })
    await vi.advanceTimersByTimeAsync(60_000)
    // 上一轮没读到，这一轮仍是"第一次"，只记底不弹——离线期间攒下的不该一起炸出来。
    expect(modals).toEqual([])

    listMock.mockResolvedValue({ items: [notify('n-1'), notify('n-2', { title: '洗澡' })], total: 2, page: 1, pageSize: 20 })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(modals.map((m) => m.content)).toEqual(['到点了：洗澡'])
  })

  it('退出登录后复位：换账号不该把上一家的人看到的进度带过来', async () => {
    vi.useFakeTimers()
    listMock.mockResolvedValue({ items: [notify('n-1')], total: 1, page: 1, pageSize: 20 })
    startDueWatch()
    await vi.advanceTimersByTimeAsync(0)
    expect(listMock).toHaveBeenCalledTimes(1)

    resetDueWatch()
    await vi.advanceTimersByTimeAsync(180_000)
    expect(listMock).toHaveBeenCalledTimes(1)
    expect(modals).toEqual([])
  })
})

describe('到点弹框的三个样子', () => {
  const action = {
    reminderId: 'r-1',
    childId: 'c-1',
    eventType: 'medicine' as const,
    payload: { name: '维D', dose: '400IU' },
  }

  beforeEach(() => {
    submitCreateMock.mockReset()
    markReadMock.mockReset()
    navMock.mockReset()
    g.uni = { ...g.uni, navigateTo: navMock }
  })

  /** 走到弹框、拿到最近那一个框的配置。 */
  async function popUp(items: NotificationDto[]) {
    vi.useFakeTimers()
    listMock.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 })
    startDueWatch()
    await vi.advanceTimersByTimeAsync(0)
    listMock.mockResolvedValue({ items, total: items.length, page: 1, pageSize: 20 })
    await vi.advanceTimersByTimeAsync(60_000)
    return modals[modals.length - 1]
  }

  it('单条带动作的到点：确认按钮是"记一笔"，点它就写库', async () => {
    submitCreateMock.mockResolvedValue({ kind: 'saved', event: { id: 'e-1' } })
    markReadMock.mockResolvedValue(notify('n-1', { action }))
    const modal = await popUp([notify('n-1', { title: '吃维D', action })])

    expect(modal.confirmText).toBe('记一笔')
    expect(modal.cancelText).toBe('知道了')
    expect(modal.showCancel).toBe(true)

    tapConfirm()
    await vi.advanceTimersByTimeAsync(0)
    expect(submitCreateMock).toHaveBeenCalledWith('f-1', {
      childId: 'c-1',
      type: 'medicine',
      occurredAt: expect.any(String),
      payload: { name: '维D', dose: '400IU' },
      fromReminderId: 'r-1',
      note: null,
    })
    expect(markReadMock).toHaveBeenCalledWith('n-1')
  })

  it('点"知道了"（取消）不写库、不标已读，弹框状态照常复位', async () => {
    const item = notify('n-1', { title: '吃维D', action })
    const modal = await popUp([item])
    expect(modal.showCancel).toBe(true)

    tapCancel()
    await vi.advanceTimersByTimeAsync(0)
    expect(submitCreateMock).not.toHaveBeenCalled()
    expect(markReadMock).not.toHaveBeenCalled()

    // 框点掉了（alertOpen 复位），下一条到点照样能弹。
    const next = notify('n-2', { title: '洗澡' })
    listMock.mockResolvedValue({ items: [item, next], total: 2, page: 1, pageSize: 20 })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(modals.map((m) => m.content)).toEqual(['到点了：吃维D', '到点了：洗澡'])
  })

  it('单条只带类型的到点：确认按钮是"去记一笔"，点了跳表单', async () => {
    const modal = await popUp([notify('n-1', { action: { ...action, payload: null } })])
    expect(modal.confirmText).toBe('去记一笔')

    tapConfirm()
    await vi.advanceTimersByTimeAsync(0)
    expect(navMock).toHaveBeenCalledWith({
      url: '/pages/event-form/index?type=medicine&childId=c-1&familyId=f-1&reminderId=r-1',
    })
    expect(submitCreateMock).not.toHaveBeenCalled()
  })

  it('多条到点仍然只有一个"知道了"', async () => {
    const modal = await popUp([
      notify('n-1', { title: '吃维D', action }),
      notify('n-2', { title: '洗澡', action: { ...action, reminderId: 'r-2' } }),
    ])
    expect(modal.content).toBe('2 条提醒到点')
    expect(modal.showCancel).toBe(false)
    expect(modal.confirmText).toBe('知道了')

    tapConfirm()
    await vi.advanceTimersByTimeAsync(0)
    expect(submitCreateMock).not.toHaveBeenCalled()
  })

  it('无动作的单条保持今天的样子', async () => {
    const modal = await popUp([notify('n-1', { title: '吃维D' })])
    expect(modal.showCancel).toBe(false)
    expect(modal.confirmText).toBe('知道了')
  })
})
