import { describe, expect, it } from 'vitest'
import { THEME_PRESETS, lightTokens, resolveDark, tokenNames, toCssVars } from '../presets'

describe('主题预设', () => {
  it('恰好 5 套预设，且 id 与键一致', () => {
    expect(Object.keys(THEME_PRESETS)).toHaveLength(5)
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

  it('五套预设的 primary 互不相同（否则换肤没有可见效果）', () => {
    const primaries = Object.values(THEME_PRESETS).map((p) => p.light.primary.toLowerCase())
    expect(new Set(primaries).size).toBe(5)
  })

  it('粉色预设真的是粉的', () => {
    const pink = THEME_PRESETS['peach-pink']
    expect(pink.name).toContain('粉')
    for (const tokens of [pink.light, pink.dark]) {
      const r = parseInt(tokens.primary.slice(1, 3), 16)
      const g = parseInt(tokens.primary.slice(3, 5), 16)
      const b = parseInt(tokens.primary.slice(5, 7), 16)
      expect(r, `${tokens.primary} 的红通道必须最高才是粉/玫红系`).toBeGreaterThan(g)
      expect(r).toBeGreaterThan(b)
    }
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

  it('主色按钮上的文字色达到 WCAG AA 对比，否则按钮文字看不见', () => {
    const lum = (hex: string) => {
      const channel = (i: number) => {
        const s = parseInt(hex.slice(i, i + 2), 16) / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
    }
    const ratio = (a: string, b: string) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
      return (hi + 0.05) / (lo + 0.05)
    }
    for (const preset of Object.values(THEME_PRESETS)) {
      for (const [mode, tokens] of [
        ['light', preset.light],
        ['dark', preset.dark],
      ] as const) {
        expect(tokens.onPrimary, `${preset.id}.${mode}.onPrimary 缺失`).toMatch(/^#[0-9A-Fa-f]{6}$/)
        expect(
          ratio(tokens.onPrimary, tokens.primary),
          `${preset.id}.${mode} 的 onPrimary 压在 primary 上对比不足`,
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})
