import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../api/endpoints', () => ({
  authApi: { register: vi.fn(), login: vi.fn(), refresh: vi.fn(), changePassword: vi.fn() },
  invitesApi: { accept: vi.fn() },
  familiesApi: { list: vi.fn() },
  meApi: { get: vi.fn() },
}))

import { authApi } from '../../../api/endpoints'
import { useAuthStore } from '../../../stores/auth'
import { useLoginForm } from '../use-login-form'

const login = authApi.login as unknown as ReturnType<typeof vi.fn>

const session = {
  accessToken: 'at',
  refreshToken: 'rt',
  user: { id: 'u1', username: 'mama2026', nickname: '妈妈', timezone: 'Asia/Shanghai', avatarUrl: null },
  mustChangePassword: false,
}

describe('useLoginForm.submit 的返回值', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('密码错误时返回 false，即使本地还留着上一次的会话', async () => {
    login.mockRejectedValue(new Error('账号或密码不正确'))
    const authStore = useAuthStore()
    // 刚刚注册成功、还没退出，就切到"登录"标签试另一个账号：
    // 会话是有效的，但这次登录确实失败了，页面必须停留在登录页报错。
    authStore.token = 'stale-access-token'

    const form = useLoginForm()
    form.mode.value = 'login'
    form.form.username = 'mama2026'
    form.form.password = 'wrongpassword'

    await expect(form.submit()).resolves.toBe(false)
    expect(authStore.error).toContain('账号或密码不正确')
  })

  it('登录成功时返回 true', async () => {
    login.mockResolvedValue(session)
    const form = useLoginForm()
    form.mode.value = 'login'
    form.form.username = 'mama2026'
    form.form.password = 'pass12345'

    await expect(form.submit()).resolves.toBe(true)
    expect(useAuthStore().token).toBe('at')
  })

  it('校验不通过时不发请求，直接返回 false', async () => {
    const form = useLoginForm()
    form.mode.value = 'login'
    form.form.username = 'ab'
    form.form.password = 'pass12345'

    await expect(form.submit()).resolves.toBe(false)
    expect(authApi.login).not.toHaveBeenCalled()
  })
})
