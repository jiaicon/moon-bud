import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 游客深链进这些页时一条请求都别发：发了就撞 401，而 401 的文案是
 * "登录已过期，请重新登录"——一次也没登录过的人被告知自己过期了。
 * 判定统一走 blockGuestDeepLink（会话问出来了才判），而且必须是 onLoad 的第一句：
 * 排在预填后面就等于先替游客发过一次请求。
 */
const DEEP_LINK_PAGES = [
  'member-list',
  'invite-qrcode',
  'notification-center',
  'stats',
  'family-select',
  'change-password',
  'event-form',
  'child-form',
  'reminder-form',
] as const

describe('非 Tab 页把游客深链挡在第一条请求之前', () => {
  it.each(DEEP_LINK_PAGES)('%s 一进来先问会话', (page) => {
    const src = readFileSync(join(__dirname, '..', '..', 'pages', page, 'index.vue'), 'utf8')
    expect(src).toMatch(/import \{ blockGuestDeepLink \} from '\.\.\/\.\.\/guest\/deep-link'/)
    expect(src).toMatch(/onLoad\(async \([^)]*\) => \{\s*if \(await blockGuestDeepLink\(\)\) return/)
  })
})
