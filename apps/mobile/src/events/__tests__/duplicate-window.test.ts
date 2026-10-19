import { describe, expect, it } from 'vitest'
import { DEFAULT_WINDOW_MINUTES, resolveWindowMinutes, WINDOW_CHOICES, type WindowOverrides } from '../duplicate-window'

describe('resolveWindowMinutes', () => {
  it('没有覆盖时用该类型的内置默认（喂奶 90）', () => {
    expect(resolveWindowMinutes('feeding', {})).toBe(90)
    expect(resolveWindowMinutes('temperature', {})).toBe(180)
  })

  it('DEFAULT_WINDOW_MINUTES 就是各类型的内置默认值', () => {
    expect(DEFAULT_WINDOW_MINUTES.feeding).toBe(90)
    expect(DEFAULT_WINDOW_MINUTES.medicine).toBe(120)
  })

  it('覆盖值生效且优先于默认', () => {
    const overrides: WindowOverrides = { feeding: 30 }
    expect(resolveWindowMinutes('feeding', overrides)).toBe(30)
    // 没被覆盖的类型仍走默认
    expect(resolveWindowMinutes('sleep', overrides)).toBe(60)
  })

  it('非正数的覆盖值当作没设，回落默认', () => {
    expect(resolveWindowMinutes('feeding', { feeding: 0 })).toBe(90)
    expect(resolveWindowMinutes('feeding', { feeding: -5 })).toBe(90)
  })
})

describe('WINDOW_CHOICES', () => {
  it('候选档位都是正整数分钟，且覆盖常见的合理间隔', () => {
    for (const v of WINDOW_CHOICES) {
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThan(0)
    }
    expect(WINDOW_CHOICES).toContain(90)
  })
})
