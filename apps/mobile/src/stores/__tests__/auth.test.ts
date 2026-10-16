import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/endpoints', () => ({
  authApi: { register: vi.fn(), login: vi.fn(), refresh: vi.fn(), changePassword: vi.fn() },
  meApi: { get: vi.fn() },
}))

import { authApi } from '../../api/endpoints'
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
})
