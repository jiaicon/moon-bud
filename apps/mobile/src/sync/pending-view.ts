import type { EventDto, EventPayload, EventType } from '@moonbud/shared'
import type { OutboxItem } from './outbox'

/** 待同步的创建要写成"谁记的"——本地这条还没经过服务端，记人只能是当前账号自己。 */
export interface SessionMeta {
  userId: string
  nickname: string
}

/** 一条待同步创建的请求体（表单发出去的那个形状）。 */
interface CreateBody {
  childId?: unknown
  type?: unknown
  occurredAt?: unknown
  endedAt?: unknown
  payload?: unknown
  note?: unknown
}

/**
 * 待同步的创建投影成列表能直接用的 EventDto：id 用客户端预生成的那个，
 * 所以它一旦上传成功、服务端回来的还是同一个 id，列表刷新时不会闪出两条。
 * 脏数据（缺 childId/type/occurredAt）跳过——宁可少画一行，也不画出一条空记录。
 */
export function pendingCreateRows(items: OutboxItem[], familyId: string, meta: SessionMeta): EventDto[] {
  const rows: EventDto[] = []
  for (const item of items) {
    if (item.op !== 'create' || item.familyId !== familyId) continue
    const b = (item.body ?? {}) as CreateBody
    const childId = b.childId
    const type = b.type
    const occurredAt = b.occurredAt
    if (typeof childId !== 'string' || !childId) continue
    if (typeof type !== 'string' || !type) continue
    if (typeof occurredAt !== 'string' || !occurredAt) continue
    rows.push({
      id: item.eventId,
      childId,
      familyId,
      type: type as EventType,
      occurredAt,
      endedAt: typeof b.endedAt === 'string' ? b.endedAt : null,
      payload: (b.payload ?? {}) as EventPayload,
      note: typeof b.note === 'string' ? b.note : null,
      createdBy: meta.userId,
      createdByNickname: meta.nickname,
      updatedBy: null,
      createdAt: new Date(item.enqueuedAt).toISOString(),
      updatedAt: new Date(item.enqueuedAt).toISOString(),
    })
  }
  return rows
}

/**
 * 待同步的删除：这些是服务端已有、只是"删它这个动作还没传上去"的记录 id。
 * 列表要先把它们藏起来，否则刚点完删除、它还在眼前，等于界面在撒谎。
 */
export function pendingDeletedIds(items: OutboxItem[], familyId: string): Set<string> {
  const ids = new Set<string>()
  for (const item of items) {
    if (item.op === 'delete' && item.familyId === familyId) ids.add(item.eventId)
  }
  return ids
}

/** 一条待同步编辑的请求体（PATCH 形状：没带的字段表示"不改"）。 */
interface UpdateBody {
  type?: unknown
  occurredAt?: unknown
  endedAt?: unknown
  payload?: unknown
  note?: unknown
}

/**
 * 把出箱里还没传上去的编辑盖到已有的行上，让界面显示"用户刚填的那个样子"。
 * 不这么做的话，改完奶量点保存、列表跳回旧数字，等于界面在撒谎。
 * childId 不在这里合并：换孩子走的是另一条路（事件属于孩子），服务端 DTO 也不吃它。
 * 返回新数组/新对象——手上这份原始响应是上一次读到的，不该被原地改掉。
 */
export function applyPendingUpdates(rows: EventDto[], items: OutboxItem[], familyId: string): EventDto[] {
  // 同一条可能被改了好几趟，按出箱顺序（FIFO）把 PATCH 叠成一份，后写的盖住先写的。
  const pending = new Map<string, UpdateBody>()
  for (const item of items) {
    if (item.op !== 'update' || item.familyId !== familyId) continue
    const body = (item.body ?? {}) as UpdateBody
    pending.set(item.eventId, { ...pending.get(item.eventId), ...body })
  }
  if (!pending.size) return rows
  return rows.map((row) => {
    const body = pending.get(row.id)
    if (!body) return row
    const next: EventDto = { ...row }
    if (typeof body.type === 'string' && body.type) next.type = body.type as EventType
    if (typeof body.occurredAt === 'string' && body.occurredAt) next.occurredAt = body.occurredAt
    // 只有请求体里出现了这个 key 才动它：没带＝不改，带了 null＝清掉。
    if ('endedAt' in body) next.endedAt = typeof body.endedAt === 'string' ? body.endedAt : null
    if ('payload' in body) next.payload = (body.payload ?? {}) as EventPayload
    if ('note' in body) next.note = typeof body.note === 'string' && body.note ? body.note : null
    return next
  })
}

export interface RowFilters {
  type?: EventType | ''
  childId?: string
  createdBy?: string
  from?: string
  to?: string
}

/** 时间戳比较，不靠 ISO 串字典序：两端偏移一致时才碰巧对，显式比时刻才稳。 */
function inBounds(occurredAt: string, from?: string, to?: string): boolean {
  const at = new Date(occurredAt).getTime()
  if (Number.isNaN(at)) return true
  if (from && at < new Date(from).getTime()) return false
  if (to && at > new Date(to).getTime()) return false
  return true
}

/**
 * 待同行套上和列表一样的筛项。筛"爷爷 + 喂奶"时冒出一条待同步的睡眠，
 * 用户会以为自己筛错了——待同步是状态，不是免检通行证。
 */
export function filterRows(rows: EventDto[], f: RowFilters): EventDto[] {
  return rows.filter((r) => {
    if (f.type && r.type !== f.type) return false
    if (f.childId && r.childId !== f.childId) return false
    if (f.createdBy && r.createdBy !== f.createdBy) return false
    return inBounds(r.occurredAt, f.from, f.to)
  })
}
