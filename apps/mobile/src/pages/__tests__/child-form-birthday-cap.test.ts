import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(join(__dirname, '..', '..', 'pages/child-form/index.vue'), 'utf8')

/**
 * "生日不能晚于今天"的上限取自哪块表，决定了跨时区的家庭能不能把孩子存下来：
 * 设备在洛杉矶而家在上海时，上海的今天在洛杉矶还是昨天，选择器会把真实的生日
 * 挡在外面，校验又用另一套日期，两行文案自相矛盾。
 */
describe('孩子生日的上限按账号时区取"今天"', () => {
  it('不再用设备本地的 new Date() 算今天', () => {
    expect(src).not.toMatch(/const today = new Date\(\)/)
    expect(src, '还留着设备本地的日期拼接').not.toMatch(/today\.getFullYear\(\)/)
  })

  it('上限来自账号时区里的今天，校验读的是同一个值', () => {
    expect(src).toMatch(/const maxBirthday = computed\(\(\) => wallFields\(timezone\.value\)\.date\)/)
    expect(src).toContain('birthday.value > maxBirthday.value')
  })
})
