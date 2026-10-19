import { afterEach, describe, expect, it, vi } from 'vitest'
import { watchSystemTheme } from '../system-theme'

type Listener = (event: { matches: boolean }) => void

const g = globalThis as Record<string, any>
const restore: [string, unknown][] = []

function stub(key: string, value: unknown): void {
  restore.push([key, g[key]])
  g[key] = value
}

afterEach(() => {
  while (restore.length) {
    const [key, value] = restore.pop() as [string, unknown]
    g[key] = value
  }
})

describe('watchSystemTheme', () => {
  it('H5：媒体查询翻面时把 dark 传出去', () => {
    const listeners: Listener[] = []
    stub('matchMedia', () => ({
      addEventListener: (_: string, fn: Listener) => listeners.push(fn),
      removeEventListener: (_: string, fn: Listener) => listeners.splice(listeners.indexOf(fn), 1),
    }))
    const seen: boolean[] = []
    watchSystemTheme((dark) => seen.push(dark))
    listeners.forEach((fn) => fn({ matches: true }))
    expect(seen).toEqual([true])
  })

  it('APP：uni.onThemeChange 的回调按 theme 字段判断', () => {
    const handlers: ((res: { theme: string }) => void)[] = []
    stub('uni', { onThemeChange: (fn: (res: { theme: string }) => void) => handlers.push(fn) })
    const seen: boolean[] = []
    watchSystemTheme((dark) => seen.push(dark))
    handlers.forEach((fn) => fn({ theme: 'dark' }))
    expect(seen).toEqual([true])
  })

  it('解绑之后不再收到回调（页面卸载不留监听）', () => {
    const listeners: Listener[] = []
    stub('matchMedia', () => ({
      addEventListener: (_: string, fn: Listener) => listeners.push(fn),
      removeEventListener: (_: string, fn: Listener) => listeners.splice(listeners.indexOf(fn), 1),
    }))
    const spy = vi.fn()
    const stop = watchSystemTheme(spy)
    stop()
    listeners.forEach((fn) => fn({ matches: true }))
    expect(spy).not.toHaveBeenCalled()
  })

  it('两条通道都没有时不抛错（node 测试环境就是这个样子）', () => {
    stub('matchMedia', undefined)
    expect(() => watchSystemTheme(() => {})).not.toThrow()
  })
})
