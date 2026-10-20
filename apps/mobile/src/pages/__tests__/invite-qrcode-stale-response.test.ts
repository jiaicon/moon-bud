import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const page = readFileSync(join(__dirname, '..', '..', 'pages', 'invite-qrcode', 'index.vue'), 'utf8')

/**
 * 撤销按钮没有 `busy` 挡手（生成才有），连着点两张"撤销"是常见动作：第一趟列表
 * 是在第二次撤销之前出发的，回来得晚就把已经撤销的那张又画回"剩 N 次"，
 * 而屏幕上刚说过"已撤销"。同一屏自相矛盾，用户只能凭猜决定要不要再发一张码。
 * 所以每一趟带序号，只有最新那次能写列表。
 */
describe('邀请页不能被过期响应覆盖', () => {
  it('每次加载带一个序号', () => {
    expect(page).toMatch(/let loadSeq = 0/)
    expect(page).toMatch(/const seq = \+\+loadSeq/)
  })

  it('写列表之前先确认自己还是最新那一次', () => {
    const guard = page.search(/if \(seq !== loadSeq\) return/)
    const assign = page.indexOf('invites.value = list')
    expect(assign).toBeGreaterThan(-1)
    expect(guard, '缺过期响应守卫：慢一步的旧列表会把刚撤销的码复活').toBeGreaterThan(-1)
    expect(guard, '过期响应会盖掉刚撤销的状态').toBeLessThan(assign)
  })

  it('失败也遵守同一条规则', () => {
    expect(page).toMatch(/if \(seq !== loadSeq\) return\s*\n\s*error\.value =/)
  })
})
