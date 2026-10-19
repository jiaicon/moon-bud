import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const srcDir = join(__dirname, '..', '..')

/**
 * 记一条数据不该悄悄缺一块。这两处以前都是"界面上填了、存下来没有"：
 *
 * 1. buildPayload 把不像数字的字段跳过就继续提交。amountMl/durationMin 都是可选
 *    数字字段，于是"120cc"这种输入会被当成没填，记录照样保存，用户看到一句红字
 *    却已经回到列表。
 * 2. 睡眠的时长全靠 endedAt，而它以前只看 endDate。结束时间那一栏是两个独立的
 *    选择器，只点钟点（日期还写着"未设置"）也会照样保存，endedAt 存成 null，
 *    这条睡眠就这么没有了时长。
 */
const source = readFileSync(join(srcDir, 'pages/event-form/index.vue'), 'utf8')

describe('记录表单不会把用户填的东西丢掉', () => {
  it('数字字段填得不像数字时挡住提交，而不是当成没填', () => {
    expect(source).toMatch(/return blocked \? null : payload/)
    expect(source).toMatch(/const payload = buildPayload\(\)\s*\n\s*if \(!payload\) return/)
  })

  it('结束时间只选了一半时当场说清楚，并且有话显示出来', () => {
    expect(source).toMatch(/if \(halfFilledEnd\.value\)/)
    expect(source).toMatch(/errors\.end = /)
    expect(source).toMatch(/v-if="errors\.end"/)
  })
})
