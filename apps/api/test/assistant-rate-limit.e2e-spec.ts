import { createRateWindow, tryConsume } from '../src/assistant/rate-limit'

const T0 = new Date('2026-10-26T00:00:00.000Z')
const at = (ms: number) => new Date(T0.getTime() + ms)
const S = 1000

describe('tryConsume', () => {
  it('窗口内到第 limit 次为止放行，之后拒绝并给出还需等多久', () => {
    const w = createRateWindow()
    expect(tryConsume(w, 'u1', T0, 3)).toEqual({ allowed: true, retryAfterMs: 0 })
    expect(tryConsume(w, 'u1', at(10 * S), 3).allowed).toBe(true)
    expect(tryConsume(w, 'u1', at(20 * S), 3).allowed).toBe(true)
    // 最早那一次要到 t0+60s 才滑出窗口，此刻（t0+30s）还差 30 秒。
    expect(tryConsume(w, 'u1', at(30 * S), 3)).toEqual({ allowed: false, retryAfterMs: 30_000 })
  })

  it('滑过去就恢复，不是整分钟一刀切', () => {
    const w = createRateWindow()
    expect(tryConsume(w, 'u1', T0, 1).allowed).toBe(true)
    expect(tryConsume(w, 'u1', at(59 * S), 1).allowed).toBe(false)
    expect(tryConsume(w, 'u1', at(61 * S), 1).allowed).toBe(true)
  })

  it('按 key 隔离：A 刷满不影响 B', () => {
    const w = createRateWindow()
    tryConsume(w, 'a', T0, 2)
    tryConsume(w, 'a', at(1 * S), 2)
    expect(tryConsume(w, 'a', at(2 * S), 2).allowed).toBe(false)
    expect(tryConsume(w, 'b', at(3 * S), 2).allowed).toBe(true)
  })

  it('不认识的 key 从 0 开始', () => {
    expect(tryConsume(createRateWindow(), 'nobody', T0, 1).allowed).toBe(true)
  })

  it('不累积超出窗口需要的记录（内存有上界）', () => {
    const w = createRateWindow()
    for (let i = 0; i < 1000; i++) tryConsume(w, 'u1', T0, 5)
    expect((w.hits.get('u1') ?? []).length).toBeLessThanOrEqual(5)
  })
})
