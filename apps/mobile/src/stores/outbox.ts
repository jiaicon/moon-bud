import { defineStore } from 'pinia'
import type { EventDto } from '@moonbud/shared'
import { ApiRequestError } from '../api/errors'
import { eventsApi, type EventCreateInput } from '../api/endpoints'
import { uuidV4 } from '../sync/uuid'
import { isStale, stepFor, type OutboxItem, type OutboxOp } from '../sync/outbox'

const OUTBOX_KEY = 'pendingWrites'

/** submit* 的统一返回：分清了"已经存到服务端"和"只落到本机待同步"，界面才不会说反话。 */
export type SubmitResult =
  | { kind: 'saved'; event?: EventDto }
  | { kind: 'queued'; clientEventId?: string }

function isNetworkError(err: unknown): boolean {
  return err instanceof ApiRequestError && err.isNetworkError
}

/** 只认形状齐整的条目：脏存储里缺字段的垃圾不能让重放炸在半路。 */
function sanitize(raw: unknown): OutboxItem[] {
  if (!Array.isArray(raw)) return []
  const out: OutboxItem[] = []
  for (const value of raw) {
    if (!value || typeof value !== 'object') continue
    const it = value as Record<string, unknown>
    const op = it.op
    if (op !== 'create' && op !== 'update' && op !== 'delete') continue
    if (typeof it.entryId !== 'string' || typeof it.familyId !== 'string' || typeof it.eventId !== 'string') continue
    if (typeof it.enqueuedAt !== 'number') continue
    out.push({
      entryId: it.entryId,
      op: op as OutboxOp,
      familyId: it.familyId,
      eventId: it.eventId,
      body: (it.body ?? undefined) as Record<string, unknown> | undefined,
      enqueuedAt: it.enqueuedAt,
      attempts: typeof it.attempts === 'number' ? it.attempts : 0,
    })
  }
  return out
}

export const useOutboxStore = defineStore('outbox', {
  state: () => ({
    items: [] as OutboxItem[],
    flushing: false,
    loaded: false,
  }),

  getters: {
    pendingCount: (s) => s.items.length,
  },

  actions: {
    /** 冷启动或首次用到时把本地队列读回来，顺手丢掉已经老化的。 */
    load(): void {
      if (this.loaded) return
      const now = Date.now()
      this.items = sanitize(uni.getStorageSync(OUTBOX_KEY)).filter((it) => !isStale(it, now))
      this.persist()
      this.loaded = true
    },

    persist(): void {
      uni.setStorageSync(OUTBOX_KEY, this.items)
    },

    enqueue(op: OutboxOp, familyId: string, eventId: string, body?: Record<string, unknown>): void {
      this.load()
      this.items.push({
        entryId: uuidV4(),
        op,
        familyId,
        eventId,
        body,
        enqueuedAt: Date.now(),
        attempts: 0,
      })
      this.persist()
    },

    removeEntry(entryId: string): void {
      this.items = this.items.filter((i) => i.entryId !== entryId)
      this.persist()
    },

    /**
     * 新建一条记录。id 在发第一趟之前就生成好：万一这一趟其实已经写进库、只是响应没回来，
     * 待同步重放带的还是同一个 id，后端幂等分支会原样返回那条而不是补出第二条。
     */
    async submitCreate(familyId: string, input: EventCreateInput): Promise<SubmitResult> {
      this.load()
      const clientEventId = uuidV4()
      const body: EventCreateInput = { id: clientEventId, ...input }
      try {
        return { kind: 'saved', event: await eventsApi.create(familyId, body) }
      } catch (err) {
        if (!isNetworkError(err)) throw err
        this.enqueue('create', familyId, clientEventId, body as unknown as Record<string, unknown>)
        return { kind: 'queued', clientEventId }
      }
    },

    /** 更新与删除按服务端已有的 id 走，本身就是幂等的，重放安全。 */
    async submitUpdate(
      familyId: string,
      eventId: string,
      input: Partial<Omit<EventCreateInput, 'childId'>>,
    ): Promise<SubmitResult> {
      this.load()
      try {
        return { kind: 'saved', event: await eventsApi.update(familyId, eventId, input) }
      } catch (err) {
        if (!isNetworkError(err)) throw err
        this.enqueue('update', familyId, eventId, input as Record<string, unknown>)
        return { kind: 'queued' }
      }
    },

    async submitDelete(familyId: string, eventId: string): Promise<SubmitResult> {
      this.load()
      try {
        await eventsApi.remove(familyId, eventId)
        return { kind: 'saved' }
      } catch (err) {
        if (!isNetworkError(err)) throw err
        this.enqueue('delete', familyId, eventId)
        return { kind: 'queued' }
      }
    },

    /**
     * 按入队顺序重放（FIFO）：同一件事的创建必须先于它的更新/删除落地，顺序不能乱。
     * 队首一旦没成功就停下整趟——离线就整趟等下次，永久性错误则累计次数、到上限丢弃，
     * 免得一条坏写入把后面全家的记录永久卡住。
     */
    async flush(): Promise<void> {
      this.load()
      if (this.flushing || this.items.length === 0) return
      this.flushing = true
      try {
        // 遍历快照：循环里会改 this.items。
        for (const item of [...this.items]) {
          try {
            await this.replay(item)
            this.removeEntry(item.entryId)
          } catch (err) {
            const step = stepFor(item, { isNetworkError: isNetworkError(err) }, Date.now())
            if (step === 'drop') {
              this.removeEntry(item.entryId)
              uni.showToast({ title: '有一条记录一直没同步上，已放弃', icon: 'none' })
              continue
            }
            if (step === 'retry-later') {
              const live = this.items.find((i) => i.entryId === item.entryId)
              if (live) {
                live.attempts += 1
                this.persist()
              }
            }
            // halt-offline 与 retry-later 都停在这：后面的不再往下推。
            break
          }
        }
      } finally {
        this.flushing = false
      }
    },

    async replay(item: OutboxItem): Promise<void> {
      if (item.op === 'create') {
        await eventsApi.create(item.familyId, item.body as unknown as EventCreateInput)
      } else if (item.op === 'update') {
        await eventsApi.update(item.familyId, item.eventId, item.body as unknown as Partial<Omit<EventCreateInput, 'childId'>>)
      } else {
        await eventsApi.remove(item.familyId, item.eventId)
      }
    },

    /** 退出登录：待同步属于上一个账号，留下会让下一个人在自己手机上看到别人的"待上传"。 */
    clear(): void {
      this.items = []
      this.loaded = false
      this.persist()
    },
  },
})
