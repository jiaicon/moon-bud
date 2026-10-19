import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REMINDER_TAB_INDEX } from '../../notifications/tab-badge'

const page = (rel: string) => readFileSync(join(__dirname, '..', '..', ...rel.split('/')), 'utf8')

/** pages.json 允许 `//` 注释（第 5 格预留），JSON.parse 之前要剥掉。 */
function tabBarList(): Array<{ pagePath: string }> {
  const raw = page('pages.json').replace(/^\s*\/\/.*$/gm, '')
  return JSON.parse(raw).tabBar.list
}

describe('未读角标的接线', () => {
  it('角标下标就是 pages.json 里"提醒"那一格', () => {
    const list = tabBarList()
    expect(list[REMINDER_TAB_INDEX]?.pagePath).toBe('pages/reminder-list/index')
  })

  it('回前台补一次：App 关着的时候服务端又攒了几条', () => {
    expect(page('App.vue')).toMatch(/onShow\(\(\) => \{[\s\S]*refreshUnreadTabBadge\(\)[\s\S]*\}\)/)
  })

  it('每个 Tab 页落地都补一次：H5 的冷启动里 App.onShow 早于 tabBar 挂载，只靠它会永远画不上', () => {
    // "我的"那一页自己读未读数喂给行内数字，同一份结果顺手画角标，不必再问一次。
    for (const rel of [
      'pages/home/index.vue',
      'pages/event-list/index.vue',
      'pages/reminder-list/index.vue',
    ]) {
      expect(page(rel)).toContain('refreshUnreadTabBadge()')
    }
    expect(page('pages/profile/index.vue')).toContain('applyUnreadBadge(count)')
  })

  it('读完通知就跟着掉：标记已读与全部已读都要补', () => {
    const center = page('pages/notification-center/index.vue')
    expect(center).toMatch(/await notificationsApi\.markRead[\s\S]*refreshUnreadTabBadge\(\)/)
    expect(center).toMatch(/readAll[\s\S]*refreshUnreadTabBadge\(\)/)
  })

  it('"我的"那一行与角标共用同一次读取', () => {
    const profile = page('pages/profile/index.vue')
    expect(profile).toMatch(/const count = await fetchUnreadCount\(\)/)
    expect(profile).toMatch(/applyUnreadBadge\(count\)/)
  })

  it('登录与会话清掉都跟着改角标，否则头顶是上一趟会话的数字', () => {
    const auth = page('stores/auth.ts')
    expect(auth).toMatch(/applySession[\s\S]*refreshUnreadTabBadge\(\)/)
    expect(auth).toMatch(/clearSession[\s\S]*applyUnreadBadge\(0\)/)
  })

  it('读不到时不许把 0 当成答案传给屏幕', () => {
    expect(page('notifications/unread.ts')).toMatch(/Promise<number \| null>/)
  })
})
