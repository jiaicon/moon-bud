import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const srcDir = join(__dirname, '..', '..')

/**
 * 后端的 UpdateReminderDto 刻意不收 `type`（一次性↔重复等于换了一个东西），
 * 而全局 ValidationPipe 是 whitelist 不 forbid —— 多余的 `type` 会被静默丢掉。
 * 于是编辑页上那个类型开关是个陷阱：拨过去、看到"已保存"，提醒却还是原来那个
 * 类型（更糟的是重复那一向会把一条没人用的 rrule 写到一次性提醒上）。
 * 编辑时开关必须说明自己为什么不动，更新请求也不再发这个字段。
 */
const source = readFileSync(join(srcDir, 'pages/reminder-form/index.vue'), 'utf8')

describe('提醒类型的编辑语义', () => {
  it('类型芯片走 pickType，不再直接改写 isRecurring', () => {
    expect(source).not.toMatch(/@click="isRecurring = (true|false)"/)
    expect(source).toMatch(/@click="pickType\(/)
  })

  it('编辑时给出"类型改不了"的说法', () => {
    expect(source).toMatch(/pickType[\s\S]{0,300}?showToast/)
    expect(source).toContain('类型')
  })

  it('type 只在 POST 里出现，PATCH 不再携带后端会静默丢弃的字段', () => {
    expect(source).toMatch(/type: isRecurring\.value \? 'RECURRING' : 'ONE_TIME'/)
    expect(source).not.toMatch(/type: '(?:ONE_TIME|RECURRING)' as const/)
  })
})
