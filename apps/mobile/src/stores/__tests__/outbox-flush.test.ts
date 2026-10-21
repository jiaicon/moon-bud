import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ApiRequestError } from '../../api/errors'
import { useOutboxStore } from '../outbox'
import { MAX_ATTEMPTS, type OutboxItem } from '../../sync/outbox'

const uniAny = uni as unknown as {
  showToast: (o: { title: string }) => void
  setStorageSync: (key: string, value: unknown) => void
}
const originalToast = uniAny.showToast
const originalSetStorageSync = uniAny.setStorageSync

function item(over: Partial<OutboxItem> = {}): OutboxItem {
  return {
    entryId: 'e1',
    op: 'create',
    familyId: 'f1',
    eventId: 'c1',
    body: { childId: 'ch1', type: 'feeding', occurredAt: '2026-10-16T02:00:00.000Z', payload: {} },
    enqueuedAt: Date.now(),
    attempts: 0,
    ...over,
  }
}

const toasts: string[] = []

/**
 * 待同步是家长在没网的时候记下的东西。有两种失败会把它吃掉而家长不会知道：
 * 1) 会话过期时的 401 被当成"这条记录自己的错"累计次数——回前台八次之后，
 *    这个人一次也没登录成过，记录却已经被丢了；
 * 2) 本地存储写不下去（配额、隐私模式）时落盘直接抛，"记一笔"点下去是一片死寂，
 *    那条东西既没上传也没落下。
 */
describe('待同步的重放策略', () => {
  let store: ReturnType<typeof useOutboxStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useOutboxStore()
    store.loaded = true
    toasts.length = 0
    uniAny.showToast = (o) => toasts.push(o.title)
    uniAny.setStorageSync = originalSetStorageSync
  })

  afterEach(() => {
    uniAny.showToast = originalToast
    uniAny.setStorageSync = originalSetStorageSync
  })

  it('401 是这台手机的会话坏了：停在这条，次数原样留着，后面的也不往后推', async () => {
    store.items = [item({ entryId: 'e1' }), item({ entryId: 'e2' })]
    const replay = vi
      .spyOn(store, 'replay')
      .mockRejectedValue(new ApiRequestError('登录已过期，请重新登录', 401, false))

    await store.flush()

    expect(replay).toHaveBeenCalledTimes(1)
    expect(store.items.map((i) => i.entryId)).toEqual(['e1', 'e2'])
    expect(store.items[0]?.attempts).toBe(0)
  })

  it('400 是这条记录自己的错：照旧累计次数，留着稍后再来一趟', async () => {
    store.items = [item()]
    vi.spyOn(store, 'replay').mockRejectedValue(new ApiRequestError('请求的内容有问题，请检查后重试', 400, false))

    await store.flush()

    expect(store.items[0]?.attempts).toBe(1)
  })

  it('一条 400 试到上限：丢掉并说一声，不让它永久挡住后面的', async () => {
    store.items = [item({ attempts: MAX_ATTEMPTS - 1 })]
    vi.spyOn(store, 'replay').mockRejectedValue(new ApiRequestError('请求的内容有问题，请检查后重试', 400, false))

    await store.flush()

    expect(store.items).toEqual([])
    expect(toasts.join('')).toContain('已放弃')
  })

  it('本地存不下去：入队照样成，队列留在内存里，并且只说一次', () => {
    uniAny.setStorageSync = () => {
      throw new Error('quota exceeded')
    }

    expect(() => store.enqueue('create', 'f1', 'c1', { childId: 'ch1' })).not.toThrow()
    expect(store.items).toHaveLength(1)
    expect(toasts).toHaveLength(1)

    expect(() => store.enqueue('create', 'f1', 'c2', { childId: 'ch1' })).not.toThrow()
    expect(store.items).toHaveLength(2)
    expect(toasts).toHaveLength(1)
  })

  it('落盘成功时一句废话都没有', () => {
    store.enqueue('create', 'f1', 'c1', { childId: 'ch1' })

    expect(toasts).toEqual([])
  })
})
