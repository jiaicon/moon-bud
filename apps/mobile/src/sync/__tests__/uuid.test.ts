import { describe, expect, it } from 'vitest'
import { uuidV4 } from '../uuid'

// 后端 EventsService 用客户端自带 id 做幂等，Prisma 列是 @db.Uuid、DTO 是 @IsUUID()：
// 生成出来的必须是合法的 v4 UUID，否则离线重放会在门口就被 400 挡掉。
describe('uuidV4', () => {
  it('形状是标准 8-4-4-4-12 的十六进制', () => {
    const value = uuidV4()
    expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('版本位恒为 4，变体位恒为 8/9/a/b（@IsUUID 会查这两处）', () => {
    for (let i = 0; i < 200; i += 1) {
      const value = uuidV4()
      expect(value[14]).toBe('4')
      expect('89ab').toContain(value[19])
    }
  })

  it('连续生成不重复', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 500; i += 1) seen.add(uuidV4())
    expect(seen.size).toBe(500)
  })
})
