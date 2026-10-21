import { beforeEach, describe, expect, it, vi } from 'vitest'
import { guardForcedChange } from '../forced-change'

/**
 * 这个守卫只看一件事：改密页在不在栈顶。旧实现用一次性布尔记"已经拦过了"，
 * 于是系统返回键把改密页退掉之后再回到首页，就再也没人来拦 —— 拿着一个
 * 随时该作废的临时密码，全家记录照样读、照样记。
 */
describe('guardForcedChange', () => {
  const navigated: string[] = []
  let stack: { route: string }[] = [{ route: 'pages/home/index' }]

  beforeEach(() => {
    navigated.length = 0
    stack = [{ route: 'pages/home/index' }]
    const uniAny = uni as unknown as { navigateTo: (o: { url: string }) => void }
    uniAny.navigateTo = (o) => navigated.push(o.url)
    ;(globalThis as Record<string, unknown>).getCurrentPages = () => stack
  })

  it('不必改密时什么都不做', () => {
    expect(guardForcedChange(false)).toBe(false)
    expect(navigated).toEqual([])
  })

  it('要改密就把人送去改密页，并说明这是被拦下来的', () => {
    expect(guardForcedChange(true)).toBe(true)
    expect(navigated).toEqual(['/pages/change-password/index?forced=1'])
  })

  it('人已经站在改密页上，就不再叠第二层（改完返回时不用退两次）', () => {
    stack = [{ route: 'pages/home/index' }, { route: 'pages/change-password/index' }]
    expect(guardForcedChange(true)).toBe(true)
    expect(navigated).toEqual([])
  })

  it('从改密页按返回键退回首页，下一次回到本页还得再拦一次', () => {
    guardForcedChange(true)
    stack = [{ route: 'pages/home/index' }]
    navigated.length = 0

    expect(guardForcedChange(true)).toBe(true)
    expect(navigated).toEqual(['/pages/change-password/index?forced=1'])
  })

  it('页面栈读不出来时宁可拦，也不放拿着临时密码的人四处走', () => {
    delete (globalThis as Record<string, unknown>).getCurrentPages
    vi.restoreAllMocks()
    expect(guardForcedChange(true)).toBe(true)
  })
})
