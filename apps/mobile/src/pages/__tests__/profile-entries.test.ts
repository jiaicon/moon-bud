import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const srcDir = join(__dirname, '..', '..')
const page = readFileSync(join(srcDir, 'pages/profile/index.vue'), 'utf8')

function bodyOf(fn: string): string {
  const start = page.indexOf(`async function ${fn}(`)
  expect(start, `${fn} 不在了`).toBeGreaterThan(-1)
  return page.slice(start, page.indexOf('\n}', start))
}

/** 某一行（go(...) 的跳转目标）落在哪个 section 标题之后。 */
function sectionOf(path: string): string {
  const at = page.indexOf(path)
  expect(at, `${path} 的入口不在了`).toBeGreaterThan(-1)
  const before = page.slice(0, at)
  const titles = [...before.matchAll(/class="section__title">([^<]+)</g)]
  expect(titles.length, `${path} 不在任何 section 里`).toBeGreaterThan(0)
  return titles[titles.length - 1][1]
}

describe('我的页的功能入口', () => {
  it('退出登录先确认，点了取消就什么都不做', () => {
    const body = bodyOf('logout')
    expect(body).toContain('confirmDanger(')
    expect(body.indexOf('confirmDanger(')).toBeLessThan(body.indexOf('authStore.logout()'))
    expect(body).toMatch(/if \(!ok\) return|if \(confirmed\) return|confirmed\.value \) return/)
  })

  it('确认的话说清后果，不是"确定吗"', () => {
    expect(page).toMatch(/content:\s*'[^']*(不再|清掉|推送|待同步)[^']*'/)
  })

  it('重复提醒提示与提醒中心都在"提醒"这一节里', () => {
    expect(sectionOf('/pages/dup-window-settings/index')).toBe('提醒')
    expect(sectionOf('/pages/notification-center/index')).toBe('提醒')
  })

  it('主题设置的入口跟着"外观"，不挂在"家庭"下面', () => {
    expect(sectionOf('/pages/theme-settings/index')).toBe('外观')
  })

  it('家庭这一节给得出成员、邀请，多个家庭时还给得出切换', () => {
    expect(sectionOf('/pages/member-list/index')).toBe('家庭')
    expect(sectionOf('/pages/invite-qrcode/index')).toBe('家庭')
    expect(page).toContain('/pages/family-select/index')
    expect(page).toMatch(/families\.length > 1/)
  })

  it('重复提醒提示那一行说得出本机改过几类', () => {
    expect(page).toContain('useDupWindowStore')
    expect(page).toMatch(/已改 \$\{|\$\{dup\.overrides/)
  })

  it('未读为 0 时不给红点：角标那一格本来就在 0 时摘掉，两行念成两个样子就是撒谎', () => {
    expect(page).toMatch(/unread\.value <= 0[\s\S]{0,20}return ''/)
  })
})
