import { describe, expect, it } from 'vitest'
import { inviteWindow } from '../invite-window'

/**
 * 邀请码是可以被人反复试的东西，时效是它仅有的闸。
 * 把"0"或"一星期"悄悄换成 72 小时，等于管理员以为发了一张当天的码，
 * 实际发出去的是一张三天的——而他看不见差别。
 */
describe('inviteWindow', () => {
  const accept = (raw: string) => {
    const parsed = inviteWindow(raw)
    if (!parsed.ok) throw new Error(`应该放行，却挡下了：${parsed.error}`)
    return parsed.expiresInHours
  }
  const reject = (raw: string) => {
    const parsed = inviteWindow(raw)
    if (parsed.ok) throw new Error(`应该挡下，却放行了：${parsed.expiresInHours} 小时`)
    return parsed.error
  }

  it('填了合法的整数就照用', () => {
    expect(inviteWindow('1')).toEqual({ ok: true, expiresInHours: 1 })
    expect(accept('720')).toBe(720)
  })

  it('留空走默认：72 小时', () => {
    expect(inviteWindow('')).toEqual({ ok: true, expiresInHours: 72 })
    expect(accept('   ')).toBe(72)
  })

  it('0 不是"没填"，是不合法的时长：要说，不能替人改成 72', () => {
    expect(reject('0')).toContain('1 到 720')
  })

  it('负数、小数、超过一个月、纯垃圾，一样当场说清楚', () => {
    for (const bad of ['-5', '1.5', '721', 'abc', '一星期', '99999']) {
      expect(reject(bad)).toContain('有效时长')
    }
  })

  it('挡下时要说清是哪一格的问题', () => {
    expect(reject('0')).toContain('小时')
  })
})
