import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/endpoints', () => ({
  eventsApi: {
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}))

import { eventsApi } from '../../api/endpoints'
import { ApiRequestError } from '../../api/errors'
import { MAX_ATTEMPTS } from '../../sync/outbox'
import { useOutboxStore } from '../outbox'

const netErr = new ApiRequestError('网络连接失败', 0, true)
const permErr = new ApiRequestError('没有权限这样做', 403, false)

const baseInput = {
  childId: 'ch1',
  type: 'feeding' as const,
  occurredAt: '2026-10-16T02:00:00.000Z',
  payload: { method: 'bottle', amountMl: 120 },
}

function freshStore() {
  uni.removeStorageSync('pendingWrites')
  setActivePinia(createPinia())
  return useOutboxStore()
}

describe('submitCreate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('在线成功：不排队，且发出去的 body 带着一个预生成的 id', async () => {
    const store = freshStore()
    const saved = { id: 'x', ...baseInput }
    ;(eventsApi.create as ReturnType<typeof vi.fn>).mockResolvedValue(saved)
    const res = await store.submitCreate('f1', baseInput)
    expect(res).toEqual({ kind: 'saved', event: saved })
    expect(store.pendingCount).toBe(0)
    const sent = (eventsApi.create as ReturnType<typeof vi.fn>).mock.calls[0][1]
    expect(typeof sent.id).toBe('string')
    expect(sent.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('网络失败：排队一条 create，用的就是刚才发出去那个 id（重放才会命中幂等）', async () => {
    const store = freshStore()
    ;(eventsApi.create as ReturnType<typeof vi.fn>).mockRejectedValue(netErr)
    const res = await store.submitCreate('f1', baseInput)
    expect(res.kind).toBe('queued')
    expect(store.pendingCount).toBe(1)
    const item = store.items[0]
    expect(item.op).toBe('create')
    const sent = (eventsApi.create as ReturnType<typeof vi.fn>).mock.calls[0][1]
    expect(item.eventId).toBe(sent.id) // 排队的 id == 第一次发出去的 id
  })

  it('确定性错误（403）：不排队，原样抛出——重试也不会成', async () => {
    const store = freshStore()
    ;(eventsApi.create as ReturnType<typeof vi.fn>).mockRejectedValue(permErr)
    await expect(store.submitCreate('f1', baseInput)).rejects.toThrow(permErr)
    expect(store.pendingCount).toBe(0)
  })

  it('断网排队的那条带着出处，重放后出处不丢', async () => {
    const store = freshStore()
    ;(eventsApi.create as ReturnType<typeof vi.fn>).mockRejectedValue(netErr)
    const res = await store.submitCreate('f1', { ...baseInput, fromReminderId: 'r-1' })
    expect(res.kind).toBe('queued')
    // 入队的 body 原样带着 fromReminderId，重放时照发——不然断网记的那笔就查不到出处了。
    expect(store.items[0].body?.fromReminderId).toBe('r-1')
  })
})

describe('submitUpdate / submitDelete', () => {
  beforeEach(() => vi.clearAllMocks())

  it('更新网络失败 → 排队 update，重放走 PATCH', async () => {
    const store = freshStore()
    ;(eventsApi.update as ReturnType<typeof vi.fn>).mockRejectedValue(netErr)
    const res = await store.submitUpdate('f1', 'evt9', { note: '改一下' })
    expect(res.kind).toBe('queued')
    expect(store.items[0]).toMatchObject({ op: 'update', eventId: 'evt9' })
    await store.flush()
    expect(eventsApi.update).toHaveBeenCalledWith('f1', 'evt9', { note: '改一下' })
  })

  it('删除网络失败 → 排队 delete，重放走 DELETE', async () => {
    const store = freshStore()
    ;(eventsApi.remove as ReturnType<typeof vi.fn>).mockRejectedValue(netErr)
    const res = await store.submitDelete('f1', 'evt9')
    expect(res.kind).toBe('queued')
    expect(store.items[0]).toMatchObject({ op: 'delete', eventId: 'evt9' })
    await store.flush()
    expect(eventsApi.remove).toHaveBeenCalledWith('f1', 'evt9')
  })
})

describe('flush：按入队顺序重放', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    uni.removeStorageSync('pendingWrites')
    setActivePinia(createPinia())
  })

  it('队首成功就出队，继续下一条', async () => {
    const store = useOutboxStore()
    ;(eventsApi.remove as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
    store.enqueue('delete', 'f1', 'a')
    store.enqueue('delete', 'f1', 'b')
    await store.flush()
    expect(store.pendingCount).toBe(0)
    expect(eventsApi.remove).toHaveBeenCalledTimes(2)
  })

  it('网络失败停在队首：不吃重试额度，后面的不动（还离线）', async () => {
    const store = useOutboxStore()
    ;(eventsApi.remove as ReturnType<typeof vi.fn>).mockRejectedValue(netErr)
    store.enqueue('delete', 'f1', 'a')
    store.enqueue('delete', 'f1', 'b')
    await store.flush()
    expect(store.pendingCount).toBe(2)
    expect(store.items[0].attempts).toBe(0) // 离线不算它的错
    expect(eventsApi.remove).toHaveBeenCalledTimes(1) // 队首失败即停
  })

  it('确定性错误这条试到上限就丢弃，不再挡着后面的', async () => {
    const store = useOutboxStore()
    store.enqueue('delete', 'f1', 'poison')
    store.items[0].attempts = MAX_ATTEMPTS - 1
    store.enqueue('delete', 'f1', 'ok')
    ;(eventsApi.remove as ReturnType<typeof vi.fn>).mockImplementation((_f, id) =>
      id === 'poison' ? Promise.reject(permErr) : Promise.resolve())
    await store.flush()
    expect(store.pendingCount).toBe(0)
    // 队首那条被丢掉后，这一趟继续把后面的同步了上去——坏条目不再永久卡住整条队列。
    expect(eventsApi.remove).toHaveBeenLastCalledWith('f1', 'ok')
  })
})

describe('持久化 + 冷启动清队', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    uni.removeStorageSync('pendingWrites')
    setActivePinia(createPinia())
  })

  it('入队即落本地；另一个 store 实例 load 能读回', () => {
    const store = useOutboxStore()
    store.enqueue('create', 'f1', 'c1', baseInput)
    setActivePinia(createPinia())
    const again = useOutboxStore()
    again.load()
    expect(again.pendingCount).toBe(1)
    expect(again.items[0].eventId).toBe('c1')
  })

  it('load 丢掉已经老化的条目并写回', () => {
    uni.setStorageSync('pendingWrites', [
      { entryId: 'e', op: 'delete', familyId: 'f1', eventId: 'old', enqueuedAt: 1, attempts: 0 },
    ])
    const store = useOutboxStore()
    store.load()
    expect(store.pendingCount).toBe(0)
  })
})
