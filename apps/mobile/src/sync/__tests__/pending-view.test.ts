import { describe, expect, it } from 'vitest'
import type { EventDto } from '@moonbud/shared'
import {
  applyPendingUpdates,
  filterRows,
  mergePendingRows,
  pendingCreateRows,
  pendingDeletedIds,
} from '../pending-view'
import type { OutboxItem } from '../outbox'

function create(over: Partial<OutboxItem> = {}): OutboxItem {
  return {
    entryId: `en-${Math.random()}`,
    op: 'create',
    familyId: 'f1',
    eventId: 'client-uuid-1',
    body: {
      childId: 'ch1',
      type: 'feeding',
      occurredAt: '2026-10-16T02:00:00.000Z',
      payload: { method: 'bottle', amountMl: 120 },
      note: '喝得很快',
    },
    enqueuedAt: 1_700_000_000_000,
    attempts: 0,
    ...over,
  }
}

const meta = { userId: 'me', nickname: '妈妈' }

describe('pendingCreateRows：待同步的创建投影成列表能用的行', () => {
  it('带上客户端 id、类型/内容/备注原样，记人写自己、并标成待同步的形状', () => {
    const rows = pendingCreateRows([create()], 'f1', meta)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('client-uuid-1')
    expect(rows[0].type).toBe('feeding')
    expect(rows[0].payload).toEqual({ method: 'bottle', amountMl: 120 })
    expect(rows[0].note).toBe('喝得很快')
    expect(rows[0].createdBy).toBe('me')
    expect(rows[0].createdByNickname).toBe('妈妈')
    expect(rows[0].endedAt).toBeNull()
  })

  it('只管本家庭，删除项与非本家庭创建都跳过', () => {
    const items = [
      create(),
      create({ familyId: 'other' }),
      create({ op: 'delete', eventId: 'srv-1', body: undefined }),
    ]
    expect(pendingCreateRows(items, 'f1', meta).map((r) => r.id)).toEqual(['client-uuid-1'])
  })

  it('缺关键字段（脏存储）的行直接丢，不渲染出一条空记录', () => {
    const bad = create({ body: { childId: '', type: 'feeding' } })
    expect(pendingCreateRows([bad], 'f1', meta)).toEqual([])
  })
})

describe('pendingDeletedIds：待同步的删除要先藏起来', () => {
  it('只收本家庭的删除项 id', () => {
    const items = [
      create({ op: 'delete', eventId: 'd1', body: undefined }),
      create({ op: 'delete', eventId: 'd2', familyId: 'other', body: undefined }),
      create(),
    ]
    expect([...pendingDeletedIds(items, 'f1')].sort()).toEqual(['d1'])
  })
})

describe('applyPendingUpdates：待同步的编辑要让行显示成用户刚填的样子', () => {
  const server = (over: Record<string, unknown> = {}) =>
    ({
      id: 'srv-1',
      childId: 'ch1',
      familyId: 'f1',
      type: 'feeding',
      occurredAt: '2026-10-16T02:00:00.000Z',
      endedAt: null,
      payload: { method: 'bottle', amountMl: 120 },
      note: '旧的',
      createdBy: 'u9',
      createdByNickname: '爸爸',
      updatedBy: null,
      createdAt: '2026-10-16T02:00:00.000Z',
      updatedAt: '2026-10-16T02:00:00.000Z',
      ...over,
    }) as unknown as EventDto

  const update = (body: Record<string, unknown>, over: Partial<OutboxItem> = {}) =>
    create({ op: 'update', eventId: 'srv-1', body, ...over })

  it('本家庭的编辑覆盖对应行：改了奶量就在图上/列表里看到改后的数', () => {
    const rows = applyPendingUpdates([server()], [update({ payload: { method: 'bottle', amountMl: 90 } })], 'f1')
    expect(rows[0].payload).toEqual({ method: 'bottle', amountMl: 90 })
    expect(rows[0].note).toBe('旧的')
  })

  it('body 没带的字段保留服务器值（PATCH 语义，不能拿 undefined 抹掉）', () => {
    const rows = applyPendingUpdates([server()], [update({ occurredAt: '2026-10-16T05:00:00.000Z' })], 'f1')
    expect(rows[0].occurredAt).toBe('2026-10-16T05:00:00.000Z')
    expect(rows[0].payload).toEqual({ method: 'bottle', amountMl: 120 })
    expect(rows[0].type).toBe('feeding')
  })

  it('显式清空的字段（note/endedAt 传 null）要跟着清，不能留着旧值', () => {
    const rows = applyPendingUpdates([server({ endedAt: '2026-10-16T03:00:00.000Z' })], [update({ note: null, endedAt: null })], 'f1')
    expect(rows[0].note).toBeNull()
    expect(rows[0].endedAt).toBeNull()
  })

  it('认不出的 eventId 不凭空造行；别的家庭、创建与删除项都不参与', () => {
    const rows = applyPendingUpdates(
      [server(), server({ id: 'srv-2' })],
      [
        update({ payload: { method: 'bottle', amountMl: 1 } }, { familyId: 'other' }),
        create({ body: { childId: 'ch1', type: 'feeding', occurredAt: '2026-10-16T02:00:00.000Z' } }),
        update({ type: 'diaper' }, { eventId: 'not-in-hand' }),
      ],
      'f1',
    )
    expect(rows).toHaveLength(2)
    expect(rows[0].type).toBe('feeding')
  })

  it('不改写入参：出箱里的编辑不该把上一次读到的原始响应原地改掉', () => {
    const input = [server()]
    applyPendingUpdates(input, [update({ note: '新备注' })], 'f1')
    expect(input[0].note).toBe('旧的')
  })
})

describe('filterRows：待同行也要尊重当前筛项，否则筛"爷爷+喂奶"却冒出别的', () => {
  const rows = pendingCreateRows(
    [
      create({ eventId: 'a' }),
      create({ eventId: 'b', body: { childId: 'ch2', type: 'sleep', occurredAt: '2026-10-16T03:00:00.000Z', payload: {} } }),
    ],
    'f1',
    meta,
  )

  it('不筛时两条都在', () => {
    expect(filterRows(rows, {}).map((r) => r.id)).toEqual(['a', 'b'])
  })
  it('按类型筛', () => {
    expect(filterRows(rows, { type: 'feeding' }).map((r) => r.id)).toEqual(['a'])
  })
  it('按孩子筛', () => {
    expect(filterRows(rows, { childId: 'ch2' }).map((r) => r.id)).toEqual(['b'])
  })
  it('按时间区间筛（用 Date 比，不靠字典序）', () => {
    const kept = filterRows(rows, { from: '2026-10-16T02:30:00.000Z', to: undefined })
    expect(kept.map((r) => r.id)).toEqual(['b'])
  })
})

describe('mergePendingRows：首页概览要和记录页数同一份数据', () => {
  const srv = (over: Record<string, unknown> = {}) =>
    ({
      id: 'srv-1',
      childId: 'ch1',
      familyId: 'f1',
      type: 'feeding',
      occurredAt: '2026-10-16T02:00:00.000Z',
      endedAt: null,
      payload: { method: 'bottle', amountMl: 120 },
      note: null,
      createdBy: 'u9',
      createdByNickname: '爸爸',
      updatedBy: null,
      createdAt: '2026-10-16T02:00:00.000Z',
      updatedAt: '2026-10-16T02:00:00.000Z',
      ...over,
    }) as unknown as EventDto

  it('断网记下的一顿奶，首页当天就要数到它', () => {
    const rows = mergePendingRows([srv()], [create()], 'f1', meta)
    expect(rows.map((r) => r.id)).toEqual(['client-uuid-1', 'srv-1'])
  })

  it('服务端已经有同一个 id 时只算一次：重放写成了、条目还没落下', () => {
    const rows = mergePendingRows(
      [srv({ id: 'client-uuid-1' })],
      [create()],
      'f1',
      meta,
    )
    expect(rows.map((r) => r.id)).toEqual(['client-uuid-1'])
  })

  it('本机已判定要删的、还没传上去的那条要藏起来', () => {
    const rows = mergePendingRows(
      [srv()],
      [create({ op: 'delete', eventId: 'srv-1', body: undefined })],
      'f1',
      meta,
    )
    expect(rows).toEqual([])
  })

  it('待同步的编辑盖到服务端行上，概览念的是用户刚填的数', () => {
    const rows = mergePendingRows(
      [srv()],
      [create({ op: 'update', eventId: 'srv-1', body: { payload: { amountMl: 90 } } })],
      'f1',
      meta,
    )
    expect(rows[0].payload).toEqual({ amountMl: 90 })
  })

  it('别的家庭的出箱条目不动这一家', () => {
    const rows = mergePendingRows([srv()], [create({ familyId: 'other' })], 'f1', meta)
    expect(rows.map((r) => r.id)).toEqual(['srv-1'])
  })
})
