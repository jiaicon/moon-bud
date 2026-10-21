import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 提醒列表原先只取第一页（50 条）就完了：一个用了一年的家庭"已完成"里远不止 50 条，
 * 而页面既不报总数也不给入口，人翻完最后一张卡片只会以为"就这些"。
 * 这条门控锁住"列表承认自己还有下一页"。
 */
const src = readFileSync(join(__dirname, '..', 'reminder-list', 'index.vue'), 'utf8')

describe('提醒列表要说自己还没显示完', () => {
  it('按服务端 total 判断有没有下一页，并给出取下一入口', () => {
    expect(src).toMatch(/const hasMore = computed\(\(\) => reminders\.value\.length < total\.value\)/)
    expect(src).toMatch(/v-if="!loading && hasMore"[\s\S]{0,80}加载更多/)
  })

  it('翻页是追加，不是把上一批丢掉', () => {
    expect(src).toMatch(/reminders\.value = reset \? res\.items : \[\.\.\.reminders\.value, \.\.\.res\.items\]/)
  })

  it('切分段、下拉刷新回到第一页', () => {
    expect(src).toMatch(/function load\(reset = true\)/)
    expect(src).toMatch(/= reset \? 1 : page\.value \+ 1/)
  })
})
