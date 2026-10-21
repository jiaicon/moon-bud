import { beforeEach, describe, expect, it, vi } from 'vitest'
import { stepBack } from '../back-nav'

/**
 * "返回"必须真的把人退出去。uni.navigateBack() 在页面栈只剩这一页时什么都不做——
 * 而深链、扫码落地、冷启动直接打开一个表单，都会造成那种栈形。
 * 那时的表现是：点保存，toast 一闪，人还停在原地，以为没保存上（其实已经存好了）。
 */
describe('stepBack', () => {
  const calls: string[] = []
  let stack: unknown[] = [{}]

  beforeEach(() => {
    calls.length = 0
    stack = [{}]
    const uniAny = uni as unknown as {
      navigateBack: () => void
      reLaunch: (o: { url: string }) => void
    }
    uniAny.navigateBack = () => calls.push('back')
    uniAny.reLaunch = (o) => calls.push(`relaunch:${o.url}`)
    ;(globalThis as Record<string, unknown>).getCurrentPages = () => stack
  })

  it('后面还有页面：照原样退一层', () => {
    stack = [{}, {}]
    stepBack()
    expect(calls).toEqual(['back'])
  })

  it('退无可退：落回首页，而不是把人留在原地', () => {
    stack = [{}]
    stepBack()
    expect(calls).toEqual(['relaunch:/pages/home/index'])
  })

  it('页面栈读不出来时按最保守的走法：送去首页', () => {
    delete (globalThis as Record<string, unknown>).getCurrentPages
    stepBack()
    expect(calls).toEqual(['relaunch:/pages/home/index'])
  })

  it('调用方可以指定落点（比如从提醒中心跳回来的那一趟）', () => {
    stack = [{}]
    stepBack('/pages/reminder-list/index')
    expect(calls).toEqual(['relaunch:/pages/reminder-list/index'])
  })

  it('栈里页数读成 0 时也不算"能退"', () => {
    stack = []
    stepBack()
    expect(calls).toEqual(['relaunch:/pages/home/index'])
    vi.restoreAllMocks()
  })
})
