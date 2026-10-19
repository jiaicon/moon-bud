import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/endpoints', () => ({
  authApi: { register: vi.fn(), login: vi.fn(), refresh: vi.fn(), changePassword: vi.fn(), logout: vi.fn() },
  meApi: { get: vi.fn(), update: vi.fn() },
}))

import { authApi, meApi } from '../../api/endpoints'
import { apiRequest, setAccessToken } from '../../api/http'
import { useAuthStore } from '../auth'

const at = 'at'
const rt = 'rt'
const loginResult = {
  accessToken: at,
  refreshToken: rt,
  user: { id: 'u1', username: 'mama2024', nickname: '妈妈', timezone: 'Asia/Shanghai', avatarUrl: null },
  mustChangePassword: false,
}

describe('auth store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    uni.setStorageSync('refreshToken', '')
  })

  it('登录失败时记录可读错误且不写入 token', async () => {
    ;(authApi.login as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('账号或密码不正确'))
    const store = useAuthStore()
    await store.login('mama2024', 'wrongpass')
    expect(store.token).toBeNull()
    expect(store.status).toBe('error')
    expect(store.error).toContain('账号或密码不正确')
  })

  it('登录成功后写入 token 与用户并持久化 refresh token', async () => {
    ;(authApi.login as ReturnType<typeof vi.fn>).mockResolvedValue(loginResult)
    const store = useAuthStore()
    await store.login('mama2024', 'pass12345')
    expect(store.token).toBe(at)
    expect(store.user?.nickname).toBe('妈妈')
    expect(uni.getStorageSync('refreshToken')).toBe(rt)
  })

  it('会话一建立就清掉"看过预览"的标记：注册过的人不该再被当游客催注册', async () => {
    uni.setStorageSync('previewVisited', '1')
    ;(authApi.login as ReturnType<typeof vi.fn>).mockResolvedValue(loginResult)
    const store = useAuthStore()
    await store.login('mama2024', 'pass12345')
    expect(uni.getStorageSync('previewVisited')).toBe('')
  })

  it('登出清空全部本地会话状态', async () => {
    ;(authApi.login as ReturnType<typeof vi.fn>).mockResolvedValue(loginResult)
    const store = useAuthStore()
    await store.login('mama2024', 'pass12345')
    await store.logout()
    expect(store.token).toBeNull()
    expect(store.user).toBeNull()
    expect(uni.getStorageSync('refreshToken')).toBe('')
  })

  it('登出撤销上一个账号排下的本地通知：换账号登录不该再收到别人家的推送', async () => {
    uni.setStorageSync('localNotifications', {
      'r-1': { id: 'r-1', title: '喂药', body: '该喂药了', at: Date.now() + 3_600_000 },
    })
    ;(authApi.login as ReturnType<typeof vi.fn>).mockResolvedValue(loginResult)
    const store = useAuthStore()
    await store.login('mama2024', 'pass12345')
    await store.logout()
    expect(uni.getStorageSync('localNotifications')).toBe('')
  })

  it('改时区成功后把服务端返回的新用户写回 store：全屏的钟点都读这一个值', async () => {
    ;(authApi.login as ReturnType<typeof vi.fn>).mockResolvedValue(loginResult)
    const store = useAuthStore()
    await store.login('mama2024', 'pass12345')

    const next = { ...loginResult.user, timezone: 'Asia/Kolkata' }
    ;(meApi.update as ReturnType<typeof vi.fn>).mockResolvedValue(next)
    const ok = await store.updateTimezone('Asia/Kolkata')

    expect(ok).toBe(true)
    expect(meApi.update).toHaveBeenCalledWith('Asia/Kolkata')
    expect(store.user?.timezone).toBe('Asia/Kolkata')
  })

  it('改时区失败时保留原值并给出可读错误：界面不能先显示一个没保存上的时区', async () => {
    ;(authApi.login as ReturnType<typeof vi.fn>).mockResolvedValue(loginResult)
    const store = useAuthStore()
    await store.login('mama2024', 'pass12345')

    ;(meApi.update as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('时区必须是合法的 IANA 名称，例如 Asia/Shanghai'))
    const ok = await store.updateTimezone('Mars/Olympus')

    expect(ok).toBe(false)
    expect(store.user?.timezone).toBe('Asia/Shanghai')
    expect(store.error).toContain('时区')
  })

  it('bootstrap 在无本地 refresh token 时保持未登录且不报错', async () => {
    const store = useAuthStore()
    await store.bootstrap()
    expect(store.status).toBe('idle')
    expect(store.token).toBeNull()
    expect(authApi.refresh).not.toHaveBeenCalled()
  })

  it('bootstrap 从 /me 恢复强制改密标记：刷新页面后守卫仍然拦得住', async () => {
    uni.setStorageSync('refreshToken', rt)
    ;(authApi.refresh as ReturnType<typeof vi.fn>).mockResolvedValue({ accessToken: at, refreshToken: rt })
    ;(meApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: loginResult.user,
      families: [],
      mustChangePassword: true,
    })
    const store = useAuthStore()
    await store.bootstrap()
    expect(store.mustChangePassword).toBe(true)
  })

  it('bootstrap 在飞时后来者并入同一次：页面等会话不该把冷启动的 /me 翻倍', async () => {
    uni.setStorageSync('refreshToken', rt)
    ;(authApi.refresh as ReturnType<typeof vi.fn>).mockResolvedValue({ accessToken: at, refreshToken: rt })
    ;(meApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: loginResult.user,
      families: [],
      mustChangePassword: false,
    })
    const store = useAuthStore()

    await Promise.all([store.bootstrap(), store.bootstrap()])

    expect(meApi.get).toHaveBeenCalledTimes(1)
    expect(store.isLoggedIn).toBe(true)
  })

  it('bootstrap 失败时若 refresh token 已被别的续期换掉，就不清会话', async () => {
    uni.setStorageSync('refreshToken', 'rt-old')
    ;(authApi.refresh as ReturnType<typeof vi.fn>).mockResolvedValue({
      accessToken: 'at-new',
      refreshToken: 'rt-new',
    })
    ;(meApi.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('网络错误'))
    const store = useAuthStore()
    await store.bootstrap()
    // 服务端此时认的是 rt-new：清会话等于自己把用户登出（评审 C-3 的实测路径）。
    expect(uni.getStorageSync('refreshToken')).toBe('rt-new')
    expect(store.token).toBe('at-new')
    expect(store.status).toBe('error')
  })

  it('bootstrap 失败且凭证没变（真的过期）时清空会话', async () => {
    uni.setStorageSync('refreshToken', 'rt-old')
    ;(authApi.refresh as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('登录已过期'))
    const store = useAuthStore()
    await store.bootstrap()
    expect(store.token).toBeNull()
    expect(uni.getStorageSync('refreshToken')).toBe('')
  })

  it('会话失效时清掉本地会话并带回欢迎页', () => {
    const reLaunched: string[] = []
    ;(uni as unknown as { reLaunch: (o: { url: string }) => void }).reLaunch = (o) => reLaunched.push(o.url)
    const store = useAuthStore()
    store.token = at
    store.user = loginResult.user

    store.handleSessionExpired()

    expect(store.token).toBeNull()
    expect(store.user).toBeNull()
    expect(reLaunched).toEqual(['/pages/welcome/index?expired=1'])
  })

  it('主动退出后，在飞的请求失败不该再报"登录已过期"', async () => {
    const reLaunched: string[] = []
    ;(uni as unknown as { reLaunch: (o: { url: string }) => void }).reLaunch = (o) => reLaunched.push(o.url)
    const store = useAuthStore()
    store.ensureRefreshHandler()
    ;(authApi.login as ReturnType<typeof vi.fn>).mockResolvedValue(loginResult)
    await store.login('mama2024', 'pass12345')
    store.token = null

    await store.logout()

    const uniAny = globalThis as unknown as { uni: Record<string, unknown> }
    const original = uniAny.uni.request
    uniAny.uni.request = (opts: { success: (res: unknown) => void }) =>
      opts.success({ statusCode: 401, data: { statusCode: 401, message: 'Unauthorized' } })
    await expect(apiRequest('/me')).rejects.toThrow(/登录/)
    uniAny.uni.request = original

    expect(reLaunched).toEqual([])
  })

  it('装配之后，带鉴权的请求 401 且续期救不回来就自动回到欢迎页', async () => {
    const reLaunched: string[] = []
    ;(uni as unknown as { reLaunch: (o: { url: string }) => void }).reLaunch = (o) => reLaunched.push(o.url)
    uni.setStorageSync('refreshToken', '')
    const store = useAuthStore()
    store.ensureRefreshHandler()
    setAccessToken('stale-at')

    const uniAny = globalThis as unknown as { uni: Record<string, unknown> }
    const original = uniAny.uni.request
    uniAny.uni.request = (opts: { success: (res: unknown) => void }) =>
      opts.success({ statusCode: 401, data: { statusCode: 401, message: 'Unauthorized' } })
    await expect(apiRequest('/me')).rejects.toThrow(/登录/)
    uniAny.uni.request = original
    setAccessToken(null)

    expect(reLaunched).toEqual(['/pages/welcome/index?expired=1'])
  })
})
