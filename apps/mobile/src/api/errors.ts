import type { ApiError } from '@moonbud/shared'

export class ApiRequestError extends Error {
  statusCode: number
  isNetworkError: boolean

  constructor(message: string, statusCode = 0, isNetworkError = false) {
    super(message)
    this.name = 'ApiRequestError'
    this.statusCode = statusCode
    this.isNetworkError = isNetworkError
  }
}

const FALLBACK = '请求失败，请稍后重试'

/**
 * Nest 的守卫/过滤器在没人写明理由时返回这几个英文串。它们直接落到界面上，
 * 家长看到的就是一个莫名其妙的 "Unauthorized"。
 */
const STOCK_TEXTS = new Set([
  'bad request',
  'unauthorized',
  'forbidden',
  'not found',
  'conflict',
  'internal server error',
])

const STATUS_COPY: Record<number, string> = {
  400: '请求的内容有问题，请检查后重试',
  401: '登录已过期，请重新登录',
  403: '没有权限这样做',
  404: '要找的内容不在了',
  409: '和家人刚做的改动冲突了，刷新一下再试',
  429: '说得有点快了，等一分钟再试',
}

function readMessage(source: unknown): string | undefined {
  if (typeof source === 'string') return source.trim() || undefined
  if (Array.isArray(source)) {
    const parts = source.map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean)
    return parts.length ? parts.join('; ') : undefined
  }
  if (source && typeof source === 'object') {
    const record = source as Record<string, unknown>
    return readMessage(record.message) ?? readMessage(record.error)
  }
  return undefined
}

export function normalizeError(e: unknown): ApiRequestError {
  if (e instanceof ApiRequestError) return e

  const obj = (e ?? {}) as Record<string, unknown>

  // uni.request 的失败回调：{ errMsg: 'request:fail ...' }
  if (typeof obj.errMsg === 'string') {
    return new ApiRequestError('网络连接失败，请检查网络后重试', 0, true)
  }

  const statusCode = typeof obj.statusCode === 'number' ? obj.statusCode : 0
  const body = obj.data ?? obj
  const raw = readMessage(body)
  if (raw && !STOCK_TEXTS.has(raw.trim().toLowerCase())) return new ApiRequestError(raw, statusCode, false)
  const message = STATUS_COPY[statusCode] ?? (statusCode >= 500 ? '服务暂时不可用，请稍后重试' : FALLBACK)
  return new ApiRequestError(message, statusCode, false)
}
