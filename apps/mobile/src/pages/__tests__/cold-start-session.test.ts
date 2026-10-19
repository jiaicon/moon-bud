import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const srcDir = join(__dirname, '..', '..')

/**
 * `isLoggedIn` 读的是内存里的 access token，冷启动时它必然是 null：静默登录
 * 还在路上。页面若拿它当第一道守卫又不等会话落定，就会把"没登录"当成结论，
 * 于是"我的"页刷新一次之后家庭名永远写着"还没有家庭"（实测）。
 */
describe('冷启动的会话守卫', () => {
  it('等会话的语句必须排在 isLoggedIn 判断之前', () => {
    const source = readFileSync(join(srcDir, 'pages/profile/index.vue'), 'utf8')
    const wait = source.indexOf("authStore.status === 'loading'")
    const guard = source.indexOf('authStore.isLoggedIn')
    expect(wait).toBeGreaterThan(-1)
    expect(guard).toBeGreaterThan(-1)
    expect(wait, 'isLoggedIn 之前没有等会话，冷启动会把家庭名说成"还没有家庭"').toBeLessThan(guard)
  })

  it('邀请落地页保持同样的写法：先等会话，再判断登录态', () => {
    const source = readFileSync(join(srcDir, 'pages/join/index.vue'), 'utf8')
    expect(source.indexOf("authStore.status === 'loading'")).toBeLessThan(
      source.indexOf('authStore.isLoggedIn'),
    )
  })
})
