import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/endpoints', () => ({
  authApi: { register: vi.fn(), login: vi.fn(), refresh: vi.fn(), changePassword: vi.fn(), logout: vi.fn() },
  meApi: { get: vi.fn(), update: vi.fn() },
}))

import { authApi, meApi } from '../../api/endpoints'
import { ApiRequestError } from '../../api/errors'
import { apiRequest, setAccessToken } from '../../api/http'
import type { ChildDto, FamilyDto } from '@moonbud/shared'
import { useAuthStore } from '../auth'
import { useChildStore } from '../child'
import { useFamilyStore } from '../family'

const at = 'at'
const rt = 'rt'
const loginResult = {
  accessToken: at,
  refreshToken: rt,
  user: { id: 'u1', username: 'mama2024', nickname: '妈妈', timezone: 'Asia/Shanghai', avatarUrl: null },
  mustChangePassword: false,
}

const familyFixture: FamilyDto = { id: 'f1', name: '一个家', ownerId: 'u1', role: 'OWNER', archivedAt: null }
const childFixture: ChildDto = {
  id: 'c1',
  familyId: 'f1',
  name: '小雨',
  gender: 'FEMALE',
  birthday: '2025-01-01',
  avatarUrl: null,
  archivedAt: null,
}

/** 把"这个账号在这台机器上看过的家与孩子"摆满，内存和盘上都有。 */
function seedFamilyAndChild() {
  const familyStore = useFamilyStore()
  const childStore = useChildStore()
  familyStore.families = [familyFixture]
  familyStore.switchFamily(familyFixture.id)
  childStore.childrenByFamily = { f1: [childFixture] }
  childStore.select(familyFixture.id, childFixture.id)
  return familyStore
}

/** 游客不该拿着上一个账号的名单，也不该在盘上留着选中项让下次冷启动捡回来。 */
function expectFamilyAndChildCleared(familyStore: ReturnType<typeof useFamilyStore>) {
  const childStore = useChildStore()
  expect(familyStore.families).toEqual([])
  expect(familyStore.currentFamilyId).toBeNull()
  expect(uni.getStorageSync('currentFamilyId')).toBe('')
  expect(childStore.childrenByFamily).toEqual({})
  expect(childStore.currentChildIdByFamily).toEqual({})
  expect(uni.getStorageSync('currentChildIdByFamily')).toEqual({})
}

describe('auth store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    uni.setStorageSync('refreshToken', '')
    // 家庭/孩子的选中项存在设备级 storage 里，不清会让下一家用例一建 store 就捡到上一家的 id。
    uni.setStorageSync('currentFamilyId', '')
    uni.setStorageSync('currentChildIdByFamily', '')
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

  it('登出把上一个账号的家庭与孩子一起清掉，内存和盘上都算清干净', async () => {
    ;(authApi.login as ReturnType<typeof vi.fn>).mockResolvedValue(loginResult)
    const store = useAuthStore()
    await store.login('mama2024', 'pass12345')
    const familyStore = seedFamilyAndChild()

    await store.logout()

    expectFamilyAndChildCleared(familyStore)
  })

  it('会话过期把人放回游客态时，也必须清掉上一个账号的家庭与孩子', () => {
    const store = useAuthStore()
    store.token = at
    store.user = loginResult.user
    const familyStore = seedFamilyAndChild()

    store.handleSessionExpired()

    expectFamilyAndChildCleared(familyStore)
  })

  it('冷启动发现凭证已废之后，游客页上不该还留着上一份家庭名单', async () => {
    uni.setStorageSync('refreshToken', 'rt-old')
    ;(authApi.refresh as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('登录已过期'))
    const store = useAuthStore()
    const familyStore = seedFamilyAndChild()

    await store.bootstrap()

    expectFamilyAndChildCleared(familyStore)
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

  it('冷启动时只是连不上服务器，不许把用户登出', async () => {
    // 离线不是凭证过期。把这两件事混掉，家长断网重开一次应用就要重新登录，
    // 而那条 refresh token 服务端其实还认——清掉等于自己把自己踢出去。
    uni.setStorageSync('refreshToken', 'rt-old')
    setAccessToken(at)
    ;(authApi.refresh as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiRequestError('网络连接失败，请检查网络后重试', 0, true),
    )
    const store = useAuthStore()
    await store.bootstrap()
    expect(uni.getStorageSync('refreshToken')).toBe('rt-old')
    expect(uni.getStorageSync('accessToken')).toBe(at)
    // 但这一趟确实没成：状态要留在 error，页面才知道"还没读到用户"。
    expect(store.status).toBe('error')
  })

  it('会话还没问出来时不是游客', () => {
    // isLoggedIn 读的是内存态。冷启动那一瞬它是 false，而真相是"还不知道"：
    // 这时把页面演成游客空状态，老用户每次打开都会先被问一次"要不要登录"。
    const store = useAuthStore()
    expect(store.session).toBe('unknown')
    expect(store.isGuest).toBe(false)
  })

  it('本地没有 refresh token 的冷启动就是游客', async () => {
    const store = useAuthStore()
    await store.bootstrap()
    expect(store.session).toBe('guest')
    expect(store.isGuest).toBe(true)
  })

  it('静默登录换回会话后是成员', async () => {
    uni.setStorageSync('refreshToken', rt)
    ;(authApi.refresh as ReturnType<typeof vi.fn>).mockResolvedValue({
      accessToken: at,
      refreshToken: 'rt-2',
    })
    ;(meApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: loginResult.user,
      mustChangePassword: false,
    })
    const store = useAuthStore()
    await store.bootstrap()
    expect(store.session).toBe('member')
    expect(store.isGuest).toBe(false)
  })

  it('登录成功当场就是成员，不必再等一次冷启动', async () => {
    ;(authApi.login as ReturnType<typeof vi.fn>).mockResolvedValue(loginResult)
    const store = useAuthStore()
    await store.login('mama2024', 'pass12345')
    expect(store.session).toBe('member')
  })

  it('连不上服务器时仍不是游客：那一趟问不出真相', async () => {
    uni.setStorageSync('refreshToken', 'rt-old')
    ;(authApi.refresh as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiRequestError('网络连接失败，请检查网络后重试', 0, true),
    )
    const store = useAuthStore()
    await store.bootstrap()
    expect(store.session).toBe('unknown')
    expect(store.isGuest).toBe(false)
  })

  it('凭证过期把会话清掉之后是游客', async () => {
    uni.setStorageSync('refreshToken', 'rt-old')
    ;(authApi.refresh as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('登录已过期'))
    const store = useAuthStore()
    await store.bootstrap()
    expect(store.session).toBe('guest')
  })

  it('主动退出之后也是游客', async () => {
    ;(authApi.login as ReturnType<typeof vi.fn>).mockResolvedValue(loginResult)
    const store = useAuthStore()
    await store.login('mama2024', 'pass12345')
    await store.logout()
    expect(store.session).toBe('guest')
  })

  it('会话失效时清掉本地会话，把人放回首页的游客态并说一句为什么', () => {
    const reLaunched: string[] = []
    const toasts: string[] = []
    const uniAny = uni as unknown as {
      reLaunch: (o: { url: string }) => void
      showToast: (o: { title: string }) => void
    }
    uniAny.reLaunch = (o) => reLaunched.push(o.url)
    uniAny.showToast = (o) => toasts.push(o.title)
    const store = useAuthStore()
    store.token = at
    store.user = loginResult.user

    store.handleSessionExpired()

    expect(store.token).toBeNull()
    expect(store.user).toBeNull()
    expect(reLaunched).toEqual(['/pages/home/index'])
    expect(toasts).toEqual(['登录已过期，重新登录就能接着记。'])
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

  it('装配之后，带鉴权的请求 401 且续期救不回来就落到首页游客态', async () => {
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

    expect(reLaunched).toEqual(['/pages/home/index'])
  })
})
