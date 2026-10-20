import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const page = readFileSync(join(__dirname, '..', '..', 'pages', 'stats', 'index.vue'), 'utf8')

/**
 * 取数分两段，而不是一次把该孩子的全部历史拉回。
 *
 * 每日柱状只看 7/30 天，喂/尿/睡是高频记录——历史越长拉得越多，而多拉的那几百条
 * 一根柱子都用不上；生长曲线反过来，家长一月称一次，窗口里常常只剩一两个点，
 * 必须看全量。合成一趟就变成"为了几个称重点把全部记录搬回来"。
 *
 * 窗口界必须由 rangeBounds 按**账号时区**算午夜，和记录页"近 7 天"用的是同一把尺——
 * 两处各算各的，同一屏的列表和图就不是同一段日子。
 */
describe('统计页两段取数', () => {
  it('窗口档位映射到记录页同一套区间预设', () => {
    expect(page).toMatch(/const RANGE_BY_WINDOW: Record<7 \| 30, EventRange> = \{ 7: '7d', 30: '30d' \}/)
  })

  it('每日那一趟带账号时区算出来的窗口界', () => {
    expect(page).toMatch(/rangeBounds\(RANGE_BY_WINDOW\[scopeWindow\], scopeTimezone\)/)
  })

  it('生长那一趟单独按 type=growth 取全量，不叠每日那趟的结果', () => {
    expect(page).toMatch(/\{ childId: scopeChildId, type: 'growth' \}/)
    expect(page).toMatch(/uniqueById\(\[\.\.\.daily, \.\.\.growth\]\)/)
  })

  it('换窗口要重取：窗口变了就是另一段日子', () => {
    expect(page).toMatch(/function pickWindow\(days: 7 \| 30\): void \{[\s\S]{0,160}?void runLoad\(\)/)
  })
})
