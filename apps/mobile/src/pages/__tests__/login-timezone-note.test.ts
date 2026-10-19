import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(join(__dirname, '..', 'login/index.vue'), 'utf8')

/**
 * 注册时 timezone 取设备那块表，用户从头到尾没看见过它，而它决定以后每一屏的"几点"。
 * 至少把选中的值念出来，并说清去哪里改。
 */
describe('注册页把时区说出来', () => {
  it('注册模式下显示设备时区的可读名', () => {
    expect(src).toMatch(/timezoneLabel\(form\.timezone\)/)
    const note = src.indexOf('<text class="login__note">')
    const registerBlock = src.indexOf('<view v-if="isRegister" class="field">')
    const joinBlock = src.indexOf(`<view v-if="mode === 'join'" class="field">`)
    expect(registerBlock).toBeGreaterThan(-1)
    expect(note, '提示不在注册才出现的字段块里，登录页会跟着一起念时区').toBeGreaterThan(registerBlock)
    expect(note).toBeLessThan(joinBlock)
  })

  it('指出去哪里改', () => {
    expect(src).toMatch(/我的.*时区/)
  })
})
