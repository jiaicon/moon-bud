import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const page = readFileSync(join(__dirname, '..', '..', 'pages', 'member-list', 'index.vue'), 'utf8')

/**
 * 成员页上"把某人设为管理员""移除成员"点完都会立刻弹一句"已更新"，然后再拉一趟名单。
 * 但回到本页时的那一趟（onShow）可能还压在网络上没落地：它出发于改动之前，
 * 拿到的正是改动前的旧名单，回来得比改动后那一趟晚，于是刚点完的角色在屏幕上翻回原样。
 * 口头说"已更新"、眼睛看到没变，用户只能再点一次——这一次可能真把对方降回成员。
 * 所以旧趟的响应要作废，只有最新那一次能写名单。
 */
describe('成员页不能被过期响应覆盖', () => {
  it('每次加载带一个序号', () => {
    expect(page).toMatch(/let loadSeq = 0/)
    expect(page).toMatch(/const seq = \+\+loadSeq/)
  })

  it('写名单之前先确认自己还是最新那一次', () => {
    const guard = page.search(/if \(seq !== loadSeq\) return/)
    const assign = page.indexOf('members.value = list')
    expect(assign).toBeGreaterThan(-1)
    expect(guard, '缺过期响应守卫：回前台的旧响应会把刚改好的角色翻回去').toBeGreaterThan(-1)
    expect(guard, '过期响应会覆盖刚改过的成员表').toBeLessThan(assign)
  })

  it('失败也遵守同一条规则，loading 由最新那次收尾', () => {
    expect(page).toMatch(/if \(seq !== loadSeq\) return\s*\n\s*error\.value =/)
    expect(page).toMatch(/if \(seq === loadSeq\) loading\.value = false/)
  })
})
