import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/endpoints', () => ({
  authApi: { register: vi.fn(), login: vi.fn(), refresh: vi.fn(), changePassword: vi.fn() },
  meApi: { get: vi.fn() },
}))

import { authApi, meApi } from '../../api/endpoints'
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
})
