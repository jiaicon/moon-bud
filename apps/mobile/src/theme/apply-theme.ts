import type { ThemePresetId, ThemeMode } from '@moonbud/shared'
import { THEME_PRESETS, resolveDark, toCssVars } from './presets'
import { toUViewCssVars } from './uview-bridge'

export const THEME_STORAGE_KEY = 'theme'
export const THEME_MODE_STORAGE_KEY = 'themeMode'
export const THEME_VARS_STORAGE_KEY = 'themeVars'

function persist(vars: Record<string, string>): void {
  // #ifdef H5
  if (typeof document !== 'undefined') {
    const style = document.documentElement.style
    for (const [name, value] of Object.entries(vars)) style.setProperty(name, value)
  }
  // #endif
  // #ifndef H5
  // 小程序与 APP 端没有 document，全局 CSS 变量也无法注入，因此把变量表落到 storage，
  // 由根组件（App.vue 的根 view）用 :style 绑定注入 —— 跨端唯一的可行做法。
  if (typeof uni !== 'undefined') uni.setStorageSync(THEME_VARS_STORAGE_KEY, vars)
  // #endif
}

export function applyTheme(
  presetId: ThemePresetId,
  dark: boolean,
  mode: ThemeMode = dark ? 'dark' : 'light',
): void {
  const preset = THEME_PRESETS[presetId]
  const tokens = dark ? preset.dark : preset.light
  persist({ ...toCssVars(tokens), ...toUViewCssVars(tokens) })
  if (typeof uni !== 'undefined') {
    uni.setStorageSync(THEME_STORAGE_KEY, presetId)
    uni.setStorageSync(THEME_MODE_STORAGE_KEY, mode)
  }
}

export { resolveDark }
