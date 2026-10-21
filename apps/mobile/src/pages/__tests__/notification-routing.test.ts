import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 找回密码请求的通知正文让人去成员列表，点击却落在提醒页。
 * 路由本身有纯函数测试守着，这条只管"页面真的在用它"，
 * 免得纯函数留着、页面被改回 switchTab。
 */
const src = readFileSync(join(__dirname, '..', 'notification-center', 'index.vue'), 'utf8')

describe('通知中心的路由接线', () => {
  it('从 notifications/routing 取落点', () => {
    expect(src).toMatch(/import \{ notificationTarget \} from '\.\.\/\.\.\/notifications\/routing'/)
    expect(src).toMatch(/notificationTarget\(item\)/)
  })

  it('找回请求去成员列表，提醒去提醒页', () => {
    expect(src).toMatch(/case 'members':[\s\S]*navigateTo\(\{ url: '\/pages\/member-list\/index' \}/)
    expect(src).toMatch(/case 'reminders':[\s\S]*switchTab\(\{ url: '\/pages\/reminder-list\/index' \}/)
  })
})
