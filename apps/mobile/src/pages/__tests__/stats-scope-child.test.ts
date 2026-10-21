import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 统计取数要翻好几页，期间家长完全可能切了孩子。图上的数据是为上一个孩子取的，
 * 标题却读当前孩子——"生长曲线 · 弟弟"下面挂着姐姐的体重，还顺手把姐姐的
 * 待同步行并进这张图。取数早就用 scopeChildId 锁了作用域，显示这一侧也得跟着锁。
 */
const src = readFileSync(join(__dirname, '..', 'stats', 'index.vue'), 'utf8')

describe('统计的标题与图必须是同一个孩子', () => {
  it('落数据时把作用域孩子记下来', () => {
    expect(src).toMatch(/loadedChildId\.value = scopeChildId/)
  })

  it('标题读那个记下来的 id，不读当前选中', () => {
    expect(src).toMatch(
      /const childName = computed\(\(\) => children\.value\.find\(\(c\) => c\.id === displayChildId\.value\)/,
    )
  })

  it('待同步行也按那个 id 筛', () => {
    expect(src).toMatch(/childId: displayChildId\.value,/)
    expect(src).not.toMatch(/childId: childId\.value,\n\s*\}\)/)
  })
})
