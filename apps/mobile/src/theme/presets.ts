import type { ThemePresetId, ThemeMode } from '@moonbud/shared'
import { lightTokens, darkTokens, type ThemePreset, type ThemeTokens } from './tokens'

export { lightTokens, darkTokens }
export type { ThemeTokens, ThemePreset }

const full = (id: ThemePresetId, name: string, light: ThemeTokens, dark: ThemeTokens): ThemePreset => ({
  id,
  name,
  light,
  dark,
})

export const THEME_PRESETS: Record<ThemePresetId, ThemePreset> = {
  'mist-blue': full(
    'mist-blue',
    '晨雾蓝',
    {
      primary: '#3F76B0',
      primaryLight: '#B7CEE6',
      onPrimary: '#FFFFFF',
      success: '#4C9A6A',
      warning: '#D9A441',
      error: '#C25B57',
      background: '#F2F6FA',
      surface: '#FFFFFF',
      surfaceAlt: '#E7EEF5',
      textPrimary: '#1F2A35',
      textSecondary: '#5B6B7A',
      textDisabled: '#A7B4C0',
      border: '#CBD8E3',
      divider: '#E2EAF1',
    },
    {
      primary: '#7FA8D9',
      primaryLight: '#3D5A7A',
      onPrimary: '#12171C',
      success: '#6FB98A',
      warning: '#E5C078',
      error: '#E08A85',
      background: '#12171C',
      surface: '#1B222A',
      surfaceAlt: '#242E38',
      textPrimary: '#E6EDF3',
      textSecondary: '#A2B0BC',
      textDisabled: '#5D6A76',
      border: '#313D49',
      divider: '#28323C',
    },
  ),
  'cream-orange': full(
    'cream-orange',
    '奶油橘',
    {
      primary: '#D98E4A',
      primaryLight: '#F3D2AE',
      onPrimary: '#3A2E22',
      success: '#5E9A5E',
      warning: '#D9A441',
      error: '#C25B57',
      background: '#FBF4EA',
      surface: '#FFFFFF',
      surfaceAlt: '#F3E7D6',
      textPrimary: '#3A2E22',
      textSecondary: '#7A6A58',
      textDisabled: '#B8A894',
      border: '#E4D3BA',
      divider: '#EFE2CF',
    },
    {
      primary: '#E8A768',
      primaryLight: '#6B4E2E',
      onPrimary: '#191410',
      success: '#7CB87C',
      warning: '#E5C078',
      error: '#E08A85',
      background: '#191410',
      surface: '#241D16',
      surfaceAlt: '#2F261D',
      textPrimary: '#F2E9DD',
      textSecondary: '#BCAA94',
      textDisabled: '#6E6154',
      border: '#3D3327',
      divider: '#322921',
    },
  ),
  'mint-green': full(
    'mint-green',
    '薄荷绿',
    {
      primary: '#4CA87C',
      primaryLight: '#B6E2CD',
      onPrimary: '#1C2E25',
      success: '#4C9A6A',
      warning: '#D9A441',
      error: '#C25B57',
      background: '#F1F8F4',
      surface: '#FFFFFF',
      surfaceAlt: '#E2F0E8',
      textPrimary: '#1C2E25',
      textSecondary: '#55705F',
      textDisabled: '#A0B8AB',
      border: '#C6E0D1',
      divider: '#DCEDE4',
    },
    {
      primary: '#6FC79C',
      primaryLight: '#2F5A46',
      onPrimary: '#101713',
      success: '#6FB98A',
      warning: '#E5C078',
      error: '#E08A85',
      background: '#101713',
      surface: '#17211C',
      surfaceAlt: '#1F2B24',
      textPrimary: '#E4F1E9',
      textSecondary: '#9DB8AA',
      textDisabled: '#5A6B62',
      border: '#2B3831',
      divider: '#23302A',
    },
  ),
  'dusk-purple': full(
    'dusk-purple',
    '暮色紫',
    {
      primary: '#7B5FA6',
      primaryLight: '#CDBDE6',
      onPrimary: '#FFFFFF',
      success: '#4C9A6A',
      warning: '#D9A441',
      error: '#C25B57',
      background: '#F5F2FA',
      surface: '#FFFFFF',
      surfaceAlt: '#EBE4F5',
      textPrimary: '#2A2233',
      textSecondary: '#6A5D78',
      textDisabled: '#B0A5BC',
      border: '#D8CDE8',
      divider: '#E8E1F1',
    },
    {
      primary: '#A98BD4',
      primaryLight: '#4A3C63',
      onPrimary: '#151219',
      success: '#6FB98A',
      warning: '#E5C078',
      error: '#E08A85',
      background: '#151219',
      surface: '#1E1A24',
      surfaceAlt: '#27222F',
      textPrimary: '#EDE7F5',
      textSecondary: '#B2A6C2',
      textDisabled: '#655C72',
      border: '#362F42',
      divider: '#2D2738',
    },
  ),
}

export function tokenNames(): (keyof ThemeTokens)[] {
  return Object.keys(lightTokens) as (keyof ThemeTokens)[]
}

const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

export function toCssVars(tokens: ThemeTokens): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of tokenNames()) {
    out[`--mb-color-${kebab(name)}`] = tokens[name]
  }
  return out
}

export function resolveDark(mode: ThemeMode, systemDark: boolean): boolean {
  if (mode === 'auto') return systemDark
  return mode === 'dark'
}
