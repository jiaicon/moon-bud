/**
 * 离线写入队列的纯决策部分。这里只有类型和"给定一条待同步项 + 一次失败，怎么处置"
 * 这类不碰网络、不碰本地存储的函数——它们能被单测直接钉死，出箱的其余部分
 * （存储读写、真的重发）见 stores/outbox.ts。
 */

export type OutboxOp = 'create' | 'update' | 'delete'

export interface OutboxItem {
  /** 队列条目自己的 id：与 eventId 分开，因为同一件事可能被排两次。 */
  entryId: string
  op: OutboxOp
  familyId: string
  /** create → 客户端预生成的记录 id；update/delete → 服务端已有的记录 id。 */
  eventId: string
  /** create/update 要发的请求体；delete 用不上。原样存着，恢复后照发。 */
  body?: Record<string, unknown>
  /** 入队那一刻（Date.now()）。既用于过期判断，也决定重放顺序。 */
  enqueuedAt: number
  /** 已经因为"确定性错误"重发失败过几次。离线失败不计入——那不是这条记录的错。 */
  attempts: number
}

/**
 * 一条被判定为"重发也不会成"的记录（400/403/409 这类）最多再试几次就丢。
 * 上限的意义是：不把一次坏写入永久卡在队首，也不因为一次抖动（比如服务端短暂 5xx）
 * 就当场把家长记下的东西扔掉。
 */
export const MAX_ATTEMPTS = 8

/** 排了七天还没同步上去的东西，大概率是当时就没登录/家庭没了，继续留着只会被遗忘得越来越远。 */
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export type ReplayStep = 'halt-offline' | 'retry-later' | 'drop'

/**
 * 一次重发**失败**后该怎么走（成功由调用方直接出队，不进这里）。
 * - 网络层没通：说明还离线，后面每一条多半也会同样失败，整趟停下；这条不吃重试额度。
 * - 确定性错误：试够次数或放够时间就丢，否则留着，稍后再来一趟。
 */
export function stepFor(item: OutboxItem, failure: { isNetworkError: boolean }, now: number): ReplayStep {
  if (failure.isNetworkError) return 'halt-offline'
  const usedAfterThis = item.attempts + 1
  if (usedAfterThis >= MAX_ATTEMPTS || now - item.enqueuedAt >= MAX_AGE_MS) return 'drop'
  return 'retry-later'
}

/** 冷启动清队时：这条是否已经老到/烂到该直接扔掉。 */
export function isStale(item: OutboxItem, now: number): boolean {
  return item.attempts >= MAX_ATTEMPTS || now - item.enqueuedAt >= MAX_AGE_MS
}
