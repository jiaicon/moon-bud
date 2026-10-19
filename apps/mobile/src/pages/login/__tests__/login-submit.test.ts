import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../api/endpoints', () => ({
  authApi: { register: vi.fn(), login: vi.fn(), refresh: vi.fn(), changePassword: vi.fn() },
  invitesApi: { accept: vi.fn() },
  familiesApi: { list: vi.fn() },
  meApi: { get: vi.fn() },
}))

import { authApi, familiesApi, invitesApi } from '../../../api/endpoints'
import { ApiRequestError } from '../../../api/errors'
import { useAuthStore } from '../../../stores/auth'
import { useFamilyStore } from '../../../stores/family'
import { useLoginForm } from '../use-login-form'

const login = authApi.login as unknown as ReturnType<typeof vi.fn>
const register = authApi.register as unknown as ReturnType<typeof vi.fn>
const accept = invitesApi.accept as unknown as ReturnType<typeof vi.fn>

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

  it('加入家庭成功后选中项就落到那个家庭，不靠"当前 id 失效才回退"', async () => {
    // 手里已经选中着别的家庭的人加入新家庭后，若还停在旧家庭，他会以为自己没加进去。
    uni.setStorageSync('currentFamilyId', 'f-old')
    register.mockResolvedValue(session)
    accept.mockResolvedValue({ id: 'f-new', name: '新家庭', ownerId: 'u9', role: 'MEMBER', archivedAt: null })
    ;(familiesApi.list as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'f-old', name: '旧家庭', ownerId: 'u1', role: 'OWNER', archivedAt: null },
      { id: 'f-new', name: '新家庭', ownerId: 'u9', role: 'MEMBER', archivedAt: null },
    ])

    const form = useLoginForm()
    form.mode.value = 'join'
    form.form.username = 'mama2026'
    form.form.password = 'pass12345'
    form.form.nickname = '妈妈'
    form.form.inviteCode = 'abcd2345'

    await expect(form.submit()).resolves.toBe(true)
    expect(accept).toHaveBeenCalledWith('ABCD2345')
    expect(useFamilyStore().currentFamilyId).toBe('f-new')
    expect(uni.getStorageSync('currentFamilyId')).toBe('f-new')
  })

  it('账号早就存在时，加入家庭改用现有账号登录，不把邀请码丢掉', async () => {
    // 家人扫进来的人十有八九上月就注册过了。停在"该账号已被使用"里，
    // 他既登不进去也得重新去翻邀请码。
    register.mockRejectedValue(new ApiRequestError('该账号已被使用', 409))
    login.mockResolvedValue(session)
    accept.mockResolvedValue({ id: 'f-new', name: '新家庭', ownerId: 'u9', role: 'MEMBER', archivedAt: null })
    ;(familiesApi.list as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'f-new', name: '新家庭', ownerId: 'u9', role: 'MEMBER', archivedAt: null },
    ])

    const form = useLoginForm()
    form.mode.value = 'join'
    form.form.username = 'mama2026'
    form.form.password = 'pass12345'
    form.form.nickname = '妈妈'
    form.form.inviteCode = 'abcd2345'

    await expect(form.submit()).resolves.toBe(true)
    expect(login).toHaveBeenCalledWith('mama2026', 'pass12345')
    expect(accept).toHaveBeenCalledWith('ABCD2345')
    expect(form.usedExistingAccount.value).toBe(true)
  })

  it('账号已存在、密码又不对时返回 false，并报登录那句文案', async () => {
    register.mockRejectedValue(new ApiRequestError('该账号已被使用', 409))
    login.mockRejectedValue(new ApiRequestError('账号或密码不正确', 401))

    const form = useLoginForm()
    form.mode.value = 'join'
    form.form.username = 'mama2026'
    form.form.password = 'wrongpassword'
    form.form.nickname = '妈妈'
    form.form.inviteCode = 'abcd2345'

    await expect(form.submit()).resolves.toBe(false)
    expect(useAuthStore().error).toContain('账号或密码不正确')
    expect(form.usedExistingAccount.value).toBe(false)
    expect(accept).not.toHaveBeenCalled()
  })

  it('不是撞账号的失败不会顺带去登录', async () => {
    register.mockRejectedValue(new ApiRequestError('服务暂时不可用，请稍后重试', 503))

    const form = useLoginForm()
    form.mode.value = 'register'
    form.form.username = 'mama2026'
    form.form.password = 'pass12345'
    form.form.nickname = '妈妈'

    await expect(form.submit()).resolves.toBe(false)
    expect(login).not.toHaveBeenCalled()
  })
})
