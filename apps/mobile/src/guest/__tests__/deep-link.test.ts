import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { blockGuestDeepLink } from '../deep-link'
import { useAuthStore } from '../../stores/auth'

/**
 * 游客可以深链进非 Tab 页（扫码落地、H5 直接把地址贴进来、以后新增的入口）。
 * 那些页一进来就发要凭证的请求，401 回来的文案是"登录已过期，请重新登录"——
 * 可他一次也没登录过，这话既撒谎又把人绕进"过期 → 首页 → 又过期"的死圈。
 * 页自己判断不了"这一趟问没问出真相"，所以判定收在这一处：先把会话问出来，
 * 只有确认是游客才送回首页（那里备好了游客骨架与登录引导）。
 */
describe('blockGuestDeepLink', () => {
  const relaunched: string[] = []
  let authStore: ReturnType<typeof useAuthStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    authStore = useAuthStore()
    relaunched.length = 0
    const uniAny = uni as unknown as { reLaunch: (o: { url: string }) => void }
    uniAny.reLaunch = (o) => relaunched.push(o.url)
  })

  it('确认是游客：送回首页，并告诉页面别再往下跑', async () => {
    authStore.token = null
    authStore.sessionResolved = true

    await expect(blockGuestDeepLink()).resolves.toBe(true)
    expect(relaunched).toEqual(['/pages/home/index'])
  })

  it('有会话：页面照常跑自己的加载', async () => {
    authStore.token = 'a-token'
    authStore.sessionResolved = true

    await expect(blockGuestDeepLink()).resolves.toBe(false)
    expect(relaunched).toEqual([])
  })

  it('冷启动时会话还没问出来：先问一次再判', async () => {
    authStore.token = null
    authStore.sessionResolved = false
    const bootstrap = vi.spyOn(authStore, 'bootstrap').mockImplementation(async () => {
      authStore.sessionResolved = true
    })

    await expect(blockGuestDeepLink()).resolves.toBe(true)
    expect(bootstrap).toHaveBeenCalledTimes(1)
    expect(relaunched).toEqual(['/pages/home/index'])
  })

  it('断网问不出真相：不算游客，也不把人送走——这一屏该说"没读到"，不是"来登录"', async () => {
    authStore.token = null
    authStore.sessionResolved = false
    vi.spyOn(authStore, 'bootstrap').mockImplementation(async () => {
      // 网络失败只把 status 变成 error，会话仍然未知
    })

    await expect(blockGuestDeepLink()).resolves.toBe(false)
    expect(relaunched).toEqual([])
  })
})
