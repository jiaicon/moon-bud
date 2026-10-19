import type { ThemeTokens } from './tokens'
import { toCssVars } from './presets'

/**
 * uView Pro 的组件只读它自己那套 `--u-*` 变量，而 `theme.scss` 里那些值是写死的浅色。
 * 只注入 `--mb-*` 的话，深色模式下 u-popup / u-empty 这类自带表面的组件仍是白底，
 * 里面的文字却已经是深色模式的浅色墨水 —— 等于看不见。这里把同一份令牌桥接过去。
 */

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value
  const int = Number.parseInt(full, 16)
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255]
}

function triplet(hex: string): string {
  return hexToRgb(hex).join(', ')
}

/** 背景够暗就算深色版令牌；不必把 dark 布尔再传一遍，令牌本身就是唯一真相。 */
function isDark(tokens: ThemeTokens): boolean {
  const [r, g, b] = hexToRgb(tokens.background)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5
}

export function toUViewCssVars(tokens: ThemeTokens): Record<string, string> {
  const colors: Record<string, string> = {
    '--u-bg-white': tokens.surface,
    '--u-bg-color': tokens.background,
    '--u-bg-gray-light': tokens.surfaceAlt,
    '--u-bg-gray-dark': tokens.surfaceAlt,
    '--u-main-color': tokens.textPrimary,
    '--u-content-color': tokens.textSecondary,
    '--u-tips-color': tokens.textSecondary,
    '--u-light-color': tokens.textSecondary,
    '--u-border-color': tokens.border,
    '--u-divider-color': tokens.divider,
    '--u-type-primary': tokens.primary,
    '--u-type-primary-light': tokens.primaryLight,
    '--u-type-primary-dark': tokens.primary,
    '--u-type-primary-disabled': tokens.primaryLight,
    '--u-type-error': tokens.error,
    '--u-type-error-light': tokens.surfaceAlt,
    '--u-type-error-dark': tokens.error,
    '--u-type-error-disabled': tokens.surfaceAlt,
    '--u-type-success': tokens.success,
    '--u-type-success-light': tokens.surfaceAlt,
    '--u-type-success-dark': tokens.success,
    '--u-type-success-disabled': tokens.surfaceAlt,
    '--u-type-warning': tokens.warning,
    '--u-type-warning-light': tokens.surfaceAlt,
    '--u-type-warning-dark': tokens.warning,
    '--u-type-warning-disabled': tokens.surfaceAlt,
    '--u-type-info': tokens.info,
    '--u-type-info-light': tokens.surfaceAlt,
    '--u-type-info-dark': tokens.info,
    '--u-type-info-disabled': tokens.surfaceAlt,
  }

  const vars: Record<string, string> = { ...colors }
  for (const [name, value] of Object.entries(colors)) vars[`${name}-rgb`] = triplet(value)

  // 遮罩与投影不是色板成员，按明暗各给一档；浅色下保持 uView 原味的淡黑。
  vars['--u-mask-color'] = isDark(tokens) ? 'rgba(0, 0, 0, 0.68)' : 'rgba(0, 0, 0, 0.4)'
  vars['--u-shadow-color'] = isDark(tokens) ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 0, 0.1)'
  return vars
}

/**
 * 段内联用的 "a:b;c:d" 变量表。每个页面的根节点必须带上它：uView 的 theme.scss 把
 * 默认值声明在 `:root, page` 上，而 `page` 比 documentElement 离内容更近，会把只写在
 * 根元素上的值盖掉 —— 于是深色模式的弹层仍是白底。
 */
export function themeVarsStyle(tokens: ThemeTokens): string {
  return Object.entries({ ...toCssVars(tokens), ...toUViewCssVars(tokens) })
    .map(([name, value]) => `${name}:${value}`)
    .join(';')
}
