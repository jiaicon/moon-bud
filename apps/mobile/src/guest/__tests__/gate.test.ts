import { describe, expect, it, vi } from 'vitest'
import {
  GATE_ACTION_KEYS,
  GATE_ENTRY_PATHS,
  LOGIN_ENTRY_URL,
  PUBLIC_ENTRY,
  TEACH_PATH,
  confirmLoginGate,
  gateContent,
  needsLogin,
} from '../gate'

describe('游客在"我的"点一行之后', () => {
  it('教学与主题两行免登录：它们要的是这台手机，不是账号', () => {
    for (const entry of PUBLIC_ENTRY) {
      expect(needsLogin(entry, true), entry).toBe(false)
    }
  })

  it('其余每一行在游客身上都要先问一句', () => {
    for (const entry of GATE_ENTRY_PATHS) {
      expect(needsLogin(entry, true), entry).toBe(true)
    }
  })

  it('没登记在册的页面默认也要问：漏登记比多问一次贵', () => {
    expect(needsLogin('/pages/unknown/index', true)).toBe(true)
  })

  it('登录了就不拦路，白名单内外一律放行', () => {
    for (const entry of [...GATE_ENTRY_PATHS, ...PUBLIC_ENTRY]) {
      expect(needsLogin(entry, false), entry).toBe(false)
    }
  })

  it('每一行都有一句"登录之后能得到什么"，不许是空话', () => {
    for (const entry of GATE_ENTRY_PATHS) {
      const text = gateContent(entry)
      expect(text, `${entry} 的提示没说清登录后有什么`).toMatch(/登录后|登录进来/)
      expect(text.length, entry).toBeGreaterThan(12)
    }
  })

  it('教学那一行的路由就是预览页本尊', () => {
    expect(TEACH_PATH).toBe('/pages/preview/index')
    expect(PUBLIC_ENTRY).toContain(TEACH_PATH)
  })

  /**
   * 游客现在看得到三个 Tab 页的整副骨架（切换器、筛选栏、分段、记一笔九宫格），
   * 点其中任何一处都要问一句。这一格挡的是"弹窗写着切换家庭、点的是记一笔"那种
   * 张冠李戴——每个键必须有自己的那句话，不许落到兜底文案上。
   */
  it('页内每个点不动的控件都有自己的一句，且不落到兜底文案', () => {
    const fallback = gateContent('/pages/never-registered/index')
    for (const key of GATE_ACTION_KEYS) {
      expect(needsLogin(key, true), key).toBe(true)
      expect(gateContent(key), `${key} 说的是兜底那句`).toMatch(/登录后|登录进来/)
      expect(gateContent(key), `${key} 用的是兜底文案`).not.toBe(fallback)
    }
    // 同一屏上并排的控件不许共用一句话。
    expect(new Set(GATE_ACTION_KEYS.map(gateContent)).size).toBe(GATE_ACTION_KEYS.length)
  })
})

describe('问出口之后的走法', () => {
  const navigateTo = vi.fn()
  ;(uni as unknown as { navigateTo: (o: { url: string }) => void }).navigateTo = navigateTo

  function stubModal(confirm: boolean) {
    ;(uni as unknown as {
      showModal: (o: { success?: (r: { confirm: boolean }) => void }) => void
    }).showModal = (opts) => opts.success?.({ confirm })
  }

  it('点了去登录就真的去登录页，并且带去注册那一挡', async () => {
    navigateTo.mockClear()
    stubModal(true)

    const went = await confirmLoginGate('/pages/member-list/index')

    expect(went).toBe(true)
    expect(navigateTo).toHaveBeenCalledWith({ url: LOGIN_ENTRY_URL })
    expect(LOGIN_ENTRY_URL).toContain('mode=register')
  })

  it('点了再想想就哪儿也不去', async () => {
    navigateTo.mockClear()
    stubModal(false)

    const went = await confirmLoginGate('/pages/member-list/index')

    expect(went).toBe(false)
    expect(navigateTo).not.toHaveBeenCalled()
  })

  it('平台给不出弹窗时宁可什么都不做，而不是把人扔在原地还当成功了', async () => {
    navigateTo.mockClear()
    delete (uni as unknown as { showModal?: unknown }).showModal

    const went = await confirmLoginGate('/pages/member-list/index')

    expect(went).toBe(false)
    expect(navigateTo).not.toHaveBeenCalled()
    // 后面的用例还要用 showModal
    stubModal(false)
  })
})
