import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiRequestError, normalizeError } from '../errors'
import { buildUrl, shouldRetryAfterRefresh } from '../http'

describe('buildUrl', () => {
  it('拼接 baseURL 与 path，且不产生双斜杠', () => {
    expect(buildUrl('http://192.168.1.5:3000/api', '/families/1')).toBe('http://192.168.1.5:3000/api/families/1')
    expect(buildUrl('http://192.168.1.5:3000/api/', '/families/1')).toBe('http://192.168.1.5:3000/api/families/1')
  })

  it('把 query 对象序列化，跳过 undefined 与 null', () => {
    const url = buildUrl('http://h/api', '/events', { childId: 'c1', page: 1, type: undefined, from: null })
    expect(url).toBe('http://h/api/events?childId=c1&page=1')
  })

  it('对值做 URL 编码（家庭名等可能含中文）', () => {
    expect(buildUrl('http://h/api', '/x', { q: '宝宝 奶' })).toBe('http://h/api/x?q=%E5%AE%9D%E5%AE%9D%20%E5%A5%B6')
  })
})

describe('shouldRetryAfterRefresh', () => {
  it('401 且尚未重放过才刷新重试', () => {
    expect(shouldRetryAfterRefresh(401, false)).toBe(true)
    expect(shouldRetryAfterRefresh(401, true)).toBe(false)
  })

  it('403 不触发刷新（越权重试没有意义）', () => {
    expect(shouldRetryAfterRefresh(403, false)).toBe(false)
  })

  it('5xx 与网络错误不触发刷新', () => {
    expect(shouldRetryAfterRefresh(500, false)).toBe(false)
    expect(shouldRetryAfterRefresh(0, false)).toBe(false)
  })
})

describe('normalizeError', () => {
  it('把 uni.request 的失败对象转成带网络标记的错误', () => {
    const e = normalizeError({ errMsg: 'request:fail timeout' })
    expect(e).toBeInstanceOf(ApiRequestError)
    expect(e.isNetworkError).toBe(true)
    expect(e.message).toMatch(/网络|连接/)
  })

  it('把后端 ApiError 转成用户可读文案', () => {
    const e = normalizeError({ statusCode: 400, data: { statusCode: 400, message: ['账号需为 4–20 位字母、数字或下划线'], error: 'Bad Request' } })
    expect(e.statusCode).toBe(400)
    expect(e.message).toContain('4–20')
    expect(e.isNetworkError).toBe(false)
  })

  it('message 为数组时全部拼接，不出现 [object Object]', () => {
    const e = normalizeError({ statusCode: 400, data: { message: ['a', 'b'] } })
    expect(e.message).toBe('a; b')
  })

  it('未知错误也有可读文案', () => {
    expect(normalizeError(undefined).message).toBeTruthy()
    expect(normalizeError({}).message).toBeTruthy()
  })

  // 退出登录后按浏览器"后退"，tab 页会把 Nest 守卫的默认英文直接印在界面上。
  it('401/403 的默认英文文案不许出现在界面上', () => {
    const unauthorized = normalizeError({ statusCode: 401, data: { statusCode: 401, message: 'Unauthorized' } })
    expect(unauthorized.message).toContain('登录')
    expect(unauthorized.message).not.toContain('Unauthorized')

    const forbidden = normalizeError({ statusCode: 403, data: { statusCode: 403, message: 'Forbidden' } })
    expect(forbidden.message).not.toContain('Forbidden')
    expect(forbidden.message).toMatch(/权限|登录/)
  })

  it('后端写明了理由时保留原文，通用文案不许盖掉它', () => {
    const e = normalizeError({ statusCode: 403, data: { statusCode: 403, message: '只有管理员能改家庭名称', error: 'Forbidden' } })
    expect(e.message).toBe('只有管理员能改家庭名称')
  })
})

describe('access token', () => {
  it('setAccessToken 写入本地存储，null 清空', async () => {
    const { getAccessToken, setAccessToken } = await import('../http')
    setAccessToken('at-1')
    expect(getAccessToken()).toBe('at-1')
    expect(uni.getStorageSync('accessToken')).toBe('at-1')
    setAccessToken(null)
    expect(getAccessToken()).toBeNull()
    expect(uni.getStorageSync('accessToken')).toBe('')
  })
})

describe('apiRequest 的 401 续期', () => {
  const uniAny = globalThis as unknown as { uni: Record<string, unknown> }
  const originalRequest = uniAny.uni.request

  const responds = (statusCode: number, data: unknown) =>
    vi.fn((opts: { success: (res: { statusCode: number; data: unknown }) => void }) =>
      opts.success({ statusCode, data }),
    )

  afterEach(() => {
    uniAny.uni.request = originalRequest
  })

  it('公开端点的 401 不去续期：密码错误的文案不能被换成"本地没有登录凭证"', async () => {
    const { apiRequest, setRefreshHandler } = await import('../http')
    const refresh = vi.fn(async () => 'fresh')
    setRefreshHandler(refresh)
    uniAny.uni.request = responds(401, { statusCode: 401, message: '账号或密码不正确' })

    await expect(apiRequest('/auth/login', { method: 'POST', auth: false })).rejects.toThrow(
      '账号或密码不正确',
    )
    expect(refresh).not.toHaveBeenCalled()
  })

  it('已鉴权请求的 401 先续期再重放一次', async () => {
    const { apiRequest, setAccessToken, setRefreshHandler } = await import('../http')
    setAccessToken('expired-at')
    setRefreshHandler(async () => 'fresh-at')
    let sent = 0
    uniAny.uni.request = vi.fn(
      (opts: { header: Record<string, string>; success: (res: { statusCode: number; data: unknown }) => void }) => {
        sent += 1
        const authed = opts.header.Authorization === 'Bearer fresh-at'
        opts.success(authed ? { statusCode: 200, data: { ok: true } } : { statusCode: 401, data: {} })
      },
    )

    await expect(apiRequest('/me')).resolves.toEqual({ ok: true })
    expect(sent).toBe(2)
    setAccessToken(null)
  })
})

describe('续期的 single-flight', () => {
  const uniAny = globalThis as unknown as { uni: Record<string, unknown> }
  const originalRequest = uniAny.uni.request

  afterEach(() => {
    uniAny.uni.request = originalRequest
  })

  it('两个并发 401 只续期一次（各转各的会让后到的那次把会话弄丢）', async () => {
    const { apiRequest, setAccessToken, setRefreshHandler } = await import('../http')
    setAccessToken('expired-at')
    let calls = 0
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    setRefreshHandler(async () => {
      calls += 1
      await gate
      return 'fresh-at'
    })
    uniAny.uni.request = vi.fn(
      (opts: { header: Record<string, string>; success: (res: { statusCode: number; data: unknown }) => void }) => {
        const ok = opts.header.Authorization === 'Bearer fresh-at'
        opts.success(ok ? { statusCode: 200, data: { ok: true } } : { statusCode: 401, data: {} })
      },
    )

    const first = apiRequest('/me')
    const second = apiRequest('/families')
    await Promise.resolve()
    release()
    await expect(first).resolves.toEqual({ ok: true })
    await expect(second).resolves.toEqual({ ok: true })
    expect(calls).toBe(1)
    setAccessToken(null)
  })

  it('renewAccessToken 复用在飞的续期，前一次结束后下一次真的再发一轮', async () => {
    const { renewAccessToken, setRefreshHandler } = await import('../http')
    let calls = 0
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    setRefreshHandler(async () => {
      calls += 1
      await gate
      return `at-${calls}`
    })
    const a = renewAccessToken()
    const b = renewAccessToken()
    release()
    expect(await a).toBe('at-1')
    expect(await b).toBe('at-1')
    expect(calls).toBe(1)
    await expect(renewAccessToken()).resolves.toBe('at-2')
    expect(calls).toBe(2)
  })

  it('没有注册续期处理器时直接失败，而不是挂住', async () => {
    vi.resetModules()
    const { renewAccessToken } = await import('../http')
    await expect(renewAccessToken()).rejects.toThrow(/登录凭证/)
    vi.resetModules()
  })
})

describe('会话失效的出口', () => {
  const uniAny = globalThis as unknown as { uni: Record<string, unknown> }
  const originalRequest = uniAny.uni.request

  const always = (statusCode: number) =>
    vi.fn((opts: { success: (res: { statusCode: number; data: unknown }) => void }) =>
      opts.success({ statusCode, data: { statusCode, message: 'Unauthorized' } }),
    )

  afterEach(() => {
    uniAny.uni.request = originalRequest
    vi.resetModules()
  })

  it('续期也救不回来时通知一次，让 App 把人带回登录', async () => {
    vi.resetModules()
    const { apiRequest, setAccessToken, setRefreshHandler, setSessionExpiredHandler } = await import('../http')
    const onExpired = vi.fn()
    setSessionExpiredHandler(onExpired)
    setAccessToken('at')
    setRefreshHandler(async () => {
      throw new Error('本地没有登录凭证')
    })
    uniAny.uni.request = always(401)

    await expect(apiRequest('/me')).rejects.toThrow(/登录/)
    expect(onExpired).toHaveBeenCalledTimes(1)
  })

  it('续期成功但重放仍然 401，同样算会话失效', async () => {
    vi.resetModules()
    const { apiRequest, setAccessToken, setRefreshHandler, setSessionExpiredHandler } = await import('../http')
    const onExpired = vi.fn()
    setSessionExpiredHandler(onExpired)
    setAccessToken('at')
    setRefreshHandler(async () => 'fresh-at')
    uniAny.uni.request = always(401)

    await expect(apiRequest('/me')).rejects.toThrow(/登录/)
    expect(onExpired).toHaveBeenCalledTimes(1)
  })

  it('并发失败只通知一次；重新拿到会话后才会再通知', async () => {
    vi.resetModules()
    const { apiRequest, setAccessToken, setRefreshHandler, setSessionExpiredHandler } = await import('../http')
    const onExpired = vi.fn()
    setSessionExpiredHandler(onExpired)
    setAccessToken('at')
    setRefreshHandler(async () => {
      throw new Error('本地没有登录凭证')
    })
    uniAny.uni.request = always(401)

    await Promise.allSettled([apiRequest('/me'), apiRequest('/families'), apiRequest('/events')])
    expect(onExpired).toHaveBeenCalledTimes(1)

    setAccessToken('new-at')
    await apiRequest('/me').catch(() => undefined)
    expect(onExpired).toHaveBeenCalledTimes(2)
  })

  it('公开端点的 401 不算会话失效：密码错误不该把人踢回欢迎页', async () => {
    vi.resetModules()
    const { apiRequest, setRefreshHandler, setSessionExpiredHandler } = await import('../http')
    const onExpired = vi.fn()
    setSessionExpiredHandler(onExpired)
    setRefreshHandler(async () => 'fresh-at')
    uniAny.uni.request = always(401)

    await expect(apiRequest('/auth/login', { method: 'POST', auth: false })).rejects.toThrow(/登录/)
    expect(onExpired).not.toHaveBeenCalled()
  })
})

describe('baseURL 配置', () => {
  it('缺少 VITE_API_BASE_URL 时抛错，而不是回退到 localhost', async () => {
    vi.resetModules()
    vi.stubEnv('VITE_API_BASE_URL', '')
    await expect(import('../../config/env')).rejects.toThrow(/VITE_API_BASE_URL/)
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('配置了 baseURL 时去掉结尾斜杠', async () => {
    vi.resetModules()
    vi.stubEnv('VITE_API_BASE_URL', 'http://10.0.0.5:3000/api/')
    const { API_BASE_URL } = await import('../../config/env')
    expect(API_BASE_URL).toBe('http://10.0.0.5:3000/api')
    vi.unstubAllEnvs()
    vi.resetModules()
  })
})
