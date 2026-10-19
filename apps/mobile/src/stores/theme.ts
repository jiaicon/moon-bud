import { defineStore } from 'pinia'
import type { ThemeMode, ThemePresetId } from '@moonbud/shared'
import { applyTheme, resolveDark, THEME_MODE_STORAGE_KEY, THEME_STORAGE_KEY } from '../theme/apply-theme'
import { THEME_PRESETS } from '../theme/presets'
import { watchSystemTheme } from '../theme/system-theme'

const DEFAULT_PRESET: ThemePresetId = 'mist-blue'

// 监听是全局的，跟着模块走而不是 store 实例：store 被重建时不该再挂一层。
let stopSystemWatch: (() => void) | null = null

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
      this.watchSystemTheme()
    },

    /** 只有 auto 模式才该跟着系统走；手动选 light/dark 时监听照常挂着但什么都不做。 */
    watchSystemTheme(): void {
      if (stopSystemWatch) return
      stopSystemWatch = watchSystemTheme((dark) => {
        this.systemDark = dark
        if (this.mode !== 'auto') return
        applyTheme(this.presetId, dark, this.mode)
      })
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
