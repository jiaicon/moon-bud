import { describe, expect, it, vi } from 'vitest'
import { applyNativeChrome, ensureContrast, navigationBarStyle, tabBarStyle } from '../native-chrome'
import { THEME_PRESETS } from '../presets'
import type { ThemeTokens } from '../tokens'

const lum = (hex: string) => {
  const channel = (i: number) => {
    const s = parseInt(hex.slice(i, i + 2), 16) / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const ALL_TOKENS: [string, ThemeTokens][] = Object.values(THEME_PRESETS).flatMap((preset) => [
  [`${preset.id}.light`, preset.light] as [string, ThemeTokens],
  [`${preset.id}.dark`, preset.dark] as [string, ThemeTokens],
])

describe('ensureContrast', () => {
  it('已经达标时原样返回，不无谓改色', () => {
    expect(ensureContrast('#3F76B0', '#FFFFFF', 4.5)).toBe('#3F76B0')
  })

  it('不达标时推到达标，且色相不变', () => {
    const input = '#D98E4A'
    const out = ensureContrast(input, '#FFFFFF', 4.5)
    expect(contrast(out, '#FFFFFF')).toBeGreaterThanOrEqual(4.5)
    // 色相：橘色被压深之后仍是橘色，不会退成灰或黑
    const hue = (hex: string) => {
      const r = parseInt(hex.slice(1, 3), 16) / 255
      const g = parseInt(hex.slice(3, 5), 16) / 255
      const b = parseInt(hex.slice(5, 7), 16) / 255
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      const d = max - min
      if (d === 0) return -1
      const h =
        max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
      return Math.round(h * 60)
    }
    expect(Math.abs(hue(out) - hue(input))).toBeLessThanOrEqual(2)
  })
})

describe('tabBarStyle', () => {
  it('选中色与未选中色压在 tabBar 底色上都达到 AA', () => {
    for (const [name, tokens] of ALL_TOKENS) {
      const style = tabBarStyle(tokens)
      expect(contrast(style.selectedColor, style.backgroundColor), `${name} 选中项`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(style.color, style.backgroundColor), `${name} 未选中项`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('选中色仍然是那套预设的主色（达标时不改）', () => {
    expect(tabBarStyle(THEME_PRESETS['mist-blue'].light).selectedColor).toBe('#3F76B0')
    expect(tabBarStyle(THEME_PRESETS['peach-pink'].light).selectedColor).toBe('#B23A5E')
  })
})

describe('navigationBarStyle', () => {
  it('前景只有黑白两档：uni-app 的 frontColor 只认这两个值', () => {
    for (const [, tokens] of ALL_TOKENS) {
      expect(['#000000', '#ffffff']).toContain(navigationBarStyle(tokens).frontColor)
    }
  })

  it('深底用白字，浅底用黑字', () => {
    expect(navigationBarStyle(THEME_PRESETS['mist-blue'].dark).frontColor).toBe('#ffffff')
    expect(navigationBarStyle(THEME_PRESETS['mist-blue'].light).frontColor).toBe('#000000')
  })

  it('导航栏底色跟着主题走，不再是 pages.json 里写死的那块灰', () => {
    expect(navigationBarStyle(THEME_PRESETS['peach-pink'].light).backgroundColor).toBe('#FDF4F6')
  })
})

type ChromeUni = {
  setNavigationBarColor: (opts: unknown) => void
  setTabBarStyle: (opts: unknown) => void
}
const chromeUni = () => uni as unknown as ChromeUni

describe('applyNativeChrome', () => {
  it('两个原生 API 都按算出来的样式调用', () => {
    const spy = vi.fn()
    const tabSpy = vi.fn()
    const target = chromeUni()
    const originalNav = target.setNavigationBarColor
    const originalTab = target.setTabBarStyle
    target.setNavigationBarColor = spy
    target.setTabBarStyle = tabSpy
    try {
      applyNativeChrome(THEME_PRESETS['mist-blue'].dark)
      expect(spy).toHaveBeenCalledWith(navigationBarStyle(THEME_PRESETS['mist-blue'].dark))
      expect(tabSpy).toHaveBeenCalledWith({ ...tabBarStyle(THEME_PRESETS['mist-blue'].dark), fail: expect.any(Function) })
    } finally {
      target.setNavigationBarColor = originalNav
      target.setTabBarStyle = originalTab
    }
  })

  it('非 tab 页上 setTabBarStyle 抛错也不影响别的调用', () => {
    const target = chromeUni()
    const original = target.setTabBarStyle
    target.setTabBarStyle = () => {
      throw new Error('not a tabbar page')
    }
    try {
      expect(() => applyNativeChrome(THEME_PRESETS['mist-blue'].light)).not.toThrow()
    } finally {
      target.setTabBarStyle = original
    }
  })
})
