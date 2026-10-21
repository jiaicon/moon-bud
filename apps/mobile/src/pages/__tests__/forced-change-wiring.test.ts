import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const TAB_PAGES = ['home', 'event-list', 'reminder-list', 'profile'] as const

function srcOf(page: string): string {
  return readFileSync(join(__dirname, '..', '..', 'pages', page, 'index.vue'), 'utf8')
}

/**
 * 临时密码必须改掉才给用（spec 第 5 节），而拦人的地方只有页面自己的 onShow。
 * 少了哪一页，那一页就成了拿着随时该作废的密码照样能读的窗口；
 * 页面里再留一次性布尔，返回键就能把守卫整个拆掉。
 */
describe('四个 tabBar 页都守住"临时密码没改就不许停留"', () => {
  it.each(TAB_PAGES)('%s 在 onShow 里用共用的栈顶守卫拦', (page) => {
    const src = srcOf(page)
    expect(src).toMatch(/import \{ guardForcedChange \} from '\.\.\/\.\.\/utils\/forced-change'/)
    expect(src).toMatch(
      /onShow\(\(\) => \{\s*(?:\/\/[^\n]*\n\s*)*guardForcedChange\(authStore\.mustChangePassword\)/,
    )
  })

  it.each(TAB_PAGES)('%s 没留下自己的一套一次性标记', (page) => {
    const src = srcOf(page)
    expect(src).not.toMatch(/forcedHandled/)
    // 也不许再各写一份跳转：判据只能有一条，多写一份就多一个能被绕开的地方。
    expect(src).not.toMatch(/navigateTo\(\{ url: '\/pages\/change-password\/index\?forced=1' \}\)/)
  })
})
