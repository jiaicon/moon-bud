import { defineStore } from 'pinia'
import type { ThemeMode, ThemePresetId } from '@moonbud/shared'
import { THEME_MODE_STORAGE_KEY, THEME_STORAGE_KEY, applyTheme, resolveDark } from '../theme/apply-theme'
import { THEME_PRESETS } from '../theme/presets'

const DEFAULT_PRESET: ThemePresetId = 'mist-blue'

function systemDark(): boolean {
  try {
    return uni.getSystemInfoSync().theme === 'dark'
  } catch {
    return false
  }
}

export const useThemeStore = defineStore('theme', {
  state: () => ({
    presetId: DEFAULT_PRESET as ThemePresetId,
    mode: 'auto' as ThemeMode,
    systemDark: false,
  }),

  getters: {
    preset: (s) => THEME_PRESETS[s.presetId],
    isDark: (s) => resolveDark(s.mode, s.systemDark),
  },

  actions: {
    /** 冷启动：本地存的偏好优先，没有就用默认（晨雾蓝 + 跟随系统）。 */
    init(): void {
      const storedPreset = uni.getStorageSync(THEME_STORAGE_KEY)
      const storedMode = uni.getStorageSync(THEME_MODE_STORAGE_KEY)
      if (typeof storedPreset === 'string' && storedPreset in THEME_PRESETS) {
        this.presetId = storedPreset as ThemePresetId
      }
      if (storedMode === 'light' || storedMode === 'dark' || storedMode === 'auto') {
        this.mode = storedMode
      }
      this.systemDark = systemDark()
      applyTheme(this.presetId, resolveDark(this.mode, this.systemDark), this.mode)
    },

    setPreset(presetId: ThemePresetId): void {
      this.presetId = presetId
      applyTheme(presetId, resolveDark(this.mode, this.systemDark), this.mode)
    },

    setMode(mode: ThemeMode): void {
      this.mode = mode
      this.systemDark = systemDark()
      applyTheme(this.presetId, resolveDark(mode, this.systemDark), mode)
    },
  },
})
