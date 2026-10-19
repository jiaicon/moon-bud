import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { DUP_WINDOW_STORAGE_KEY, useDupWindowStore } from '../dup-window'

describe('dup-window store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    uni.removeStorageSync(DUP_WINDOW_STORAGE_KEY)
  })

  it('未设置时回落到各类型的内置默认（喂奶 90）', () => {
    const s = useDupWindowStore()
    expect(s.windowFor('feeding')).toBe(90)
    expect(s.isCustomized('feeding')).toBe(false)
  })

  it('set 覆盖某类型后 windowFor 用新值，并写进本地存储', () => {
    const s = useDupWindowStore()
    s.set('feeding', 30)
    expect(s.windowFor('feeding')).toBe(30)
    expect(s.isCustomized('feeding')).toBe(true)
    const stored = uni.getStorageSync(DUP_WINDOW_STORAGE_KEY) as Record<string, number>
    expect(stored.feeding).toBe(30)
  })

  it('set 传 null 撤掉覆盖，回到默认', () => {
    const s = useDupWindowStore()
    s.set('feeding', 30)
    s.set('feeding', null)
    expect(s.windowFor('feeding')).toBe(90)
    expect(s.isCustomized('feeding')).toBe(false)
  })

  it('init 把存储里的覆盖读回状态（跨会话保留）', () => {
    uni.setStorageSync(DUP_WINDOW_STORAGE_KEY, { medicine: 60 })
    const s = useDupWindowStore()
    s.init()
    expect(s.windowFor('medicine')).toBe(60)
    expect(s.windowFor('feeding')).toBe(90)
  })

  it('存储里的脏值（非正数/非数字）被忽略', () => {
    uni.setStorageSync(DUP_WINDOW_STORAGE_KEY, { feeding: -1, sleep: 'x', diaper: 45 })
    const s = useDupWindowStore()
    s.init()
    expect(s.windowFor('feeding')).toBe(90)
    expect(s.windowFor('sleep')).toBe(60)
    expect(s.windowFor('diaper')).toBe(45)
  })
})
