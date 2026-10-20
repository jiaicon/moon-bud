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

  /**
   * 3. UpdateEventDto 没有 childId，而全局 ValidationPipe 是 whitelist 且不禁额外字段：
   *    编辑时发过去的 childId 被丢掉，还是 200，界面写着"已更新"。要么别发，
   *    要么就得真的支持"把记录挪到另一个孩子"——那是另一件事。
   *    保存现在走待同步出箱（submitUpdate/submitCreate），这条约束照样成立：
   *    childId 只在创建那一路出现，编辑那一路只认 familyId + editingId。
   */
  it('编辑记录时不发 childId，PATCH 根本不收', () => {
    expect(source).not.toMatch(/submitUpdate\([^)]*childId/)
    expect(source).toMatch(/outboxStore\.submitUpdate\(familyId\.value, editingId\.value, shared\)/)
    // 创建这一路要带 childId（新建的记录得有归属）。
    expect(source).toMatch(/submitCreate\(familyId\.value, \{ childId, \.\.\.shared \}\)/)
  })

  it('客户端的类型也不再声称记录可以换孩子', () => {
    const api = readFileSync(join(srcDir, 'api/endpoints.ts'), 'utf8')
    expect(api).toMatch(/input: Partial<Omit<EventCreateInput, 'childId'>>/)
  })
})
