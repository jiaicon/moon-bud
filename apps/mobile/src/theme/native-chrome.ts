import type { ThemeTokens } from './tokens'

/**
 * pages.json 里的 tabBar / navigationBar 是构建期常量，主题切换改不动它们：
 * 深色模式下上下两条栏仍是白底，而内容已经是深色 —— 等于两条刺眼的白带。
 * 这里按当前令牌把颜色算出来，交给 uni 的两个原生 API 覆盖。
 */

function channelLum(hex: string, i: number): number {
  const s = parseInt(hex.slice(i, i + 2), 16) / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  return 0.2126 * channelLum(hex, 1) + 0.7152 * channelLum(hex, 3) + 0.0722 * channelLum(hex, 5)
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

function toHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, l]
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [(h * 60 + 360) % 360, s, l]
}

function toHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  const p = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${p(r)}${p(g)}${p(b)}`.toUpperCase()
}

/**
 * 只调明度不改色相：主色在 tabBar 上仍然是那套预设的颜色，
 * 只是被推到能读的那一档。奶油橘那种亮橘在白底上只有约 2.9 的对比，
 * 直接用就成了"看得见色块、看不清字"。
 */
export function ensureContrast(foreground: string, background: string, minimum = 4.5): string {
  if (contrastRatio(foreground, background) >= minimum) return foreground.toUpperCase()
  const [h, s] = toHsl(foreground)
  const lighten = luminance(background) < 0.5
  for (let step = 1; step <= 50; step++) {
    const l = Math.min(0.97, Math.max(0.03, lighten ? 0.5 + step * 0.01 : 0.5 - step * 0.01))
    const candidate = toHex(h, s, l)
    if (contrastRatio(candidate, background) >= minimum) return candidate
  }
  return lighten ? '#FFFFFF' : '#000000'
}

export function navigationBarStyle(tokens: ThemeTokens): { frontColor: '#000000' | '#ffffff'; backgroundColor: string } {
  // uni 的 frontColor 只认这两个字面量，给渐变或给令牌都不生效。
  return {
    frontColor: luminance(tokens.background) < 0.5 ? '#ffffff' : '#000000',
    backgroundColor: tokens.background.toUpperCase(),
  }
}

export function tabBarStyle(
  tokens: ThemeTokens,
): { color: string; selectedColor: string; backgroundColor: string; borderColor: string } {
  const backgroundColor = tokens.surface.toUpperCase()
  return {
    color: ensureContrast(tokens.textSecondary, backgroundColor),
    selectedColor: ensureContrast(tokens.primary, backgroundColor),
    backgroundColor,
    borderColor: tokens.border.toUpperCase(),
  }
}

export function applyNativeChrome(tokens: ThemeTokens): void {
  const uniApi = (globalThis as Record<string, any>).uni
  try {
    uniApi?.setNavigationBarColor?.(navigationBarStyle(tokens))
  } catch {
    /* 自定义导航栏的页面没有原生标题栏，覆盖不了就算了 */
  }
  try {
    // 非 tab 页里这个调用会失败；失败也必须安静，不能让主题切换把页面搞崩。
    uniApi?.setTabBarStyle?.({ ...tabBarStyle(tokens), fail: () => {} })
  } catch {
    /* 同上 */
  }
}
