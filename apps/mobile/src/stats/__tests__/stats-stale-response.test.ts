import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const page = readFileSync(join(__dirname, '..', '..', 'pages', 'stats', 'index.vue'), 'utf8')

/**
 * 统计页取数比首页更慢：一个孩子的一生要翻好几页才取得齐，这一趟要跑好几秒。
 * 双胞胎家庭里"点哥哥看一眼、马上点弟弟"是最自然的动作，而两次取数是并发的：
 * 哥哥那一趟（6 页）会在弟弟那一趟（1 页）之后才落地，照着单写就把界面上的
 * 弟弟名字配上哥哥的数字——柱子看着正常，内容是别人的。这比加载失败更难发现，
 * 因为它没有任何异样可看。所以每一趟开头取一个序号，落地前确认自己还是最新那次。
 *
 * 同一次翻页里的 familyId/childId 也必须取一次定死：中途换了孩子，
 * 后几页查的是新孩子，拼起来是一份两边都不像的混合数据。
 */
describe('统计页不能被过期响应覆盖', () => {
  it('每次取数带一个序号，且把本次作用域定死', () => {
    expect(page).toMatch(/let loadSeq = 0/)
    expect(page).toMatch(/const seq = \+\+loadSeq/)
    expect(page).toMatch(/const scopeFamilyId = familyId\.value/)
    expect(page).toMatch(/const scopeChildId = childId\.value/)
  })

  it('翻页用的是定死的那份作用域，不是每次都现读 store', () => {
    // 循环搬进了 fetchPages（两段取数共用），要钉的是"每一页都拿开头定死的 familyId"。
    expect(page).toMatch(/async function fetchPages\(scopeFamilyId: string, filters: EventListFilters\)/)
    expect(page).toMatch(/eventsApi\.list\(scopeFamilyId, buildEventQuery\(filters, page, 100\)\)/)
    expect(page).toMatch(/fetchPages\(scopeFamilyId, \{/)
    expect(page).not.toMatch(/eventsApi\.list\(\s*familyId\.value/)
  })

  it('写 events 之前先确认自己还是最新那一次', () => {
    const guard = page.search(/if \(seq !== loadSeq\) return/)
    const assign = page.indexOf('events.value = uniqueById(')
    expect(assign).toBeGreaterThan(-1)
    expect(guard, '缺过期响应守卫：慢的那一趟会把当前孩子写成别人的数').toBeGreaterThan(-1)
    expect(guard, '过期响应会覆盖当前孩子的统计').toBeLessThan(assign)
  })

  it('失败与 loading 收尾也遵守同一条规则', () => {
    expect(page).toMatch(/if \(seq !== loadSeq\) return\s*\n\s*error\.value =/)
    expect(page).toMatch(/if \(seq === loadSeq\) loading\.value = false/)
  })
})
