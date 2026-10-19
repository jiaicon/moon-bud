import { defineStore } from 'pinia'
import { EVENT_TYPES, type EventType } from '@moonbud/shared'
import { resolveWindowMinutes, type WindowOverrides } from '../events/duplicate-window'

/**
 * 防重复提示窗口是"这台设备上的我有多敏感"的偏好，跟主题一样落在本地：
 * 提示纯由客户端算（查最近一条、比时间），没有一项别人会读到，不值得为它加
 * 后端字段和迁移。所以它也不随退出登录清除——那是设备级偏好，不是会话状态。
 */
export const DUP_WINDOW_STORAGE_KEY = 'dupWindowMinutes'

/** 只认正数分钟，脏值（0、负数、字符串）一律丢回默认，别让一次坏写入永久改变行为。 */
function sanitize(raw: unknown): WindowOverrides {
  if (!raw || typeof raw !== 'object') return {}
  const out: WindowOverrides = {}
  for (const type of EVENT_TYPES) {
    const value = (raw as Record<string, unknown>)[type]
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) out[type] = value
  }
  return out
}

export const useDupWindowStore = defineStore('dupWindow', {
  state: () => ({
    overrides: {} as WindowOverrides,
  }),

  getters: {
    windowFor: (s) => (type: EventType): number => resolveWindowMinutes(type, s.overrides),
    isCustomized: (s) => (type: EventType): boolean => {
      const value = s.overrides[type]
      return typeof value === 'number' && value > 0
    },
  },

  actions: {
    /** 冷启动：把本地存的覆盖读回状态。 */
    init(): void {
      this.overrides = sanitize(uni.getStorageSync(DUP_WINDOW_STORAGE_KEY))
    },

    /** 传 null（或非法值）即撤掉该类型的覆盖，回到内置默认。 */
    set(type: EventType, minutes: number | null): void {
      if (typeof minutes === 'number' && minutes > 0) this.overrides[type] = minutes
      else delete this.overrides[type]
      uni.setStorageSync(DUP_WINDOW_STORAGE_KEY, { ...this.overrides })
    },
  },
})
