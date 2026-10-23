import { describe, expect, it, vi } from 'vitest'
import {
  applyNativeChrome,
  ensureContrast,
  navigationBarStyle,
  tabBarStyle,
  TABBAR_GLYPHS,
  tabBarItemPaths,
} from '../native-chrome'
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
  setTabBarItem: (opts: unknown) => void
}
const chromeUni = () => uni as unknown as ChromeUni

describe('tabBarItemPaths', () => {
  it('四格顺序与 pages.json 的 tabBar.list 一致', () => {
    expect(TABBAR_GLYPHS).toEqual(['home', 'record', 'reminder', 'profile'])
  })

  it('静息图与选中图都分主题 —— PNG 不会被原生 tabBar 着色，颜色只能烘进文件', () => {
    // 静息色用的是各预设自己的次要色（暖灰、冷灰互不相同），跟着预设走才不会和标签打架。
    expect(tabBarItemPaths(0, 'mist-blue', false).iconPath).toBe(
      '/static/tabbar/home-idle-mist-blue-light.png',
    )
    expect(tabBarItemPaths(0, 'cream-orange', false).iconPath).not.toBe(
      tabBarItemPaths(0, 'mist-blue', false).iconPath,
    )
    expect(tabBarItemPaths(0, 'cream-orange', false).selectedIconPath).toBe(
      '/static/tabbar/home-active-cream-orange-light.png',
    )
    expect(tabBarItemPaths(3, 'peach-pink', true).selectedIconPath).toBe(
      '/static/tabbar/profile-active-peach-pink-dark.png',
    )
  })

  it('App 端 setTabBarItem 要的是包内绝对路径，不能是相对路径', () => {
    for (let i = 0; i < TABBAR_GLYPHS.length; i++) {
      const { iconPath, selectedIconPath } = tabBarItemPaths(i, 'mist-blue', false)
      expect(iconPath.startsWith('/static/')).toBe(true)
      expect(selectedIconPath.startsWith('/static/')).toBe(true)
    }
  })
})

describe('applyNativeChrome', () => {
  const mistLight = { presetId: 'mist-blue' as const, dark: false }

  it('两个原生 API 都按算出来的样式调用，并给四格换上图', () => {
    const spy = vi.fn()
    const tabSpy = vi.fn()
    const itemSpy = vi.fn()
    const target = chromeUni()
    const originalNav = target.setNavigationBarColor
    const originalTab = target.setTabBarStyle
    const originalItem = target.setTabBarItem
    target.setNavigationBarColor = spy
    target.setTabBarStyle = tabSpy
    target.setTabBarItem = itemSpy
    try {
      applyNativeChrome(THEME_PRESETS['mist-blue'].dark, { presetId: 'mist-blue', dark: true })
      expect(spy).toHaveBeenCalledWith(navigationBarStyle(THEME_PRESETS['mist-blue'].dark))
      expect(tabSpy).toHaveBeenCalledWith({ ...tabBarStyle(THEME_PRESETS['mist-blue'].dark), fail: expect.any(Function) })
      expect(itemSpy).toHaveBeenCalledTimes(4)
      expect(itemSpy).toHaveBeenNthCalledWith(2, {
        index: 1,
        ...tabBarItemPaths(1, 'mist-blue', true),
        fail: expect.any(Function),
      })
    } finally {
      target.setNavigationBarColor = originalNav
      target.setTabBarStyle = originalTab
      target.setTabBarItem = originalItem
    }
  })

  it('非 tab 页上 setTabBarStyle 抛错也不影响别的调用', () => {
    const target = chromeUni()
    const original = target.setTabBarStyle
    target.setTabBarStyle = () => {
      throw new Error('not a tabbar page')
    }
    try {
      expect(() => applyNativeChrome(THEME_PRESETS['mist-blue'].light, mistLight)).not.toThrow()
    } finally {
      target.setTabBarStyle = original
    }
  })

  it('换图时某一格抛错，其余三格照样换：主题切换不能只换一半', () => {
    const target = chromeUni()
    const original = target.setTabBarItem
    const calls: unknown[] = []
    target.setTabBarItem = ((opts: unknown) => {
      calls.push(opts)
      if ((opts as { index: number }).index === 0) throw new Error('boom')
    }) as (opts: unknown) => void
    try {
      expect(() => applyNativeChrome(THEME_PRESETS['mist-blue'].light, mistLight)).not.toThrow()
      expect(calls).toHaveLength(4)
    } finally {
      target.setTabBarItem = original
    }
  })
})
