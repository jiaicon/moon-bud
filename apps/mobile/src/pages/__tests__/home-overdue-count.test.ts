import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(join(__dirname, '..', '..', 'pages/home/index.vue'), 'utf8')

/**
 * 首页那条"N 条提醒已过期"是家长被催动的唯一入口。重复提醒在列表里 dueAt 是
 * null，客户端自己按 dueAt 筛就永远数不到它 —— "每天 20:00 喂药"过期三小时，
 * 首页还是一个字都不提。计数只能来自服务端的 OVERDUE。
 */
describe('首页的过期数来自服务端', () => {
  it('问的是 OVERDUE，不是 ACTIVE', () => {
    expect(src).toMatch(/remindersApi\.list\(familyId\.value,\s*'OVERDUE'/)
    expect(src).not.toMatch(/remindersApi\.list\(familyId\.value,\s*'ACTIVE'/)
  })

  it('用 total 而不是 items.length：一页装不下时条数才是对的', () => {
    expect(src).toMatch(/overdueCount:\s*\w+\.total/)
  })

  it('横幅直接读 summary.overdueCount，不再数数组', () => {
    expect(src).toMatch(/summary\.value\?\.overdueCount \?\? 0/)
    expect(src).not.toMatch(/overdueReminders/)
  })
})
