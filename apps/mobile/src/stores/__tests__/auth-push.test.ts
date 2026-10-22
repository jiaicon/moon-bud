import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/endpoints', () => ({
  authApi: { register: vi.fn(), login: vi.fn(), refresh: vi.fn(), changePassword: vi.fn(), logout: vi.fn() },
  meApi: { get: vi.fn(), update: vi.fn() },
}))

vi.mock('../../notifications/push-client', () => ({
  registerPushClient: vi.fn(),
  unregisterPushClient: vi.fn(),
  startPushClickHandler: vi.fn(),
}))

import { authApi } from '../../api/endpoints'
import { registerPushClient, unregisterPushClient } from '../../notifications/push-client'
import { useAuthStore } from '../auth'

const loginResult = {
  accessToken: 'at',
  refreshToken: 'rt',
  user: { id: 'u1', username: 'mama2024', nickname: '妈妈', timezone: 'Asia/Shanghai', avatarUrl: null },
  mustChangePassword: false,
}

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

describe('会话与推送设备登记', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    uni.setStorageSync('refreshToken', '')
    asMock(unregisterPushClient).mockResolvedValue(undefined)
  })

  it('换到新会话就把这台设备的 cid 报上去', async () => {
    asMock(registerPushClient).mockResolvedValue('CID_A')
    asMock(authApi.login).mockResolvedValue(loginResult)

    expect(await useAuthStore().login('mama2024', 'pass12345')).toBe(true)
    // 上报是 fire-and-forget：让登录等一次 cid 往返，等于把推送的可用性
    // 塞进登录的成功条件里。等一个微任务让那条 promise 落地。
    await Promise.resolve()

    expect(registerPushClient).toHaveBeenCalledTimes(1)
  })

  it('上报失败也不算登录失败', async () => {
    asMock(registerPushClient).mockResolvedValue(null)
    asMock(authApi.login).mockResolvedValue(loginResult)

    const store = useAuthStore()
    await expect(store.login('mama2024', 'pass12345')).resolves.toBe(true)
    await Promise.resolve()

    expect(store.token).toBe('at')
  })

  it('退出登录时注销这台设备', async () => {
    asMock(registerPushClient).mockResolvedValue('CID_A')
    asMock(authApi.login).mockResolvedValue(loginResult)
    asMock(authApi.logout).mockResolvedValue(undefined)

    const store = useAuthStore()
    await store.login('mama2024', 'pass12345')
    await store.logout()

    expect(unregisterPushClient).toHaveBeenCalledTimes(1)
  })

  it('注销请求发出时凭证还在', async () => {
    // DELETE 是要鉴权的：clearSession 若先把 token 清掉再注销，这条请求必然 401，
    // 服务端那行设备记录就永远留在原地——同一台手机上换账号，下一个人还会替上一个人收推送。
    const tokenWhenUnregistered: unknown[] = []
    asMock(registerPushClient).mockResolvedValue('CID_A')
    asMock(authApi.login).mockResolvedValue(loginResult)
    asMock(authApi.logout).mockResolvedValue(undefined)
    asMock(unregisterPushClient).mockImplementation(async () => {
      tokenWhenUnregistered.push(uni.getStorageSync('accessToken'))
    })

    const store = useAuthStore()
    await store.login('mama2024', 'pass12345')
    await store.logout()

    expect(tokenWhenUnregistered).toEqual(['at'])
  })
})
