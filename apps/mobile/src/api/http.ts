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
}

export function getAccessToken(): string | null {
  if (accessToken !== null) return accessToken
  const stored = uni.getStorageSync(ACCESS_TOKEN_KEY)
  return typeof stored === 'string' && stored.length > 0 ? stored : null
}

export function setRefreshHandler(fn: () => Promise<string>): void {
  refreshHandler = fn
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET'
  const url = buildUrl(API_BASE_URL, path, options.query)
  const needsAuth = options.auth !== false

  const send = (token: string | null) =>
    new Promise<{ statusCode: number; data: unknown }>((resolve, reject) => {
      uni.request({
        url,
        // @dcloudio/types 的 method 联合里没有 'PATCH'，但 uni-h5 运行时是支持的
        // （其源码里存在 'PATCH' 字面量），后端的更新类接口又确实是 PATCH。
        method: method as 'GET',
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

  if (shouldRetryAfterRefresh(res.statusCode, false) && refreshHandler) {
    try {
      const fresh = await refreshHandler()
      setAccessToken(fresh)
      const retry = await send(fresh)
      if (retry.statusCode >= 200 && retry.statusCode < 300) return retry.data as T
      throw normalizeError(retry)
    } catch (err) {
      if (err instanceof ApiRequestError) throw err
      throw normalizeError(err)
    }
  }

  throw normalizeError(res)
}
