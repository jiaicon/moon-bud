import { API_BASE_URL } from '../config/env'
import { ApiRequestError, normalizeError } from './errors'

export type QueryValue = string | number | boolean | null | undefined
export type Query = Record<string, QueryValue>

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  data?: unknown
  query?: Query
  auth?: boolean
  timeoutMs?: number
}

export function buildUrl(base: string, path: string, query?: Query): string {
  const url = `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
  if (!query) return url
  const parts: string[] = []
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
  }
  return parts.length ? `${url}?${parts.join('&')}` : url
}

export function shouldRetryAfterRefresh(statusCode: number, alreadyRetried: boolean): boolean {
  return statusCode === 401 && !alreadyRetried
}

const ACCESS_TOKEN_KEY = 'accessToken'
let accessToken: string | null = null
let refreshHandler: (() => Promise<string>) | null = null

export function setAccessToken(token: string | null): void {
  accessToken = token
  uni.setStorageSync(ACCESS_TOKEN_KEY, token ?? '')
  // 拿到新凭证就是新会话：下一次失效还要能再通知一次。
  if (token) sessionExpiredReported = false
}

export function getAccessToken(): string | null {
  if (accessToken !== null) return accessToken
  const stored = uni.getStorageSync(ACCESS_TOKEN_KEY)
  return typeof stored === 'string' && stored.length > 0 ? stored : null
}

export function setRefreshHandler(fn: () => Promise<string>): void {
  refreshHandler = fn
}

let sessionExpiredHandler: (() => void) | null = null
let sessionExpiredReported = false

/**
 * 会话彻底救不回来时的出口。http 层只负责"说一次"，怎么把人带回登录由 store 决定：
 * 各页自己处理 401 的话，漏一个页面就是一个甩出 "Unauthorized" 的界面。
 */
export function setSessionExpiredHandler(fn: (() => void) | null): void {
  sessionExpiredHandler = fn
  sessionExpiredReported = false
}

function reportSessionExpired(): void {
  if (!sessionExpiredHandler || sessionExpiredReported) return
  sessionExpiredReported = true
  sessionExpiredHandler()
}

let refreshing: Promise<string> | null = null

/**
 * 续期必须全局只有一次在进行：冷启动时 App.vue 的 bootstrap 和各页 onLoad 会同时撞上 401，
 * 两边各发一次 /auth/refresh，服务端只认第一次旋转出来的新凭证，第二次是重放 ——
 * 输的那一方会把自己的会话清掉，用户就莫名其妙回到登录页。
 */
export function renewAccessToken(): Promise<string> {
  if (refreshing) return refreshing
  if (!refreshHandler) return Promise.reject(new Error('本地没有登录凭证'))
  const attempt = (async () => {
    const fresh = await refreshHandler()
    setAccessToken(fresh)
    return fresh
  })()
  refreshing = attempt
  const clear = () => {
    if (refreshing === attempt) refreshing = null
  }
  attempt.then(clear, clear)
  return attempt
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET'
  const url = buildUrl(API_BASE_URL, path, options.query)
  const needsAuth = options.auth !== false
  // "这次请求有没有带会话"要在发出前问：并发里别的请求可能在我们等待期间续好期，
  // 事后再读会把一个游客说成有过期会话。
  const hadSession = needsAuth && getAccessToken() !== null

  const send = (token: string | null) =>
    new Promise<{ statusCode: number; data: unknown }>((resolve, reject) => {
      uni.request({
        url,
        // @dcloudio/types 的 method 联合里没有 'PATCH'，但 uni-h5 运行时是支持的
        // （其源码里存在 'PATCH' 字面量），后端的更新类接口又确实是 PATCH。
        // .cast 到那个联合本身，别谎报成 'GET'：写错方法名时类型还能拦一下。
        method: method as UniNamespace.RequestOptions['method'],
        data: options.data as never,
        timeout: options.timeoutMs ?? 15000,
        header: needsAuth && token ? { Authorization: `Bearer ${token}` } : {},
        success: (res) => resolve({ statusCode: res.statusCode, data: res.data }),
        fail: (err) => reject(err),
      })
    })

  let res: { statusCode: number; data: unknown }
  try {
    res = await send(needsAuth ? getAccessToken() : null)
  } catch (err) {
    throw normalizeError(err)
  }

  if (res.statusCode >= 200 && res.statusCode < 300) return res.data as T

  // needsAuth 这一眼看着多余，实则关键：/auth/login 自己就返回 401，
  // 若照样去续期，"账号或密码不正确"会被 refreshHandler 的失败文案顶掉，
  // 用户看到的是"本地没有登录凭证"，完全无从下手。
  if (needsAuth && shouldRetryAfterRefresh(res.statusCode, false) && refreshHandler) {
    try {
      const fresh = await renewAccessToken()
      const retry = await send(fresh)
      if (retry.statusCode >= 200 && retry.statusCode < 300) return retry.data as T
      // 报"过期"的门槛是本地到底有没有会话：游客的一次 401 不是过期，
      // 报了就等于把他甩进"欢迎页 → onShow → 又 401"的死圈。
      if (retry.statusCode === 401 && hadSession) reportSessionExpired()
      throw normalizeError(retry)
    } catch (err) {
      if (err instanceof ApiRequestError) throw err
      if (hadSession) reportSessionExpired()
      throw normalizeError(err)
    }
  }

  if (needsAuth && res.statusCode === 401 && hadSession) reportSessionExpired()
  throw normalizeError(res)
}
