import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 下拉刷新是两端要对齐的配置：pages.json 开了开关却没有 onPullDownRefresh，
 * 用户拉到的是永远不消失的转圈；写了 handler 却没开开关，则根本没有手势。
 * I-6 就是这个错的第一次，所以把它钉成测试而不是靠人记。
 */
const srcDir = join(__dirname, '..', '..')
const pagesJson = JSON.parse(
  readFileSync(join(srcDir, 'pages.json'), 'utf8').replace(/^\s*\/\/.*$/gm, ''),
) as { pages: { path: string; style?: { enablePullDownRefresh?: boolean } }[] }

const enabled = pagesJson.pages.filter((p) => p.style?.enablePullDownRefresh).map((p) => p.path)

describe('下拉刷新', () => {
  it('pages.json 里开了开关的页面都有 handler，并且会停掉转圈', () => {
    expect(enabled.length).toBeGreaterThan(0)
    for (const path of enabled) {
      const page = readFileSync(join(srcDir, path + '.vue'), 'utf8')
      expect(page, `${path} 缺 onPullDownRefresh`).toContain('onPullDownRefresh(')
      expect(page, `${path} 忘了 stopPullDownRefresh`).toContain('stopPullDownRefresh()')
    }
  })

  it('写了 handler 的页面都开了开关', () => {
    for (const page of pagesJson.pages) {
      const source = readFileSync(join(srcDir, page.path + '.vue'), 'utf8')
      if (!source.includes('onPullDownRefresh(')) continue
      expect(page.style?.enablePullDownRefresh, `${page.path} 有 handler 却没开开关`).toBe(true)
    }
  })

  it('四个 tab 页都能下拉刷新', () => {
    expect(enabled).toEqual(
      expect.arrayContaining([
        'pages/home/index',
        'pages/event-list/index',
        'pages/reminder-list/index',
        'pages/profile/index',
      ]),
    )
  })
})
