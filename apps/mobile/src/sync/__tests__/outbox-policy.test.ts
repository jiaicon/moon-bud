import { describe, expect, it } from 'vitest'
import {
  MAX_ATTEMPTS,
  MAX_AGE_MS,
  isStale,
  stepFor,
  type OutboxItem,
} from '../outbox'

function item(over: Partial<OutboxItem> = {}): OutboxItem {
  return {
    entryId: 'e1',
    op: 'create',
    familyId: 'f1',
    eventId: 'c1',
    body: { childId: 'ch1', type: 'feeding', occurredAt: '2026-10-16T02:00:00.000Z', payload: {} },
    enqueuedAt: 1_000,
    attempts: 0,
    ...over,
  }
}

describe('stepFor：一次重放失败后怎么办', () => {
  it('网络没通（还在离线）：整趟停下，这条不算它自己的错、不吃重试额度', () => {
    expect(stepFor(item(), { isNetworkError: true }, 2_000)).toBe('halt-offline')
  })

  it('确定性的错误（离线也会照样失败），刚试过不久：留着，稍后再来一趟', () => {
    expect(stepFor(item(), { isNetworkError: false }, 2_000)).toBe('retry-later')
  })

  it('确定性错误且这条已经试到上限：丢掉，不再让它挡着后面的', () => {
    const used = item({ attempts: MAX_ATTEMPTS - 1 })
    expect(stepFor(used, { isNetworkError: false }, 2_000)).toBe('drop')
  })

  it('确定性错误但这条已经老得没人记得了：一样丢掉', () => {
    const old = item({ enqueuedAt: 1 })
    expect(stepFor(old, { isNetworkError: false }, 1 + MAX_AGE_MS)).toBe('drop')
  })
})

describe('isStale：冷启动清理时的去留', () => {
  it('没到次数上限也没过期 → 留着', () => {
    expect(isStale(item({ attempts: 3 }), 1_001)).toBe(false)
  })
  it('试满上限 → 该丢', () => {
    expect(isStale(item({ attempts: MAX_ATTEMPTS }), 1_001)).toBe(true)
  })
  it('放太久 → 该丢', () => {
    expect(isStale(item({ enqueuedAt: 1 }), 1 + MAX_AGE_MS)).toBe(true)
  })
})
