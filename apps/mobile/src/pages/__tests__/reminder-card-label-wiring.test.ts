import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  join(__dirname, '..', '..', 'pages', 'reminder-list', 'index.vue'),
  'utf8',
)

describe('提醒列表的时间行', () => {
  it('用共享的卡片文案函数，不在页面里自己算一遍', () => {
    expect(source).toContain('reminderCardLabel(item)')
    // 页面自留一份 dueLabel 的话，"还欠"这条分支就会悄悄消失。
    expect(source).not.toMatch(/function dueLabel/)
    expect(source).not.toMatch(/const RRULE_HINT/)
  })

  it('"完成本次"的文案仍在：重复提醒点一次只完当天那一次', () => {
    expect(source).toContain('完成本次')
  })
})
