import type { ThemePresetId } from '@moonbud/shared'

export type ThemeTokens = {
  primary: string
  primaryLight: string
  onPrimary: string
  success: string
  warning: string
  error: string
  background: string
  surface: string
  surfaceAlt: string
  textPrimary: string
  textSecondary: string
  textDisabled: string
  border: string
  divider: string
}

export type ThemePreset = {
  id: ThemePresetId
  name: string
  light: ThemeTokens
  dark: ThemeTokens
}

// 这两个模板只用于钉住"键必须齐全"，实际取色一律从 THEME_PRESETS 走。
export const lightTokens: ThemeTokens = {
  primary: '#000000',
  primaryLight: '#000000',
  onPrimary: '#000000',
  success: '#000000',
  warning: '#000000',
  error: '#000000',
  background: '#000000',
  surface: '#000000',
  surfaceAlt: '#000000',
  textPrimary: '#000000',
  textSecondary: '#000000',
  textDisabled: '#000000',
  border: '#000000',
  divider: '#000000',
}

export const darkTokens: ThemeTokens = { ...lightTokens }
