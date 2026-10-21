import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 预览页是给游客看的样例，它声明"按样例数据写死的那个时区念"（Asia/Shanghai），
 * 却用设备本地 getHours() 取钟点：手机调到 UTC 的游客会看到"上次喂奶 00:30"，
 * 以为这个演示坏了。这里锁住它真的走账号时区那套换算。
 */
const src = readFileSync(join(__dirname, '..', 'preview', 'index.vue'), 'utf8')

describe('预览页的钟点', () => {
  it('走 wallStamp(PREVIEW_TIMEZONE)，不再直接读设备本地', () => {
    expect(src).toMatch(/wallStamp\(\s*PREVIEW_TIMEZONE,\s*new Date\(iso\)\s*\)/)
    expect(src).not.toMatch(/d\.getHours\(\)/)
  })
})
