import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(join(__dirname, '..', '..', 'pages/welcome/index.vue'), 'utf8')

/**
 * H5 从 URL 进来，欢迎页挡不住谁；Android 的启动页就是 pages.json 的第一页，
 * 而这个第一页正是欢迎页。会话还有效的人打开手机，看到的是一段产品介绍和
 * "开始使用"，像被登出了 —— 他得再点一次登录才知道自己早就登录了。
 */
describe('欢迎页不再把有会话的人当游客', () => {
  it('先等会话落定，再决定去不去首页', () => {
    const wait = src.indexOf("authStore.status === 'loading'")
    const loggedIn = src.indexOf('authStore.isLoggedIn')
    expect(wait).toBeGreaterThan(-1)
    expect(loggedIn).toBeGreaterThan(-1)
    expect(wait, '不等会话就看 isLoggedIn，冷启动必然把有效会话当成没登录').toBeLessThan(loggedIn)
  })

  it('有会话就回首页（tabBar 页要用 switchTab）', () => {
    expect(src).toMatch(/if \(authStore\.isLoggedIn\) uni\.switchTab\(\{ url: '\/pages\/home\/index' \}\)/)
  })

  it('被踢回来的那一次不自动跳转，否则人刚要重新登录就被送走', () => {
    const guard = src.indexOf("if (expired.value) return")
    expect(guard).toBeGreaterThan(-1)
    expect(guard, 'expired=1 时也去等会话，会打断重新登录').toBeLessThan(
      src.indexOf("authStore.status === 'loading'"),
    )
  })
})
