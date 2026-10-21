import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 退一层必须由 stepBack 来做：`uni.navigateBack()` 在页面栈只剩当前这一页时什么都不做，
 * 而深链、扫码落地、冷启动直接打开表单恰好造得出那种栈形。
 * 于是"保存成功"的 toast 一闪，人还停在原地——他会以为没存上，再点一次，多出一条记录。
 */
describe('页面里不许再留裸的 uni.navigateBack()', () => {
  const pagesDir = join(__dirname, '..')
  const files: string[] = []
  for (const page of readdirSync(pagesDir)) {
    const file = join(pagesDir, page, 'index.vue')
    // 没有 index.vue 的目录（例如 __tests__）跳过
    try {
      readFileSync(file, 'utf8')
    } catch {
      continue
    }
    files.push(file)
  }

  it('每一页都退得出去', () => {
    const offenders = files
      .filter((f) => readFileSync(f, 'utf8').includes('uni.navigateBack('))
      .map((f) => f.replace(/\\/g, '/').split('/pages/')[1])
    expect(offenders).toEqual([])
  })

  it('stepBack 只有 utils/back-nav 一处实现，页面一律引它', () => {
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      if (!src.includes('stepBack(')) continue
      expect(src).toMatch(/import \{ stepBack \} from '\.\.\/\.\.\/utils\/back-nav'/)
    }
  })
})
