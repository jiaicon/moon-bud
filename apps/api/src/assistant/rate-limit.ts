/**
 * 进程内的滑动窗口节流。不引新依赖、不落库：助手口要防的是"一个人每秒刷十次"，
 * 不是跨实例的全局限流。真要多实例部署，这一层的误差是"每人每分钟最多 N×实例数 次"，
 * 对成本可以忽略，而换来的是零配置。
 */

export interface RateWindow {
  /** key（用户 id）→ 窗口内各次放行的时刻（epoch ms，升序）。 */
  hits: Map<string, number[]>
}

const DEFAULT_WINDOW_MS = 60_000

export function createRateWindow(): RateWindow {
  return { hits: new Map() }
}

export function tryConsume(
  window: RateWindow,
  key: string,
  now: Date,
  limit: number,
  windowMs: number = DEFAULT_WINDOW_MS,
): { allowed: boolean; retryAfterMs: number } {
  const ms = now.getTime()
  const cutoff = ms - windowMs
  // 先剔掉已滑出窗口的记录：列表长度因此天然不超过 limit，长期跑也不会涨内存。
  const recent = (window.hits.get(key) ?? []).filter((t) => t > cutoff)

  if (recent.length >= limit) {
    window.hits.set(key, recent)
    const oldest = recent[0] ?? ms
    return { allowed: false, retryAfterMs: Math.max(0, oldest + windowMs - ms) }
  }

  recent.push(ms)
  window.hits.set(key, recent)
  return { allowed: true, retryAfterMs: 0 }
}
