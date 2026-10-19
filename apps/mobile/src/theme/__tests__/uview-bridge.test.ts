import { describe, expect, it } from 'vitest'
import { THEME_PRESETS } from '../presets'
import { themeVarsStyle, toUViewCssVars } from '../uview-bridge'
import type { ThemeTokens } from '../tokens'

/**
 * uView Pro 的组件（u-popup / u-empty / u-subsection …）只认它自己那套 --u-* 变量，
 * 而那套变量在 theme.scss 里是写死的浅色值。主题只注入 --mb-* 的话，深色模式下
 * 弹层仍是白底 + 深色页面文字 —— 因此令牌必须同时喂给 --u-*。
 */
describe('uView 变量桥接', () => {
  const presets = Object.values(THEME_PRESETS)

  it('表面色跟着令牌走，深色预设不会留下白底', () => {
    for (const preset of presets) {
      for (const variant of [preset.light, preset.dark] as ThemeTokens[]) {
        const vars = toUViewCssVars(variant)
        expect(vars['--u-bg-white']).toBe(variant.surface)
        expect(vars['--u-main-color']).toBe(variant.textPrimary)
        expect(vars['--u-content-color']).toBe(variant.textSecondary)
        expect(vars['--u-border-color']).toBe(variant.border)
        expect(vars['--u-divider-color']).toBe(variant.divider)
      }
    }
  })

  it('语义色也桥接，否则组件的按钮/提示仍是 uView 默认蓝', () => {
    const vars = toUViewCssVars(THEME_PRESETS['mist-blue'].dark)
    const tokens = THEME_PRESETS['mist-blue'].dark
    expect(vars['--u-type-primary']).toBe(tokens.primary)
    expect(vars['--u-type-primary-light']).toBe(tokens.primaryLight)
    expect(vars['--u-type-error']).toBe(tokens.error)
    expect(vars['--u-type-success']).toBe(tokens.success)
    expect(vars['--u-type-warning']).toBe(tokens.warning)
    expect(vars['--u-type-info']).toBe(tokens.info)
  })

  it('rgb 三元组由同一个十六进制算出来（uView 用 rgba(var(--u-x-rgb), .5)）', () => {
    const vars = toUViewCssVars({ ...THEME_PRESETS['mist-blue'].light, surface: '#FFFFFF' })
    expect(vars['--u-bg-white-rgb']).toBe('255, 255, 255')
    expect(vars['--u-main-color-rgb']).toBe('31, 42, 53')
  })

  it('每个颜色变量都配了对应的 rgb 三元组，不能只换十六进制', () => {
    const vars = toUViewCssVars(THEME_PRESETS['cream-orange'].dark)
    const colored = Object.keys(vars).filter(
      (k) => !k.endsWith('-rgb') && vars[k].startsWith('#'),
    )
    expect(colored.length).toBeGreaterThan(0)
    for (const key of colored) expect(vars[`${key}-rgb`]).toMatch(/^\d{1,3}, \d{1,3}, \d{1,3}$/)
  })

  it('遮罩在深色下更深，浅色下保持 uView 原味的半透明黑', () => {
    expect(toUViewCssVars(THEME_PRESETS['mist-blue'].dark)['--u-mask-color']).toBe(
      'rgba(0, 0, 0, 0.68)',
    )
    expect(toUViewCssVars(THEME_PRESETS['mist-blue'].light)['--u-mask-color']).toBe(
      'rgba(0, 0, 0, 0.4)',
    )
  })

  it('themeVarsStyle 把两套变量拼成一段内联样式', () => {
    const tokens = THEME_PRESETS['mist-blue'].dark
    const style = themeVarsStyle(tokens)
    expect(style).toContain(`--mb-color-surface:${tokens.surface}`)
    expect(style).toContain(`--u-bg-white:${tokens.surface}`)
    expect(style.endsWith(';')).toBe(false)
  })

  it('弹层必须靠内联样式拿变量：uView 的 theme.scss 把默认值挂在 page 上，比 documentElement 更近', () => {
    const tokens = THEME_PRESETS['cream-orange'].dark
    const vars = { ...toUViewCssVars(tokens) }
    // 这条钉住的是"页内根节点自己带一份"这个事实 —— 只写 documentElement 时，
    // page 上的 #ffffff 会盖掉它，深色模式的弹层就还是白底。
    expect(vars['--u-bg-white']).toBe(tokens.surface)
    expect(themeVarsStyle(tokens)).toContain('--u-bg-white')
  })
})
