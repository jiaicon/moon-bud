import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(join(__dirname, '..', '..', 'pages/home/index.vue'), 'utf8')

/**
 * 首页那三行数字是家长决定"要不要再喂一次"的依据。切孩子的动作和上一次请求
 * 是并发的：慢的那条响应回来后如果照单全收，当前孩子名下显示的就是
 * 上一个孩子的记录 —— 数字看着正常，内容是错的，这比加载失败更难发现。
 */
describe('首页概览不能被过期响应覆盖', () => {
  it('每次刷新带一个序号', () => {
    expect(src).toMatch(/let refreshSeq = 0/)
    expect(src).toMatch(/const seq = \+\+refreshSeq/)
  });

  it('写 summary 之前先确认自己还是最新那一次', () => {
    const guard = src.search(/if \(seq !== refreshSeq\) return/)
    const assign = src.indexOf('summary.value = buildTodaySummary')
    expect(guard).toBeGreaterThan(-1)
    expect(assign).toBeGreaterThan(-1)
    expect(guard, '过期响应会覆盖当前孩子的概览').toBeLessThan(assign)
  })

  it('失败也遵守同一条规则，loading 由最新那次收尾', () => {
    expect(src).toMatch(/if \(seq !== refreshSeq\) return\s*\n\s*summary\.value = null/)
    expect(src).toMatch(/if \(seq === refreshSeq\) loading\.value = false/)
  })
})
