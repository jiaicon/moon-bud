import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const srcDir = join(__dirname, '..', '..')

/**
 * `isLoggedIn` 读的是内存里的 access token，冷启动时它必然是 null：静默登录
 * 还在路上。页面若拿它当第一道守卫又不等会话落定，就会把"没登录"当成结论，
 * 于是"我的"页刷新一次之后家庭名永远写着"还没有家庭"（实测）。
 */
/**
 * 等会话落定的写法有两种，认得更严的那一种是 `session === 'unknown'`：
 * `status` 在"本地压根没有凭证"那趟是 idle，拿它当守卫等于每次冷启动都白跑一次
 * bootstrap，而 isLoggedIn 在会话还没问出来时本来就是 false。
 */
function waitIndex(source: string): number {
  const indexes = ["authStore.session === 'unknown'", "authStore.status === 'loading'"]
    .map((phrase) => source.indexOf(phrase))
    .filter((at) => at >= 0)
  return indexes.length ? Math.min(...indexes) : -1
}

describe('冷启动的会话守卫', () => {
  it('等会话的语句必须排在 isLoggedIn 判断之前', () => {
    const source = readFileSync(join(srcDir, 'pages/profile/index.vue'), 'utf8')
    const wait = waitIndex(source)
    const guard = source.indexOf('authStore.isLoggedIn')
    expect(wait).toBeGreaterThan(-1)
    expect(guard).toBeGreaterThan(-1)
    expect(wait, 'isLoggedIn 之前没有等会话，冷启动会把家庭名说成"还没有家庭"').toBeLessThan(guard)
  })

  it('邀请落地页保持同样的写法：先等会话，再判断登录态', () => {
    const source = readFileSync(join(srcDir, 'pages/join/index.vue'), 'utf8')
    expect(waitIndex(source)).toBeLessThan(source.indexOf('authStore.isLoggedIn'))
  })
})
