import { describe, expect, it } from 'vitest'
import { THEME_PRESETS, lightTokens, resolveDark, tokenNames, toCssVars } from '../presets'

describe('主题预设', () => {
  it('恰好 4 套预设，且 id 与键一致', () => {
    expect(Object.keys(THEME_PRESETS)).toHaveLength(4)
    for (const [key, preset] of Object.entries(THEME_PRESETS)) {
      expect(preset.id).toBe(key)
    }
  })

  it('每套预设的明暗两版都覆盖全部语义令牌', () => {
    const names = tokenNames()
    expect(names.length).toBeGreaterThanOrEqual(13)
    for (const preset of Object.values(THEME_PRESETS)) {
      for (const tokens of [preset.light, preset.dark]) {
        for (const name of names) {
          expect(tokens[name], `${preset.id}.${name} 缺失`).toMatch(/^#[0-9A-Fa-f]{6}$/)
        }
      }
    }
  })

  it('四套预设的 primary 互不相同（否则换肤没有可见效果）', () => {
    const primaries = Object.values(THEME_PRESETS).map((p) => p.light.primary.toLowerCase())
    expect(new Set(primaries).size).toBe(4)
  })

  it('暗色版背景比文字暗（对比方向不能反）', () => {
    const lum = (hex: string) => {
      const n = parseInt(hex.slice(1), 16)
      return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255)
    }
    for (const preset of Object.values(THEME_PRESETS)) {
      expect(lum(preset.dark.background)).toBeLessThan(lum(preset.dark.textPrimary))
      expect(lum(preset.light.background)).toBeGreaterThan(lum(preset.light.textPrimary))
    }
  })

  it('模板令牌与预设令牌键集合完全一致', () => {
    const names = tokenNames().sort()
    for (const preset of Object.values(THEME_PRESETS)) {
      expect(Object.keys(preset.light).sort()).toEqual(names)
    }
    expect(Object.keys(lightTokens).sort()).toEqual(names)
  })

  it('toCssVars 产出带前缀的 CSS 变量名', () => {
    const vars = toCssVars(THEME_PRESETS['mist-blue'].light)
    expect(vars['--mb-color-primary']).toBe(THEME_PRESETS['mist-blue'].light.primary)
    expect(Object.keys(vars).every((k) => k.startsWith('--mb-color-'))).toBe(true)
  })

  it('resolveDark 处理 auto 模式', () => {
    expect(resolveDark('light', true)).toBe(false)
    expect(resolveDark('dark', false)).toBe(true)
    expect(resolveDark('auto', true)).toBe(true)
    expect(resolveDark('auto', false)).toBe(false)
  })
})
