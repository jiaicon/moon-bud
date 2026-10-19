import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const page = (rel: string) => readFileSync(join(__dirname, '..', '..', ...rel.split('/')), 'utf8')

describe('应用内"到点了"的接线', () => {
  it('回前台开始盯着：App 开着的时候本地推送不一定响', () => {
    expect(page('App.vue')).toMatch(/onShow\(\(\) => \{[\s\S]*startDueWatch\(\)[\s\S]*\}\)/)
  })

  it('退到后台就停手：看不见屏幕时轮询只是白跑请求', () => {
    expect(page('App.vue')).toMatch(/onHide\(\(\) => \{[\s\S]*stopDueWatch\(\)[\s\S]*\}\)/)
  })

  it('登录成功立刻开始，退出登录复位：否则换账号会带着上一家的"已看过"', () => {
    const auth = page('stores/auth.ts')
    expect(auth).toMatch(/applySession[\s\S]*startDueWatch\(\)/)
    expect(auth).toMatch(/clearSession[\s\S]*resetDueWatch\(\)/)
  })

  it("第一次只记底不弹，这条规矩写在被调用的那份代码里", () => {
    expect(page('notifications/due-watch.ts')).toMatch(/seenIds === null[\s\S]*surface: \[\]/)
  })
})
